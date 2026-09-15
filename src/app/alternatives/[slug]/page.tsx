import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAlternativeProducts } from '@/lib/alternatives';
import { getCatalogPage } from '@/lib/catalog';
import type { SearchParams } from '@/lib/query';
import { AppCard } from '@/components/AppCard';
import { Pagination } from '@/components/Pagination';
import { SearchBar } from '@/components/SearchBar';
import { FilterBar } from '@/components/FilterBar';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = (await getAlternativeProducts()).find((item) => item.slug === slug);
  if (!product) return {};
  return { title: `Self-hosted alternatives to ${product.name}`,
    description: `Compare self-hosted alternatives to ${product.name}: installation evidence, license and maintenance.`,
    alternates: { canonical: `/alternatives/${product.slug}` } };
}

export default async function AlternativePage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const product = (await getAlternativeProducts()).find((item) => item.slug === slug);
  if (!product) notFound();
  const query = await searchParams;
  const { apps, total, page, pages } = await getCatalogPage(query, { alternativesTo: { hasSome: product.names } });
  return <div>
    <Link className="text-sm underline" href="/alternatives">← All alternatives</Link>
    <h1 className="text-3xl font-bold mt-3 mb-3">Self-hosted alternatives to {product.name}</h1>
    <p className="text-slate-500 mb-6">Alternative relationships may be inferred from project descriptions. Check feature coverage and installation requirements.</p>
    <SearchBar /><FilterBar />
    <p className="text-sm text-slate-500 mb-3">{total} results</p>
    {apps.length === 0 && <p>No applications match these filters.</p>}
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{apps.map((app) => <AppCard key={app.id} app={app} />)}</div>
    <Pagination page={page} pages={pages} params={query} pathname={`/alternatives/${slug}`} />
  </div>;
}
