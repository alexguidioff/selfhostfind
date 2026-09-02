import { describe, it, expect } from 'vitest';
import { prefilterRepository } from '@/pipeline/prefilter';
import type { GhRepoSearchItem } from '@/lib/github';

function makeRepo(overrides: Partial<GhRepoSearchItem> = {}): GhRepoSearchItem {
  return {
    id: 1,
    name: 'balancia',
    full_name: 'demo-org/balancia',
    owner: { login: 'demo-org' },
    description: 'Self-hosted, open-source expense splitting app, an alternative to Splitwise.',
    html_url: 'https://github.com/demo-org/balancia',
    homepage: null,
    stargazers_count: 340,
    forks_count: 28,
    watchers_count: 340,
    open_issues_count: 5,
    license: { spdx_id: 'AGPL-3.0', name: 'GNU Affero General Public License v3.0' },
    language: 'TypeScript',
    topics: ['self-hosted', 'finance'],
    created_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    pushed_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    archived: false,
    fork: false,
    default_branch: 'main',
    ...overrides,
  };
}

describe('prefilterRepository', () => {
  it('passes a healthy, recently active, licensed application repo', () => {
    expect(prefilterRepository(makeRepo()).passed).toBe(true);
  });

  it('rejects forks', () => {
    expect(prefilterRepository(makeRepo({ fork: true })).passed).toBe(false);
  });

  it('rejects archived repos', () => {
    expect(prefilterRepository(makeRepo({ archived: true })).passed).toBe(false);
  });

  it('rejects repos without a license', () => {
    expect(prefilterRepository(makeRepo({ license: null })).passed).toBe(false);
  });

  it('rejects repos not pushed to in over 2 years', () => {
    const old = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString();
    expect(prefilterRepository(makeRepo({ pushed_at: old })).passed).toBe(false);
  });

  it('rejects SDK/library-shaped repos by description', () => {
    const result = prefilterRepository(makeRepo({ description: 'A Python SDK for talking to the Acme API.' }));
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/library|sdk/i);
  });

  it('rejects awesome-list style repos', () => {
    const result = prefilterRepository(makeRepo({ description: 'A curated list of self-hosted software.' }));
    expect(result.passed).toBe(false);
  });

  it('rejects repos with missing/too-short descriptions', () => {
    expect(prefilterRepository(makeRepo({ description: '' })).passed).toBe(false);
    expect(prefilterRepository(makeRepo({ description: 'app' })).passed).toBe(false);
  });
});
