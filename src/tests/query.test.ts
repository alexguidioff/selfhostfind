import { describe, it, expect } from 'vitest';
import { buildApplicationWhere, buildOrderBy, normalizeSearch, pageNumber, hasActiveFilters } from '@/lib/query';

describe('buildApplicationWhere', () => {
  it('always excludes hidden, non-self-hosted, and unreachable (deleted/transferred) entries', () => {
    const where = buildApplicationWhere({});
    expect(where.hidden).toBe(false);
    expect(where.isSelfHosted).toBe(true);
    expect(where.repository).toEqual({ unreachable: false });
  });

  it('normalizes discovery phrases and recognizes sort-only navigation', () => {
    expect(normalizeSearch(' Alternative to GOOGLE   Photos ')).toBe('google photos');
    expect(normalizeSearch('self-hosted notes')).toBe('notes');
    expect(hasActiveFilters({ sort: 'newest' })).toBe(true);
    expect(hasActiveFilters({})).toBe(false);
    expect(pageNumber({ page: '-1' })).toBe(1);
    expect(pageNumber({ page: 'Infinity' })).toBe(1);
    expect(pageNumber({ page: '2' })).toBe(2);
  });

  it('maps boolean filter toggles to Prisma equality filters', () => {
    const where = buildApplicationWhere({ docker: '1', compose: '1', arm64: '1', nas: '1' });
    expect(where.dockerSupported).toBe(true);
    expect(where.composeSupported).toBe(true);
    expect(where.arm64Supported).toBe(true);
    expect(where.isNasFriendly).toBe(true);
  });

  it('treats database=none as unknown database requirements', () => {
    const where = buildApplicationWhere({ database: 'none' });
    expect(where.databases).toEqual({ equals: [] });
  });

  it('filters by minimum stars via the related repository, without dropping the unreachable filter', () => {
    const where = buildApplicationWhere({ minStars: '100' });
    expect(where.repository).toEqual({ unreachable: false, stars: { gte: 100 } });
  });

  it('ignores a non-numeric minStars value rather than throwing', () => {
    const where = buildApplicationWhere({ minStars: 'abc' });
    expect(where.repository).toEqual({ unreachable: false });
  });

  it('combines minStars and updated filters on the same repository clause', () => {
    const where = buildApplicationWhere({ minStars: '50', updated: '30' });
    expect(where.repository).toMatchObject({ unreachable: false, stars: { gte: 50 } });
    expect((where.repository as any).pushedAt.gte).toBeInstanceOf(Date);
  });
});

describe('buildOrderBy', () => {
  it('defaults to health score', () => {
    expect(buildOrderBy(undefined)).toEqual([{ healthScore: 'desc' }]);
  });

  it('supports trending, newest, updated and stars sorts', () => {
    expect(buildOrderBy('trending')).toEqual([{ growthScore: 'desc' }, { healthScore: 'desc' }]);
    expect(buildOrderBy('newest')).toEqual([{ createdAt: 'desc' }]);
    expect(buildOrderBy('updated')).toEqual([{ repository: { pushedAt: 'desc' } }]);
    expect(buildOrderBy('stars')).toEqual([{ repository: { stars: 'desc' } }]);
  });
});
