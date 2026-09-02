import Link from 'next/link';
import { prisma } from '@/lib/db';
import { CATEGORIES } from '@/lib/constants';

export const revalidate = 300;

export const metadata = {
  title: 'All categories',
  description: 'Browse self-hosted apps by category — Media, Backup, Passwords, Productivity, and more.',
  alternates: { canonical: '/category' },
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

export default async function CategoryIndex() {
  // One count query per category, in parallel. With 16 categories this is well within budget.
  const counts = await Promise.all(
    CATEGORIES.map(async (c) => ({
      name: c,
      slug: slugify(c),
      count: await prisma.application.count({
        where: {
          hidden: false,
          category: c,
          repository: { unreachable: false },
        },
      }),
    })),
  );
  // Hide empty categories from the index so the page never shows a dead link.
  const visible = counts.filter((c) => c.count > 0);
  const total = visible.reduce((acc, c) => acc + c.count, 0);

  return (
    <div>
      <header className="mb-6">
        <p className="text-sm text-brand-600 dark:text-brand-400 font-medium mb-1">All categories</p>
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Browse self-hosted apps by category
        </h1>
        <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
          {visible.length} {visible.length === 1 ? 'category' : 'categories'} ·{' '}
          {total.toLocaleString()} {total === 1 ? 'app' : 'apps'} in total. Pick a category
          to see the highest-health options first.
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/category/${c.slug}`}
              className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-brand-500 px-4 py-3 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-slate-500">
                  {c.count.toLocaleString()} {c.count === 1 ? 'app' : 'apps'}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="text-sm text-slate-500">
          No apps have been categorized yet — the catalog fills up after the first daily update.
        </p>
      )}
    </div>
  );
}
