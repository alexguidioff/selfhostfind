import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { CATEGORIES } from '@/lib/constants';
import { AppCard } from '@/components/AppCard';
import { CategoryIcon } from '@/components/CategoryIcon';

export const revalidate = 300;

// Map a URL slug back to its display name ("media" → "Media", "home-automation" → "Home Automation").
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}
function unslugify(slug: string): string | undefined {
  return CATEGORIES.find((c) => slugify(c) === slug);
}

export async function generateStaticParams() {
  // Pre-render every category at build time. With 16 categories, this is cheap and gives
  // search engines a fully-rendered HTML to index.
  return CATEGORIES.map((c) => ({ slug: slugify(c) }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = unslugify(slug);
  if (!name) return {};
  const title = `Self-hosted ${name} apps`;
  const description = `Browse the best open-source, self-hosted ${name.toLowerCase()} apps. ` +
    `Filter by Docker support, ARM64, license — automatically indexed from GitHub.`;
  return {
    title,
    description,
    alternates: { canonical: `/category/${slug}` },
    openGraph: { title, description, type: 'website' },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = unslugify(slug);
  if (!name) notFound();

  const apps = await prisma.application.findMany({
    where: {
      hidden: false,
      category: name,
      repository: { unreachable: false },
    },
    include: { repository: true },
    orderBy: { healthScore: 'desc' },
    take: 60,
  });

  return (
    <div>
      <header className="mb-6 flex items-start gap-4">
        <span className="shrink-0 w-12 h-12 rounded-lg bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 flex items-center justify-center">
          <CategoryIcon name={name} className="w-6 h-6" />
        </span>
        <div>
          <p className="text-sm text-brand-600 dark:text-brand-400 font-medium mb-1">Category</p>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Self-hosted {name} apps
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
            {apps.length} {apps.length === 1 ? 'project' : 'projects'} found in the{' '}
            <strong>{name}</strong> category. Sorted by health score.
          </p>
        </div>
      </header>

      {apps.length === 0 ? (
        <p className="text-sm text-slate-500">No apps in this category yet — check back after the next daily catalog update.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {apps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}

      <p className="text-sm text-slate-500 mt-8">
        <a href="/" className="underline">← All categories</a>
      </p>
    </div>
  );
}
