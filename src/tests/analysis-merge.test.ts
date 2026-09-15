import { describe, it, expect } from 'vitest';
import { buildPreserveMap, hasTransientFailure } from '@/lib/analysis-merge';
import type { AnalysisDiagnostics } from '@/pipeline/analyze';

const baseDiag: AnalysisDiagnostics = {
  contentsStatus: 'ok', readmeStatus: 'ok', releaseStatus: 'ok', languagesStatus: 'ok',
};

describe('buildPreserveMap', () => {
  it('marks every field fresh-analysis on a fully successful fetch', () => {
    const map = buildPreserveMap(baseDiag);
    expect(Object.values(map).every((v) => v === 'fresh-analysis')).toBe(true);
  });

  it('preserves readme-derived fields when the README call transient-errors', () => {
    const map = buildPreserveMap({ ...baseDiag, readmeStatus: 'transient_error' });
    expect(map.readmeExcerpt).toBe('preserved-stale');
    expect(map.documentationUrl).toBe('preserved-stale');
    expect(map.demoUrl).toBe('preserved-stale');
    expect(map.databases).toBe('preserved-stale');
    expect(map.envVars).toBe('preserved-stale');
    expect(map.ports).toBe('preserved-stale');
    expect(map.installMethods).toBe('preserved-stale');
    expect(map.containerImage).toBe('preserved-stale');
    // Release info comes from a separate call, so it stays fresh if that call
    // succeeded. README failure doesn't necessarily mean release info is wrong.
    expect(map.latestReleaseAt).toBe('fresh-analysis');
  });

  it('preserves container-derived fields when the contents call transient-errors', () => {
    const map = buildPreserveMap({ ...baseDiag, contentsStatus: 'transient_error' });
    expect(map.dockerSupported).toBe('preserved-stale');
    expect(map.composeSupported).toBe('preserved-stale');
    expect(map.composePath).toBe('preserved-stale');
    // ARM64/AMD64 are detected from README content (see analyze.ts armMentioned regex),
    // so a contents error doesn't affect them — only a README error does.
    expect(map.arm64Supported).toBe('fresh-analysis');
    expect(map.amd64Supported).toBe('fresh-analysis');
  });

  it('preserves arm64/amd64 fields when the README call transient-errors', () => {
    const map = buildPreserveMap({ ...baseDiag, readmeStatus: 'transient_error' });
    expect(map.arm64Supported).toBe('preserved-stale');
    expect(map.amd64Supported).toBe('preserved-stale');
  });

  it('treats not_found the same as fresh: a real 404 means the field really is absent', () => {
    // Not_found is the only "ok to overwrite with empty" status: a 404 on the README
    // genuinely means this repo has no README, and we want the new absence reflected.
    const map = buildPreserveMap({ ...baseDiag, readmeStatus: 'not_found' });
    expect(map.readmeExcerpt).toBe('fresh-analysis');
    expect(map.documentationUrl).toBe('fresh-analysis');
  });

  it('preserves fields when a rate-limit response came back', () => {
    const map = buildPreserveMap({ ...baseDiag, releaseStatus: 'rate_limited' });
    expect(map.latestReleaseAt).toBe('preserved-stale');
    expect(map.latestReleaseTag).toBe('preserved-stale');
  });
});

describe('hasTransientFailure', () => {
  it('returns false when everything was ok', () => {
    expect(hasTransientFailure(baseDiag)).toBe(false);
  });

  it('returns false for clean 404s', () => {
    expect(hasTransientFailure({ ...baseDiag, readmeStatus: 'not_found' })).toBe(false);
  });

  it('returns true for rate_limited, auth_error, or transient_error', () => {
    expect(hasTransientFailure({ ...baseDiag, contentsStatus: 'rate_limited' })).toBe(true);
    expect(hasTransientFailure({ ...baseDiag, releaseStatus: 'auth_error' })).toBe(true);
    expect(hasTransientFailure({ ...baseDiag, languagesStatus: 'transient_error' })).toBe(true);
  });
});
