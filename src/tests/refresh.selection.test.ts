import { describe, it, expect } from 'vitest';
import { parseArgs } from '@/pipeline/refresh.args';

// parseArgs is exported so it can be unit-tested in isolation: the orchestration of
// runRefresh mixes network calls, Prisma, and the claim, all of which need a database
// (or a heavy mock) to test. Validating the argument parsing and the resulting
// `dryRun`/`max`/`repo` triple is the part most likely to silently regress.
describe('parseArgs', () => {
  it('defaults to a non-dry-run with the global max', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, repo: null, max: 50 });
  });

  it('honors --dry-run and its alias --preview', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['--preview']).dryRun).toBe(true);
  });

  it('captures the value following --repo', () => {
    expect(parseArgs(['--repo', 'owner/name']).repo).toBe('owner/name');
  });

  it('caps the max at a positive integer and falls back on invalid input', () => {
    expect(parseArgs(['--max', '25']).max).toBe(25);
    expect(parseArgs(['--max', 'NaN']).max).toBe(50);
    expect(parseArgs(['--max', '0']).max).toBe(50);
    expect(parseArgs(['--max', '-3']).max).toBe(50);
  });

  it('supports a combination of flags in any order', () => {
    const result = parseArgs(['--max', '10', '--repo', 'foo/bar', '--dry-run']);
    expect(result).toEqual({ dryRun: true, repo: 'foo/bar', max: 10 });
  });
});
