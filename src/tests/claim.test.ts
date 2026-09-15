import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { tryClaim, renew, release, updateIfOwner, currentWorkerId } from '@/pipeline/claim';

// Integration test: requires a real Postgres with the project's schema migrated.
// The CI suite runs with TEST_DATABASE_URL pointing at a throwaway database
// (see .github/workflows/ci.yml), so the claim mechanism gets exercised against
// the real Postgres semantics (timestamp comparison, atomic UPDATE, RETURNING count).
// Prisma's typed API is used end-to-end so we don't drift from what the pipeline does.
//
// The fixture Repository row is created on the shared TEST_DATABASE_URL database and
// deleted in afterEach so re-runs don't accumulate. DATABASE_URL is NOT consulted as a
// fallback: the plan explicitly required an isolated TEST_DATABASE_URL, and falling back
// would silently run integration tests against the project's own database.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const skipUnless = TEST_DATABASE_URL ? describe : describe.skip;

skipUnless('scan claim', () => {
  let prisma: PrismaClient;
  let repoId: string;

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for claim.test.ts');
    prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  beforeEach(async () => {
    if (!TEST_DATABASE_URL) return;
    // Create a fresh isolated Repository row with no claim. We don't reuse names
    // because the unique constraint on fullName could collide across test runs.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const row = await prisma.repository.create({
      data: {
        githubId: BigInt(Date.now() + Math.floor(Math.random() * 1000)),
        owner: 'test-owner', name: 'claim-test', fullName: `test-owner/claim-test-${suffix}`,
        description: null, repositoryUrl: `https://github.com/test-owner/claim-test-${suffix}`,
        homepageUrl: null, stars: 0, forks: 0, watchers: 0, openIssues: 0,
        license: null, primaryLanguage: null, languages: undefined, topics: [],
        createdAt: new Date(), pushedAt: new Date(),
        archived: false, fork: false, defaultBranch: 'main',
      },
    });
    repoId = row.id;
  });

  afterEach(async () => {
    // Clean up the fixture so re-runs don't leak rows. Scoped by fullName prefix
    // so a concurrent test suite can't see its own rows disappear.
    if (prisma && repoId) {
      await prisma.repository.deleteMany({ where: { id: repoId } }).catch(() => undefined);
      repoId = '';
    }
  });

  it('grants a fresh claim to an unowned repository', async () => {
    const handle = await tryClaim(prisma, repoId, 60_000);
    expect(handle).not.toBeNull();
    expect(handle!.workerId).toBe(currentWorkerId());
  });

  it('rejects a second concurrent worker while the claim is live', async () => {
    const first = await tryClaim(prisma, repoId, 60_000);
    expect(first).not.toBeNull();
    // Simulate a different worker stealing the claim.
    const cutoff = new Date(Date.now() + 60_000);
    await prisma.repository.update({
      where: { id: repoId },
      data: { scanClaimId: 'other-worker', scanClaimExpiresAt: cutoff, scanClaimWorkerId: 'other-worker' },
    });
    const second = await tryClaim(prisma, repoId, 60_000);
    expect(second).toBeNull();
  });

  it('allows takeover once the claim expires', async () => {
    await prisma.repository.update({
      where: { id: repoId },
      data: { scanClaimId: 'old-worker', scanClaimExpiresAt: new Date(Date.now() - 1000), scanClaimWorkerId: 'old-worker' },
    });
    const fresh = await tryClaim(prisma, repoId, 60_000);
    expect(fresh).not.toBeNull();
    expect(fresh!.workerId).toBe(currentWorkerId());
  });

  it('renew extends the TTL only for the owner', async () => {
    await tryClaim(prisma, repoId, 1000);
    await prisma.repository.update({ where: { id: repoId }, data: { scanClaimId: 'thief' } });
    const renewed = await renew(prisma, repoId, 60_000);
    expect(renewed).toBeNull();
  });

  it('updateIfOwner commits only when we still hold the claim', async () => {
    await tryClaim(prisma, repoId, 60_000);
    const ok = await updateIfOwner(prisma, repoId, { description: 'updated-by-owner' });
    expect(ok).toBe(1);
    await release(prisma, repoId);
    const denied = await updateIfOwner(prisma, repoId, { description: 'after-release' });
    expect(denied).toBe(0);
    const row = await prisma.repository.findUniqueOrThrow({ where: { id: repoId } });
    expect(row.description).toBe('updated-by-owner');
  });

  it('release clears the claim so a follow-up tryClaim succeeds', async () => {
    await tryClaim(prisma, repoId, 60_000);
    await release(prisma, repoId);
    // After release, a brand new tryClaim should succeed (we're not stealing from
    // ourselves; the second one is a fresh acquisition by a now-non-owner).
    const second = await tryClaim(prisma, repoId, 60_000);
    expect(second).not.toBeNull();
  });
});
