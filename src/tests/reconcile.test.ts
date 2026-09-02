import { describe, it, expect } from 'vitest';
import { resolveRepositoryReconciliation } from '@/pipeline/reconcile';
import type { GhRepoSearchItem } from '@/lib/github';

const NOW = new Date('2026-09-02T00:00:00Z');

function makeRepo(overrides: Partial<GhRepoSearchItem> = {}): GhRepoSearchItem {
  return {
    id: 1,
    name: 'balancia',
    full_name: 'demo-org/balancia',
    owner: { login: 'demo-org' },
    description: 'Self-hosted expense splitting app',
    html_url: 'https://github.com/demo-org/balancia',
    homepage: null,
    stargazers_count: 340,
    forks_count: 28,
    watchers_count: 340,
    open_issues_count: 5,
    license: { spdx_id: 'AGPL-3.0', name: 'GNU AGPLv3' },
    language: 'TypeScript',
    topics: ['self-hosted'],
    created_at: '2025-01-01T00:00:00Z',
    pushed_at: '2026-08-30T00:00:00Z',
    archived: false,
    fork: false,
    default_branch: 'main',
    ...overrides,
  };
}

describe('resolveRepositoryReconciliation', () => {
  it('flags a repository unreachable when GitHub returns 404/410', () => {
    const result = resolveRepositoryReconciliation(
      { currentFullName: 'demo-org/balancia', currentArchived: false, currentUnreachable: false, lookup: { found: false } },
      NOW
    );
    expect(result.notable).toBe(true);
    expect(result.update.unreachable).toBe(true);
    expect(result.update.lastVerifiedAt).toEqual(NOW);
  });

  it('does not re-flag an already-unreachable repository as newly notable', () => {
    const result = resolveRepositoryReconciliation(
      { currentFullName: 'demo-org/balancia', currentArchived: false, currentUnreachable: true, lookup: { found: false } },
      NOW
    );
    expect(result.notable).toBe(false);
    expect(result.update.unreachable).toBeUndefined(); // no change needed, still gone
  });

  it('detects a rename and captures the new owner/name/url', () => {
    const repo = makeRepo({ full_name: 'new-owner/balancia-app', owner: { login: 'new-owner' }, name: 'balancia-app', html_url: 'https://github.com/new-owner/balancia-app' });
    const result = resolveRepositoryReconciliation(
      { currentFullName: 'demo-org/balancia', currentArchived: false, currentUnreachable: false, lookup: { found: true, repo } },
      NOW
    );
    expect(result.notable).toBe(true);
    expect(result.update.fullName).toBe('new-owner/balancia-app');
    expect(result.update.owner).toBe('new-owner');
    expect(result.update.repositoryUrl).toBe('https://github.com/new-owner/balancia-app');
    expect(result.reason).toContain('renamed');
  });

  it('detects a repository becoming archived upstream', () => {
    const repo = makeRepo({ archived: true });
    const result = resolveRepositoryReconciliation(
      { currentFullName: 'demo-org/balancia', currentArchived: false, currentUnreachable: false, lookup: { found: true, repo } },
      NOW
    );
    expect(result.notable).toBe(true);
    expect(result.update.archived).toBe(true);
  });

  it('detects a previously-unreachable repository becoming reachable again', () => {
    const repo = makeRepo();
    const result = resolveRepositoryReconciliation(
      { currentFullName: 'demo-org/balancia', currentArchived: false, currentUnreachable: true, lookup: { found: true, repo } },
      NOW
    );
    expect(result.notable).toBe(true);
    expect(result.update.unreachable).toBe(false);
  });

  it('refreshes metrics (stars/forks/pushedAt) even when nothing notable changed', () => {
    const repo = makeRepo({ stargazers_count: 999 });
    const result = resolveRepositoryReconciliation(
      { currentFullName: 'demo-org/balancia', currentArchived: false, currentUnreachable: false, lookup: { found: true, repo } },
      NOW
    );
    expect(result.notable).toBe(false);
    expect(result.update.stars).toBe(999);
    expect(result.update.pushedAt).toEqual(new Date('2026-08-30T00:00:00Z'));
  });
});
