import Link from 'next/link';
import { getAlternativeProducts } from '@/lib/alternatives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Find self-hosted alternatives', alternates: { canonical: '/alternatives' } };

export default async function AlternativesPage() {
  const products = await getAlternativeProducts();
  return <div>
    <h1 className="text-3xl font-bold mb-3">Find an alternative to…</h1>
    <p className="text-slate-500 mb-6">Choose the service you want to replace. Listings may cover different features; compare before installing.</p>
    {products.length === 0 && <p>No alternatives have been identified yet.</p>}
    <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {products.map((product) => <li key={product.slug}>
        <Link href={`/alternatives/${product.slug}`} className="block rounded-lg border border-slate-300 dark:border-slate-700 p-4 hover:border-brand-500">
          <span className="font-medium">{product.name}</span>
          <span className="block text-sm text-slate-500">{product.count} {product.count === 1 ? 'alternative' : 'alternatives'}</span>
        </Link>
      </li>)}
    </ul>
  </div>;
}
