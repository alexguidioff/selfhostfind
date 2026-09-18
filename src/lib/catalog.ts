import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { buildApplicationWhere, buildOrderBy, normalizeSearch, pageNumber, PAGE_SIZE, str, trendingFilter, type SearchParams } from './query';

export async function getCatalogPage(params: SearchParams, scope: Prisma.ApplicationWhereInput = {}) {
  const q = normalizeSearch(str(params, 'q') ?? '');
  // Scalar-list filters have no insensitive mode. Bind the phrase as a SQL parameter.
  const alternatives = q ? await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Application"
    WHERE EXISTS (SELECT 1 FROM unnest("alternativesTo") AS product
      WHERE lower(regexp_replace(trim(product), '[[:space:]]+', ' ', 'g')) = ${q})
  ` : [];
  const ids = alternatives.map((app) => app.id);
  const sort = str(params, 'sort');
  const trendingWhere = trendingFilter(sort);
  const where: Prisma.ApplicationWhereInput = {
    AND: [buildApplicationWhere(params, ids), scope, ...(trendingWhere ? [trendingWhere] : [])],
  };
  const exact: Prisma.ApplicationWhereInput = { OR: [
    { name: { equals: q, mode: 'insensitive' } }, { id: { in: ids } },
  ] };
  const prioritizeExact = Boolean(q) && !sort;
  const orderBy = [...buildOrderBy(sort), { id: 'asc' as const }];
  return prisma.$transaction(async (tx) => {
    const total = await tx.application.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(pageNumber(params), pages);
    const skip = (page - 1) * PAGE_SIZE;
    if (!prioritizeExact) {
      const apps = await tx.application.findMany({ where, orderBy, include: { repository: { omit: { readmeExcerpt: true } } }, skip, take: PAGE_SIZE });
      return { apps, total, page, pages };
    }
    const exactWhere = { AND: [where, exact] };
    const exactCount = await tx.application.count({ where: exactWhere });
    const first = skip < exactCount ? await tx.application.findMany({
      where: exactWhere, orderBy, include: { repository: { omit: { readmeExcerpt: true } } }, skip, take: PAGE_SIZE,
    }) : [];
    const rest = first.length < PAGE_SIZE ? await tx.application.findMany({
      where: { AND: [where, { NOT: exact }] }, orderBy, include: { repository: { omit: { readmeExcerpt: true } } },
      skip: Math.max(0, skip - exactCount), take: PAGE_SIZE - first.length,
    }) : [];
    return { apps: [...first, ...rest], total, page, pages };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
