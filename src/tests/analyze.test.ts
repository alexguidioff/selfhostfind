import { beforeEach, expect, it, vi } from 'vitest';
import { analyzeRepository } from '@/pipeline/analyze';
import * as github from '@/lib/github';
import { composeUrl, evidenceLabel } from '@/lib/evidence';
import type { AppWithRepo } from '@/lib/types';

vi.mock('@/lib/github', () => ({
  getRootContents: vi.fn(), getReadme: vi.fn(), getLatestRelease: vi.fn(), getLanguages: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(github.getReadme).mockResolvedValue('Multi-arch container, no architecture details.');
  vi.mocked(github.getLatestRelease).mockResolvedValue(null);
  vi.mocked(github.getLanguages).mockResolvedValue(null);
});
it.each(['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml'])(
  'preserves the actual installation path for %s and never assumes AMD64', async (filename) => {
    vi.mocked(github.getRootContents).mockImplementation(async (_owner, _repo, path) => path === 'deploy'
      ? [{ name: filename, type: 'file' }]
      : [{ name: 'Dockerfile', type: 'file' }, { name: 'deploy', type: 'dir' }, { name: 'src', type: 'dir' }]);
    const result = await analyzeRepository('owner', 'app', 'main');
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
  vi.mocked(github.getRootContents).mockResolvedValue([]);
  vi.mocked(github.getReadme).mockResolvedValue('ARM64 and PostgreSQL mentioned here.');
  const result = await analyzeRepository('owner', 'app', 'main');
  expect(result.arm64Supported).toBe(true);
  expect(result.amd64Supported).toBeNull();
  expect(result.composePath).toBeNull();
  expect(result.databases).toEqual(['PostgreSQL']);
  const app = { fieldSources: { arm64Supported: 'readme-mention' }, manualOverrides: { databases: true } } as unknown as AppWithRepo;
  expect(evidenceLabel(app, 'arm64Supported')).toContain('not tested');
  expect(evidenceLabel(app, 'databases')).toBe('Manually corrected');
});
