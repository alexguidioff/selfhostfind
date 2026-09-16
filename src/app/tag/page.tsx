import { buildApplicationWhere } from '@/lib/query';
import Link from 'next/link';
import { prisma } from '@/lib/db';

// Query the deployed database at request time, not while building the image.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Browse by capability',
  description:
    'Filter the self-hosted catalog by capability: Docker Compose, ARM64, NAS-friendly, plain Docker.',
  alternates: { canonical: '/tag' },
};

const TAGS: { slug: string; label: string; description: string; where: Record<string, unknown> }[] = [
  { slug: 'docker-compose', label: 'Docker Compose', description: 'A Compose file was detected.', where: { composeSupported: true } },
  { slug: 'docker', label: 'Docker', description: 'A Dockerfile was detected, without Compose.', where: { dockerSupported: true, composeSupported: false } },
  { slug: 'arm64', label: 'ARM64', description: 'ARM64 mentioned in the README; not installation-tested.', where: { arm64Supported: true } },
  { slug: 'nas-friendly', label: 'NAS-friendly', description: 'NAS-related mentions; check hardware requirements.', where: { isNasFriendly: true } },
];

export default async function TagIndex() {
  const counts = await Promise.all(
    TAGS.map(async (t) => ({
      ...t,
      count: await prisma.application.count({
        where: { ...buildApplicationWhere({}), repository: { unreachable: false }, ...t.where },
      }),
    })),
  );
  const visible = counts.filter((c) => c.count > 0);

  return (
    <div>
      <header className="mb-6">
        <p className="text-sm text-brand-600 dark:text-brand-400 font-medium mb-1">All capabilities</p>
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Browse self-hosted apps by capability
        </h1>
        <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
          Filter the catalog by what the app ships with: Docker Compose for easy setup, ARM64
          for NAS devices, and lightweight stacks for low-RAM boxes.
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visible.map((t) => (
          <li key={t.slug}>
            <Link
              href={`/tag/${t.slug}`}
              className="group flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-brand-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 px-4 py-3 transition-colors"
            >
              <span className="flex-1 min-w-0">
                <span className="block font-medium">{t.label}</span>
                <span className="block text-xs text-slate-500">{t.description}</span>
              </span>
              <span className="text-sm text-slate-500">
                {t.count.toLocaleString()}
              </span>
              <span aria-hidden="true" className="text-slate-400 group-hover:text-brand-500 transition-colors">→</span>
            </Link>
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="text-sm text-slate-500">
          No capability data yet — the catalog fills up after the first daily update.
        </p>
      )}
    </div>
  );
}
