import { beforeEach, expect, it, vi } from 'vitest';
import { analyzeRepository } from '@/pipeline/analyze';
import * as github from '@/lib/github';
import { composeUrl, evidenceLabel } from '@/lib/evidence';
import type { AppWithRepo } from '@/lib/types';

vi.mock('@/lib/github', () => ({
  getRootContents: vi.fn(), getReadme: vi.fn(), getLatestRelease: vi.fn(), getLanguages: vi.fn(),
}));

function ok<T>(value: T): github.ResourceFetch<T> { return { kind: 'ok', value }; }

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(github.getReadme).mockResolvedValue(ok('Multi-arch container, no architecture details.'));
  vi.mocked(github.getLatestRelease).mockResolvedValue(ok({ tag_name: '', published_at: '' }));
  vi.mocked(github.getLanguages).mockResolvedValue(ok({}));
});
it.each(['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml'])(
  'preserves the actual installation path for %s and never assumes AMD64', async (filename) => {
    vi.mocked(github.getRootContents).mockImplementation(async (_owner, _repo, path) => path === 'deploy'
      ? ok([{ name: filename, type: 'file' }])
      : ok([{ name: 'Dockerfile', type: 'file' }, { name: 'deploy', type: 'dir' }, { name: 'src', type: 'dir' }]));
    const { result } = await analyzeRepository('owner', 'app', 'main');
    expect(result.composePath).toBe(`deploy/${filename}`);
    expect(result.composePresent).toBe(true);
    expect(result.arm64Supported).toBeNull();
    expect(result.amd64Supported).toBeNull();
    expect(result.databases).toEqual([]);
    expect(github.getRootContents).toHaveBeenCalledTimes(2);
    const app = { composePath: result.composePath, repository: { repositoryUrl: 'https://github.com/owner/app', defaultBranch: 'stable/v1' } } as AppWithRepo;
    expect(composeUrl(app)).toBe(`https://github.com/owner/app/blob/stable%2Fv1/deploy/${filename}`);
    expect(composeUrl({ ...app, composePath: null })).toBe(app.repository.repositoryUrl);
  });
it('keeps absence unknown and labels mentions as inference, preserving manual provenance', async () => {
  vi.mocked(github.getRootContents).mockResolvedValue(ok([]));
  vi.mocked(github.getReadme).mockResolvedValue(ok('ARM64 and PostgreSQL mentioned here.'));
  const { result } = await analyzeRepository('owner', 'app', 'main');
  expect(result.arm64Supported).toBe(true);
  expect(result.amd64Supported).toBeNull();
  expect(result.composePath).toBeNull();
  expect(result.databases).toEqual(['PostgreSQL']);
  const app = { fieldSources: { arm64Supported: 'readme-mention' }, manualOverrides: { databases: true } } as unknown as AppWithRepo;
  expect(evidenceLabel(app, 'arm64Supported')).toContain('not tested');
  expect(evidenceLabel(app, 'databases')).toBe('Manually corrected');
});
it('preserves fields and reports diagnostics when GitHub answers with a transient error', async () => {
  // GitHub is sick: a 503 on the README call should NOT make analyze() report "no readme".
  // The caller (refresh) inspects diagnostics and decides whether to clear evidence or keep it.
  vi.mocked(github.getRootContents).mockResolvedValue(ok([]));
  vi.mocked(github.getReadme).mockResolvedValue({ kind: 'transient_error', status: 503 });
  vi.mocked(github.getLatestRelease).mockResolvedValue({ kind: 'rate_limited' });
  vi.mocked(github.getLanguages).mockResolvedValue({ kind: 'auth_error' });
  const { result, diagnostics } = await analyzeRepository('owner', 'app', 'main');
  expect(result.readmeFull).toBeNull();
  expect(result.latestReleaseAt).toBeNull();
  expect(result.languages).toBeNull();
  expect(diagnostics.readmeStatus).toBe('transient_error');
  expect(diagnostics.releaseStatus).toBe('rate_limited');
  expect(diagnostics.languagesStatus).toBe('auth_error');
});
it('treats a real 404 as absent, not as a transient failure', async () => {
  vi.mocked(github.getRootContents).mockResolvedValue(ok([]));
  vi.mocked(github.getReadme).mockResolvedValue({ kind: 'not_found' });
  vi.mocked(github.getLatestRelease).mockResolvedValue({ kind: 'not_found' });
  vi.mocked(github.getLanguages).mockResolvedValue(ok({}));
  const { result, diagnostics } = await analyzeRepository('owner', 'app', 'main');
  expect(result.readmeFull).toBeNull();
  expect(result.latestReleaseAt).toBeNull();
  expect(diagnostics.readmeStatus).toBe('not_found');
});
