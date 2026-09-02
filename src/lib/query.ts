import type { Prisma } from '@prisma/client';

export type SearchParams = { [key: string]: string | string[] | undefined };

function str(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

// Builds the Prisma filter for the catalog grid from URL search params. Free-text search
// (?q=) matches name/description/category/alternativesTo so phrases like "alternative to
// splitwise" or "self-hosted notes" work without a separate full-text search engine for v1.
export function buildApplicationWhere(params: SearchParams): Prisma.ApplicationWhereInput {
  const where: Prisma.ApplicationWhereInput = {
    hidden: false,
    isSelfHosted: true,
    // A repo the `reconcile` job found deleted (or transferred somewhere unreachable) stays
    // in the database for audit purposes, but never shows in the public catalog.
    repository: { unreachable: false },
  };

  const q = str(params, 'q');
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { shortDescription: { contains: q, mode: 'insensitive' } },
      { category: { contains: q, mode: 'insensitive' } },
      { subcategory: { contains: q, mode: 'insensitive' } },
      { alternativesTo: { has: q } },
      { alternativesTo: { hasSome: q.split(/\s+/) } },
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
  if (minStars && !Number.isNaN(Number(minStars))) {
    where.repository = { ...(where.repository as object), stars: { gte: Number(minStars) } };
  }

  const updated = str(params, 'updated');
  if (updated && !Number.isNaN(Number(updated))) {
    const since = new Date(Date.now() - Number(updated) * 24 * 60 * 60 * 1000);
    where.repository = { ...(where.repository as object), pushedAt: { gte: since } };
  }

  return where;
}

export function buildOrderBy(sort: string | undefined): Prisma.ApplicationOrderByWithRelationInput[] {
  switch (sort) {
    case 'trending':
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
