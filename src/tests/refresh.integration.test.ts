import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import * as github from '@/lib/github';
import { refreshOne, pickRepos, runRefresh } from '@/pipeline/refresh';
import { processCandidate } from '@/pipeline/discover';
import { computeStarsGained30d } from '@/pipeline/stars-since';
import { tryClaim } from '@/pipeline/claim';
import { runSnapshot } from '@/pipeline/snapshot';
vi.hoisted(() => { if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; });
vi.mock('@/lib/github', () => ({ getRepositoryById: vi.fn(), getRootContents: vi.fn(), getReadme: vi.fn(), getLatestRelease: vi.fn(), getLanguages: vi.fn(), searchRepositories: vi.fn() }));
vi.mock('@/lib/alerts', () => ({ sendAlert: vi.fn(), pingHeartbeat: vi.fn() }));
const prefix = `refresh-test-${randomUUID()}`;
let repo: Awaited<ReturnType<typeof prisma.repository.create>>;
let item: github.GhRepoSearchItem;
let failAppWrite = false;

async function saved() { return prisma.repository.findUniqueOrThrow({ where: { id: repo.id }, include: { application: true } }); }

describe.skipIf(!process.env.TEST_DATABASE_URL)('refresh pipeline on PostgreSQL', () => {
  beforeAll(() => { prisma.$use(async (params, next) => {
    if (failAppWrite && params.model === 'Application' && params.action === 'update') throw new Error('Injected app write failure');
    return next(params);
  }); });
  beforeEach(async () => {
    vi.resetAllMocks();
    repo = await prisma.repository.create({ data: {
      githubId: BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 14)}`), owner: prefix, name: randomUUID(), fullName: `${prefix}/${randomUUID()}`,
      repositoryUrl: 'https://github.com/example/notes', createdAt: new Date(), pushedAt: new Date(),
      readmeExcerpt: 'Previous README', latestReleaseTag: 'v1', latestReleaseAt: new Date('2025-01-01'),
      application: { create: { slug: randomUUID(), name: 'Notes', isSelfHosted: true, category: 'Notes', composeSupported: true, composePath: 'compose.yml', healthScore: 88, approved: true } },
    } });
    item = { id: Number(repo.githubId), name: repo.name, full_name: repo.fullName, owner: { login: prefix },
      description: 'Self-hosted note taking application', html_url: repo.repositoryUrl, homepage: null, stargazers_count: 150,
      forks_count: 10, watchers_count: 2, open_issues_count: 1, license: { spdx_id: 'MIT' }, language: 'TypeScript', topics: ['self-hosted', 'notes'],
      created_at: repo.createdAt.toISOString(), pushed_at: new Date().toISOString(), archived: false, fork: false, default_branch: 'stable',
    } as github.GhRepoSearchItem;
    // GitHub IDs must be exactly representable by the API's number type.
    repo = await prisma.repository.update({ where: { id: repo.id }, data: { githubId: BigInt(item.id) } });
    vi.mocked(github.getRepositoryById).mockResolvedValue({ found: true, repo: item });
    vi.mocked(github.getReadme).mockResolvedValue({ kind: 'ok', value: 'Self-hosted note taking application with Docker Compose, ARM64 and SQLite. '.repeat(30) });
    vi.mocked(github.getRootContents).mockResolvedValue({ kind: 'ok', value: [{ name: 'compose.yaml', type: 'file' }] });
    vi.mocked(github.getLatestRelease).mockResolvedValue({ kind: 'ok', value: { tag_name: 'v2', published_at: '2026-01-01T00:00:00Z' } });
    vi.mocked(github.getLanguages).mockResolvedValue({ kind: 'ok', value: { TypeScript: 50 } });
  });
  afterEach(async () => {
    await prisma.scan.deleteMany({ where: { repositoryId: repo.id } });
    await prisma.repository.deleteMany({ where: { id: repo.id } });
  });
  afterAll(() => prisma.$disconnect());

  it('persists a complete refresh and growth without losing admin edits made during I/O', async () => {
    const date = new Date(Date.now() - 31 * 86400000);
    await prisma.metricSnapshot.create({ data: { repositoryId: repo.id, stars: 100, forks: 1, recordedAt: date, recordedDay: date } });
    vi.mocked(github.getReadme).mockImplementationOnce(async () => {
      await prisma.application.update({ where: { repositoryId: repo.id }, data: { category: 'Gaming', healthScore: 99, manualOverrides: { category: true, healthScore: true } } });
      return { kind: 'ok', value: 'Self-hosted note taking application with Docker Compose ARM64 SQLite. '.repeat(30) };
    });
    expect((await refreshOne(repo)).status).toBe('updated');
    const row = await saved();
    expect(row.defaultBranch).toBe('stable');
    expect(row.latestReleaseTag).toBe('v2');
    expect(row.readmeExcerpt).toContain('SQLite');
    expect(row.application).toMatchObject({ category: 'Gaming', healthScore: 99, approved: true, composePath: 'compose.yaml', growthScoreSource: 'computed' });
    expect(row.application!.growthScore).toBeGreaterThan(0);
    expect(row.scanClaimId).toBeNull();
  });

  it.each(['readme', 'contents', 'release', 'languages'])('retains all evidence on a failed %s fetch and records the retry', async field => {
    const fn = { readme: github.getReadme, contents: github.getRootContents, release: github.getLatestRelease, languages: github.getLanguages }[field]!;
    vi.mocked(fn).mockResolvedValueOnce({ kind: 'transient_error', status: 503 } as never);
    expect((await refreshOne(repo)).status).toBe('error');
    const row = await saved();
    expect(row.readmeExcerpt).toBe('Previous README');
    expect(row.latestReleaseTag).toBe('v1');
    expect(row.application!.healthScore).toBe(88);
    expect(row.lastScannedAt).toBeNull();
    expect(row.lastScanError).toContain('Incomplete GitHub analysis');
    expect(row.lastScanAttemptAt).not.toBeNull();
    expect(row.scanClaimId).toBeNull();
  });

  it('dry-run performs no database writes', async () => {
    const before = await saved();
    expect((await refreshOne(repo, true)).status).toBe('preview');
    expect(await saved()).toEqual(before);
    expect(await prisma.scan.count({ where: { repositoryId: repo.id } })).toBe(0);
  });

  it('rejects the stale worker when another claim takes over during I/O', async () => {
    vi.mocked(github.getReadme).mockImplementationOnce(async () => {
      await prisma.repository.update({ where: { id: repo.id }, data: { scanClaimExpiresAt: new Date(0) } });
      expect(await tryClaim(prisma, repo.id)).not.toBeNull();
      return { kind: 'ok', value: 'Self-hosted note taking application with Docker.' };
    });
    expect((await refreshOne(repo)).status).toBe('error');
    const row = await saved();
    expect(row.readmeExcerpt).toBe('Previous README');
    expect(row.application!.healthScore).toBe(88);
    expect(row.scanClaimId).not.toBeNull(); // Old worker cannot release the replacement's claim.
  });

  it('rolls back repository changes when the application write fails', async () => {
    failAppWrite = true;
    try {
      expect((await refreshOne(repo)).status).toBe('error');
      const row = await saved();
      expect(row.lastScannedAt).toBeNull();
      expect(row.readmeExcerpt).toBe('Previous README');
      expect(row.application!.healthScore).toBe(88);
    } finally { failAppWrite = false; }
  });

  it('clears confirmed absent Compose, handles rename, and retains negative classifications for review', async () => {
    item.full_name = `${prefix}/renamed-${repo.id}`;
    item.name = 'renamed-notes';
    vi.mocked(github.getRootContents).mockResolvedValue({ kind: 'ok', value: [] });
    expect((await refreshOne(repo)).status).toBe('updated');
    expect((await saved()).fullName).toBe(item.full_name);
    expect((await saved()).application!.composeSupported).toBe(false);
    item.description = 'A list of useful links'; item.topics = []; item.name = 'awesome-list';
    vi.mocked(github.getReadme).mockResolvedValue({ kind: 'ok', value: 'A curated awesome list of links' });
    expect((await refreshOne(repo)).status).toBe('updated');
    const row = await saved();
    expect(row.application!.isSelfHosted).toBe(true);
    expect(row.application!.classificationReviewReasons.join(' ')).toContain('manual review');
  });

  it('rediscovery uses the same complete analysis and growth persistence', async () => {
    expect(await processCandidate({ item, sources: new Set(['test']) })).toBe('ok');
    expect((await saved()).application!.scoreBreakdown).not.toBeNull();
  });

  it('respects retry interval and has safe defaults for empty environment variables', async () => {
    await prisma.repository.update({ where: { id: repo.id }, data: { lastScannedAt: new Date(0), lastScanAttemptAt: new Date() } });
    expect((await pickRepos(1000, null)).some(r => r.id === repo.id)).toBe(false);
    vi.stubEnv('REFRESH_MAX_REPOS', ''); vi.stubEnv('REFRESH_CONCURRENCY', '');
    try { expect((await runRefresh(['--repo', repo.fullName, '--dry-run'])).scanned).toBe(1); }
    finally { vi.unstubAllEnvs(); }
  });

  it('uses only snapshots at or before the 30-day boundary', async () => {
    const now = new Date('2026-09-15T12:00:00Z');
    for (const [date, stars] of [['2026-08-15', 100], ['2026-08-17', 140]] as const) {
      await prisma.metricSnapshot.create({ data: { repositoryId: repo.id, recordedAt: new Date(date), recordedDay: new Date(date), stars, forks: 1 } });
    }
    expect(await computeStarsGained30d(repo.id, 150, now)).toEqual({ starsGained: 50, source: 'computed' });
  });
  it('upserts concurrent snapshots without duplicate days and saves a valid score payload', async () => {
    const row = await saved();
    const finder = vi.spyOn(prisma.repository, 'findMany').mockResolvedValue([row]);
    try {
      const clock = { now: () => new Date('2026-09-15T12:00:00Z') };
      await Promise.all([runSnapshot(clock), runSnapshot(clock)]);
      expect(await prisma.metricSnapshot.count({ where: { repositoryId: repo.id } })).toBe(1);
      expect((await saved()).application!.scoreBreakdown).not.toBeNull();
    } finally { finder.mockRestore(); }
  });

});
