import type { Prisma } from '@prisma/client';

export type SearchParams = { [key: string]: string | string[] | undefined };

export function str(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
    .replace(/^alternatives? to\s+/, '')
    .replace(/^self[- ]?hosted\s+/, '').trim().slice(0, 200);
}

export const PAGE_SIZE = 60;

export function pageNumber(params: SearchParams): number {
  const page = Number(str(params, 'page'));
  return Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1;
}

export function hasActiveFilters(params: SearchParams): boolean {
  return ['q', 'sort', 'page', 'category', 'docker', 'compose', 'arm64', 'nas', 'verified', 'database', 'minStars', 'updated']
    .some((key) => Boolean(str(params, key)));
}

// Builds the Prisma filter for the catalog grid from URL search params. Free-text search
// (?q=) matches normalized words and case-insensitive alternative IDs from getCatalogPage.
export function buildApplicationWhere(params: SearchParams, alternativeIds: string[] = []): Prisma.ApplicationWhereInput {
  const where: Prisma.ApplicationWhereInput = {
    hidden: false,
    isSelfHosted: true,
    // A repo the `reconcile` job found deleted (or transferred somewhere unreachable) stays
    // in the database for audit purposes, but never shows in the public catalog.
    repository: { unreachable: false },
  };

  const q = normalizeSearch(str(params, 'q') ?? '');
  if (q) {
    // All meaningful words must match, but may occur in different fields.
    where.OR = [
      { id: { in: alternativeIds } },
      { AND: q.split(' ').map((word) => ({ OR: [
        { name: { contains: word, mode: 'insensitive' as const } },
        { shortDescription: { contains: word, mode: 'insensitive' as const } },
        { category: { contains: word, mode: 'insensitive' as const } },
        { subcategory: { contains: word, mode: 'insensitive' as const } },
      ] })) },
    ];
  }

  const category = str(params, 'category');
  if (category) where.category = category;

  if (str(params, 'docker') === '1') where.dockerSupported = true;
  if (str(params, 'compose') === '1') where.composeSupported = true;
  if (str(params, 'arm64') === '1') where.arm64Supported = true;
  if (str(params, 'nas') === '1') where.isNasFriendly = true;
  if (str(params, 'verified') === '1') where.verificationStatus = { not: 'UNVERIFIED' };

  const database = str(params, 'database');
  if (database === 'none') where.databases = { equals: [] };
  else if (database) where.databases = { has: database };

  const minStars = str(params, 'minStars');
  if (minStars && Number.isSafeInteger(Number(minStars)) && Number(minStars) >= 0 && Number(minStars) <= 2147483647) {
    where.repository = { ...(where.repository as object), stars: { gte: Number(minStars) } };
  }

  const updated = str(params, 'updated');
  if (updated && Number.isSafeInteger(Number(updated)) && Number(updated) > 0 && Number(updated) <= 36500) {
    const since = new Date(Date.now() - Number(updated) * 24 * 60 * 60 * 1000);
    where.repository = { ...(where.repository as object), pushedAt: { gte: since } };
  }

  return where;
}

export function buildOrderBy(sort: string | undefined): Prisma.ApplicationOrderByWithRelationInput[] {
  switch (sort) {
    case 'trending':
      // The "trending" sort uses growthScore (a 30-day delta) and is only meaningful for
      // repositories that actually have enough snapshot history. The accompanying filter
      // excludes rows still labeled 'insufficient-history' so a brand-new app with
      // growthScore=0 doesn't sneak into the top of the list just because its real
      // 30-day delta is unknown.
      return [{ growthScore: 'desc' }, { healthScore: 'desc' }];
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'updated':
      return [{ repository: { pushedAt: 'desc' } }];
    case 'stars':
      return [{ repository: { stars: 'desc' } }];
    case 'health':
    default:
      return [{ healthScore: 'desc' }];
  }
}

// Filter applied on top of buildApplicationWhere when the user explicitly asks for the
// trending sort. App rows with growthScoreSource='insufficient-history' can't be ranked
// honestly against the others, so we drop them from the result set rather than silently
// promoting them at random.
export function trendingFilter(sort: string | undefined): Prisma.ApplicationWhereInput | null {
  if (sort !== 'trending') return null;
  return { NOT: { growthScoreSource: 'insufficient-history' } };
}
