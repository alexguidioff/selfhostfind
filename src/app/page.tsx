import { getCatalogPage } from '@/lib/catalog';
import { Pagination } from '@/components/Pagination';
import type { AppWithRepo } from '@/lib/types';
import { prisma } from '@/lib/db';
import { buildApplicationWhere, hasActiveFilters, type SearchParams } from '@/lib/query';
import { AppCard } from '@/components/AppCard';
import { FilterBar } from '@/components/FilterBar';
import { SearchBar } from '@/components/SearchBar';
import { Hero } from '@/components/Hero';
import { WebsiteStructuredData } from '@/components/StructuredData';

export const revalidate = 300; // catalog data changes at most daily; 5 min cache is plenty

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filtering = hasActiveFilters(params);

  if (filtering) {
    const { apps, total, page, pages } = await getCatalogPage(params);

    return (
      <div>
        <WebsiteStructuredData />
        <SearchBar />
        <FilterBar />
        <p className="text-sm text-slate-500 mb-3">{total} results</p>
        <Grid apps={apps} />
        <Pagination page={page} pages={pages} params={params} />
      </div>
    );
  }

  // Built from buildApplicationWhere so every section shares the same base exclusions
  // (hidden, non-self-hosted, and repos the reconcile job found deleted/unreachable) — these
  // sections used to build their own inline `where` objects, which meant a filter added to
  // buildApplicationWhere silently didn't apply here. Not anymore.
  const baseWhere = buildApplicationWhere({});

  // Trending is a 30-day ranking (per the growth-score contract in scoring.ts), not a
  // weekly one — the old label was misleading. New applications without a 30-day
  // snapshot history are filtered out instead of being promoted with growthScore=0.
  const trendingWhere = { ...baseWhere, NOT: { growthScoreSource: 'insufficient-history' } };

  const [trending, newest, promising, updated] = await Promise.all([
    prisma.application.findMany({
      where: trendingWhere,
      orderBy: [{ growthScore: 'desc' }, { healthScore: 'desc' }],
      include: { repository: true },
      take: 8,
    }),
    prisma.application.findMany({
      where: baseWhere,
      orderBy: { createdAt: 'desc' },
      include: { repository: true },
      take: 8,
    }),
    prisma.application.findMany({
      where: { ...baseWhere, repository: { ...(baseWhere.repository as object), stars: { lt: 500 } } },
      orderBy: { healthScore: 'desc' },
      include: { repository: true },
      take: 8,
    }),
    prisma.application.findMany({
      where: baseWhere,
      orderBy: { repository: { pushedAt: 'desc' } },
      include: { repository: true },
      take: 8,
    }),
  ]);

  return (
    <div>
      <WebsiteStructuredData />
      <Hero />
      <SearchBar />
      <FilterBar />
      <Section title="Trending this month" apps={trending} />
      <Section title="New applications" apps={newest} />
      <Section title="Promising projects" apps={promising} />
      <Section title="Recently updated" apps={updated} />
    </div>
  );
}

function Section({ title, apps }: { title: string; apps: AppWithRepo[] }) {
  if (apps.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <Grid apps={apps} />
    </section>
  );
}

function Grid({ apps }: { apps: AppWithRepo[] }) {
  if (apps.length === 0) {
    return <p className="text-sm text-slate-500">No applications match these filters yet.</p>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {apps.map((app) => (
        <AppCard key={app.id} app={app} />
      ))}
    </div>
  );
}
