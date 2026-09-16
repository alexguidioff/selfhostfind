import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCatalogPage } from '@/lib/catalog';
import { Pagination } from '@/components/Pagination';
import type { SearchParams } from '@/lib/query';
import { AppCard } from '@/components/AppCard';

export const dynamic = 'force-dynamic';

// Capability "tags" — each one corresponds to a boolean column on the Application model.
// These are the most useful long-tail filter dimensions for SEO and discovery (people search
// for "self-hosted apps with Docker Compose" and "self-hosted apps for NAS" all the time).
type Tag = {
  slug: string;
  label: string;
  description: string;
  icon: string; // heroicon-style emoji-free text label
  // Prisma where fragment that selects applications with this capability.
  where: Record<string, unknown>;
};

const TAGS: Tag[] = [
  {
    slug: 'docker-compose',
    label: 'Docker Compose',
    description:
      'Self-hosted apps with a detected Compose file. Check the project’s installation instructions.',
    icon: 'compose',
    where: { composeSupported: true },
  },
  {
    slug: 'docker',
    label: 'Docker',
    description:
      'Apps with a detected Dockerfile and no detected Compose file.',
    icon: 'docker',
    where: { dockerSupported: true, composeSupported: false },
  },
  {
    slug: 'arm64',
    label: 'ARM64',
    description:
      'Apps with ARM64 mentions in their README. Image compatibility and installation have not been tested.',
    icon: 'arm',
    where: { arm64Supported: true },
  },
  {
    slug: 'nas-friendly',
    label: 'NAS-friendly',
    description:
      'Apps with NAS-related signals in their README or topics. Resource requirements and compatibility have not been tested.',
    icon: 'nas',
    where: { isNasFriendly: true },
  },
];

function findTag(slug: string): Tag | undefined {
  return TAGS.find((t) => t.slug === slug);
}

export async function generateStaticParams() {
  return TAGS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tag = findTag(slug);
  if (!tag) return {};
  const title = `Self-hosted apps: ${tag.label}`;
  return {
    title,
    description: tag.description,
    alternates: { canonical: `/tag/${tag.slug}` },
    openGraph: { title, description: tag.description, type: 'website' },
  };
}

export default async function TagPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const { slug } = await params;
  const tag = findTag(slug);
  if (!tag) notFound();

  const query = await searchParams;
  const { apps, total, page, pages } = await getCatalogPage(query, tag.where);

  return (
    <div>
      <header className="mb-6">
        <p className="text-sm text-brand-600 dark:text-brand-400 font-medium mb-1">Tag</p>
        <h1 className="text-3xl font-bold tracking-tight mb-2">{tag.label} self-hosted apps</h1>
        <p className="text-slate-600 dark:text-slate-400 max-w-2xl">{tag.description}</p>
        <p className="text-sm text-slate-500 mt-2">
          {total} {total === 1 ? 'app' : 'apps'} found.
        </p>
      </header>

      {apps.length === 0 ? (
        <p className="text-sm text-slate-500">
          No apps in this category yet — check back after the next daily catalog update.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {apps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}

      <Pagination page={page} pages={pages} params={query} pathname={`/tag/${slug}`} />

      <div className="text-sm text-slate-500 mt-8 flex gap-4">
        <Link href="/" className="underline">← Home</Link>
        <Link href="/category" className="underline">All categories</Link>
      </div>
    </div>
  );
}
