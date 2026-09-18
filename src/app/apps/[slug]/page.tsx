import { composeUrl, evidenceLabel } from '@/lib/evidence';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { Badge } from '@/components/Badge';
import { AppCard } from '@/components/AppCard';
import { AppStructuredData } from '@/components/StructuredData';
import { ReportErrorLink } from '@/components/ReportLinks';
import { HealthBreakdown } from '@/components/HealthBreakdown';
import { timeAgo } from '@/lib/types';

export const revalidate = 300;

export default async function AppDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const app = await prisma.application.findUnique({
    where: { slug },
    include: { repository: true },
  });

  if (!app || app.hidden) notFound();

  const alternatives =
    app.category && app.alternativesTo.length > 0
      ? await prisma.application.findMany({
          where: {
            hidden: false,
            repository: { unreachable: false },
            slug: { not: app.slug },
            OR: [{ category: app.category }, { alternativesTo: { hasSome: app.alternativesTo } }],
          },
          include: { repository: { omit: { readmeExcerpt: true } } },
          orderBy: { healthScore: 'desc' },
          take: 4,
        })
      : [];

  const monthsSincePush = (Date.now() - app.repository.pushedAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
  const maintenanceStatus = monthsSincePush < 3 ? 'Actively maintained' : monthsSincePush < 12 ? 'Maintained' : 'Low activity';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <AppStructuredData app={app} />
      <div className="lg:col-span-2">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 shrink-0 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center text-slate-400">
            {app.logoUrl ? (
              <Image src={app.logoUrl} alt={`${app.name} logo`} width={56} height={56} unoptimized className="object-cover h-full w-full" />
            ) : (
              app.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{app.name}</h1>
            <p className="text-slate-600 dark:text-slate-400 mt-1">{app.shortDescription}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {app.category && <Badge>{app.category}</Badge>}
              {app.subcategory && <Badge>{app.subcategory}</Badge>}
              {app.repository.archived && <Badge variant="archived">Archived upstream</Badge>}
              <Badge variant={app.verificationStatus === 'UNVERIFIED' ? 'unverified' : 'verified'}>
                {app.verificationStatus === 'UNVERIFIED' ? 'Unverified' : app.verificationStatus === 'AUTO_VERIFIED' ? 'Auto-verified' : 'Manually verified'}
              </Badge>
            </div>
          </div>
        </div>

        {app.repository.unreachable && (
          <div className="mt-4 rounded border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-300">
            This repository could no longer be found on GitHub as of{' '}
            {app.repository.lastVerifiedAt ? timeAgo(app.repository.lastVerifiedAt) : 'the last check'} — it may have
            been deleted or made private. The information below reflects the last known state and may be out of date;
            the GitHub link may no longer work.
          </div>
        )}

        {!app.repository.unreachable && app.repository.archived && (
          <div className="mt-4 rounded border border-orange-300 bg-orange-50 dark:bg-orange-950 dark:border-orange-800 p-3 text-sm text-orange-800 dark:text-orange-300">
            This repository is archived on GitHub — it still works as software, but the
            upstream project is no longer actively maintained.
          </div>
        )}

        {app.verificationStatus === 'UNVERIFIED' && (
          <div className="mt-4 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
            This listing was discovered and classified automatically (confidence{' '}
            {Math.round(app.classificationConfidence * 100)}%, source: {app.classificationSource}) and has not been
            manually reviewed. Some details below may be inaccurate.
          </div>
        )}

        {app.screenshotUrls.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-2">
            {app.screenshotUrls.map((url, idx) => (
              <Image key={url} src={url} alt={`${app.name} screenshot ${idx + 1}`} width={480} height={300} unoptimized className="rounded border border-slate-200 dark:border-slate-800 object-cover w-full h-40" />
            ))}
          </div>
        )}

        {app.repository.readmeExcerpt && (
          <div className="mt-6">
            <h2 className="font-semibold mb-2">About</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-line line-clamp-[12]">
              {app.repository.readmeExcerpt.slice(0, 1200)}
            </p>
          </div>
        )}

        {app.composeSupported && (
          <div className="mt-6">
            <h2 className="font-semibold mb-2">Installation</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
              A Compose file was detected. Review the upstream instructions; installation has not been tested.
            </p>
            <a
              href={composeUrl(app)}
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 dark:text-brand-500 text-sm underline"
            >
              {app.composePath ? `View ${app.composePath} on GitHub →` : 'Open repository for installation instructions →'}
            </a>
          </div>
        )}

        <section className="mt-6 text-sm" aria-labelledby="compatibility-heading">
          <HealthBreakdown
            score={app.healthScore}
            breakdown={app.scoreBreakdown as never}
            algorithmVersion={app.scoreAlgorithmVersion}
            computedAt={app.scoreComputedAt}
            isManualOverride={Boolean((app.manualOverrides as Record<string, boolean> | null)?.healthScore)}
          />
          <h2 id="compatibility-heading" className="font-semibold mb-2 mt-4">Compatibility and evidence</h2>
          <p className="text-slate-500 mb-3">
            Last analyzed: {app.repository.lastScannedAt?.toISOString().slice(0, 10) ?? 'Unknown'}.
            Automatic checks do not test installation or hardware compatibility.
          </p>
          <dl className="grid sm:grid-cols-2 gap-4">
            {([
              ['databases', 'Databases', app.databases.join(', ') || 'Unknown'],
              ['arm64Supported', 'ARM64', app.arm64Supported == null ? 'Unknown' : app.arm64Supported ? 'Reported' : 'Reported unsupported'],
              ['amd64Supported', 'AMD64', app.amd64Supported == null ? 'Unknown' : app.amd64Supported ? 'Reported' : 'Reported unsupported'],
              ['composeSupported', 'Compose', app.composeSupported ? (app.composePath ?? 'Detected; path unknown') : 'Not detected'],
              ['ports', 'Ports', app.ports.join(', ') || 'Unknown'],
              ['isNasFriendly', 'NAS', app.isNasFriendly ? 'Related signals found' : 'Unknown'],
            ] as const).map(([field, label, value]) => (
              <div key={field}>
                <dt className="font-medium">{label}</dt>
                <dd>{value}<span className="block text-xs text-slate-500">{evidenceLabel(app, field)}</span></dd>
              </div>
            ))}
          </dl>
          <a className="inline-block underline mt-3" href={`${app.repository.repositoryUrl}#readme`} target="_blank" rel="noreferrer">Read upstream evidence →</a>
        </section>

        <p className="mt-6 text-sm text-slate-500">
          Spotted a wrong category, license, or installation detail?{' '}
          <ReportErrorLink appSlug={app.slug} />
        </p>

        {alternatives.length > 0 && (
          <div className="mt-8">
            <h2 className="font-semibold mb-3">Similar / alternatives</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {alternatives.map((a) => (
                <AppCard key={a.id} app={a} />
              ))}
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-sm space-y-2">
          <Row label="Stars">⭐ {app.repository.stars.toLocaleString()}</Row>
          <Row label="Forks">{app.repository.forks.toLocaleString()}</Row>
          <Row label="License">{app.repository.license ?? 'Unknown'}</Row>
          <Row label="Language">{app.repository.primaryLanguage ?? 'Unknown'}</Row>
          <Row label="Last updated">{timeAgo(app.repository.pushedAt)}</Row>
          <Row label="Latest release">
            {app.repository.latestReleaseTag ? `${app.repository.latestReleaseTag} (${timeAgo(app.repository.latestReleaseAt!)})` : 'None'}
          </Row>
          <Row label="Maintenance">{maintenanceStatus}</Row>
          <Row label="Health score">{Math.round(app.healthScore)}/100</Row>
          {app.alternativesTo.length > 0 && <Row label="Alternative to">{app.alternativesTo.join(', ')}</Row>}
        </div>

        <div className="flex flex-col gap-2">
          <Link href={{ pathname: '/compare', query: { app: app.slug } }} className="rounded border border-slate-300 dark:border-slate-700 text-center py-2 text-sm font-medium">Compare with other apps</Link>
          <a href={app.repository.repositoryUrl} target="_blank" rel="noreferrer" className="rounded bg-brand-600 hover:bg-brand-700 text-white text-center py-2 text-sm font-medium">
            View on GitHub
          </a>
          {app.documentationUrl && (
            <a href={app.documentationUrl} target="_blank" rel="noreferrer" className="rounded border border-slate-300 dark:border-slate-700 text-center py-2 text-sm font-medium">
              Documentation
            </a>
          )}
          {app.demoUrl && (
            <a href={app.demoUrl} target="_blank" rel="noreferrer" className="rounded border border-slate-300 dark:border-slate-700 text-center py-2 text-sm font-medium">
              Live demo
            </a>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {app.composeSupported && <Badge variant="docker">Docker Compose</Badge>}
          {!app.composeSupported && app.dockerSupported && <Badge variant="docker">Docker</Badge>}
          {app.arm64Supported && <Badge variant="arm">ARM64 mentioned</Badge>}
          {app.isNasFriendly && <Badge variant="arm">NAS signals</Badge>}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const app = await prisma.application.findUnique({
    where: { slug },
    include: { repository: { omit: { readmeExcerpt: true } } },
  });
  if (!app) return {};
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://selfhostfind.vercel.app';
  const description = app.shortDescription
    ?? `${app.name} is a ${app.category ?? 'self-hosted'} app. Health ${Math.round(app.healthScore)}/100, ⭐ ${app.repository.stars.toLocaleString()} stars on GitHub.`;
  return {
    title: `${app.name} — ${app.category ?? 'self-hosted'}`,
    description,
    alternates: { canonical: `/apps/${app.slug}` },
    openGraph: {
      type: 'website',
      url: `${siteUrl}/apps/${app.slug}`,
      title: `${app.name} — SelfHostFind`,
      description,
      images: app.logoUrl
        ? [{ url: app.logoUrl, alt: `${app.name} logo` }]
        : [{ url: '/og-default.png', width: 1200, height: 630, alt: app.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title: app.name,
      description,
      images: app.logoUrl ? [app.logoUrl] : ['/og-default.png'],
    },
  };
}
