import Link from 'next/link';
import { prisma } from '@/lib/db';

// Live counters in the hero. We count once at render time — no caching — so the numbers
// are honest. With `revalidate = 300` on the homepage, the count can be up to 5 minutes stale.
async function getCounters() {
  const [appCount, categoryCount, dockerCount, armCount, composeCount, nasCount, verifiedCount] = await Promise.all([
    prisma.application.count({ where: { hidden: false } }),
    prisma.application.findMany({
      where: { hidden: false, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    }).then((rows) => rows.length),
    prisma.application.count({
      where: { hidden: false, dockerSupported: true, composeSupported: false },
    }),
    prisma.application.count({ where: { hidden: false, arm64Supported: true } }),
    prisma.application.count({ where: { hidden: false, composeSupported: true } }),
    prisma.application.count({ where: { hidden: false, isNasFriendly: true } }),
    prisma.application.count({
      where: { hidden: false, verificationStatus: { not: 'UNVERIFIED' } },
    }),
  ]);
  return {
    appCount,
    categoryCount,
    dockerCount,
    armCount,
    composeCount,
    nasCount,
    verifiedCount,
  };
}

export async function Hero() {
  const {
    appCount, categoryCount, dockerCount, armCount,
    composeCount, nasCount, verifiedCount,
  } = await getCounters();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://selfhostfind.vercel.app';

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-brand-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 px-6 py-12 sm:px-10 sm:py-16 mb-10">
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-brand-700 dark:text-brand-400 mb-3">
          The self-hosted app catalog
        </p>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-4">
          Find your next self-hosted app<br className="hidden sm:inline" />
          <span className="text-brand-600 dark:text-brand-400"> in 30 seconds.</span>
        </h1>
        <p className="text-lg text-slate-700 dark:text-slate-300 mb-6 max-w-2xl">
          {appCount.toLocaleString()} open-source apps, automatically indexed from GitHub every
          night. Filter by health, license, Docker support, and ARM64 — find a privacy-friendly
          replacement for the SaaS you&apos;re trying to leave.
        </p>
        <div className="flex flex-wrap gap-3 mb-8">
          <Link
            href="/?sort=trending"
            className="inline-flex items-center rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 text-sm font-medium transition-colors"
          >
            See what&apos;s trending →
          </Link>
          <Link
            href="/?sort=newest"
            className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-brand-500 px-5 py-2.5 text-sm font-medium transition-colors"
          >
            Browse new arrivals
          </Link>
          <Link
            href="/category"
            className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-brand-500 px-5 py-2.5 text-sm font-medium transition-colors"
          >
            All categories
          </Link>
        </div>

        <div className="mb-8">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 font-medium">
            Browse by capability
          </p>
          <div className="flex flex-wrap gap-2">
            <Chip href="/tag/docker-compose" count={composeCount} dotClass="bg-sky-500">Docker Compose</Chip>
            <Chip href="/tag/arm64" count={armCount} dotClass="bg-emerald-500">ARM64 / NAS</Chip>
            <Chip href="/tag/nas-friendly" count={nasCount} dotClass="bg-amber-500">NAS-friendly</Chip>
            <Chip href="/tag/docker" count={dockerCount} dotClass="bg-indigo-500">Docker</Chip>
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Stat label="apps indexed" value={appCount.toLocaleString()} />
          <Stat label="categories" value={categoryCount.toString()} />
          <Stat label="Docker-ready" value={dockerCount.toLocaleString()} />
          <Stat label="ARM64 / NAS" value={armCount.toLocaleString()} />
        </dl>
        <p className="text-xs text-slate-500 mt-4">
          {verifiedCount.toLocaleString()} entries manually reviewed · Data refreshes daily ·
          Catalog: <a href={`${siteUrl}/llms-full.txt`} className="underline" rel="noreferrer">llms-full.txt</a>
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/70 dark:bg-slate-800/70 backdrop-blur px-3 py-2 border border-slate-200/60 dark:border-slate-700/60">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

function Chip({
  href, count, dotClass, children,
}: { href: string; count: number; dotClass: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 hover:border-brand-500 hover:bg-white dark:hover:bg-slate-800 px-3 py-1.5 text-sm font-medium transition-colors"
    >
      <span className={`w-2 h-2 rounded-full ${dotClass}`} aria-hidden="true" />
      {children}
      <span className="text-xs text-slate-500">{count.toLocaleString()}</span>
    </Link>
  );
}
