import Link from 'next/link';
import { prisma } from '@/lib/db';
import { buildApplicationWhere, type SearchParams } from '@/lib/query';
import { architectureValue, comparisonSlugs, maintenanceValue } from '@/lib/comparison';
import { composeUrl, evidenceLabel } from '@/lib/evidence';
import type { AppWithRepo } from '@/lib/types';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compare self-hosted apps', robots: { index: false, follow: true }, alternates: { canonical: '/compare' } };

export default async function ComparePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const slugs = comparisonSlugs(await searchParams);
  const where = buildApplicationWhere({});
  // ponytail: native selects load catalog names; use server-side search if thousands of options become unwieldy.
  const [choices, selected] = await Promise.all([
    prisma.application.findMany({ where, select: { slug: true, name: true }, orderBy: [{ name: 'asc' }, { slug: 'asc' }] }),
    prisma.application.findMany({ where: { ...where, slug: { in: slugs } }, include: { repository: { omit: { readmeExcerpt: true } } } }),
  ]);
  const apps = slugs.flatMap((slug) => selected.filter((app) => app.slug === slug));
  const rows: { label: string; field?: string; value: (app: AppWithRepo) => ReactNode }[] = [
    { label: 'Category', field: 'category', value: (app) => app.category ?? 'Unknown' },
    { label: 'License', value: (app) => app.repository.license ?? 'Unknown' },
    { label: 'Docker', field: 'dockerSupported', value: (app) => app.dockerSupported ? 'Detected' : 'Not detected' },
    { label: 'Compose', field: 'composeSupported', value: (app) => app.composeSupported ? <a href={composeUrl(app)} className="underline" target="_blank" rel="noreferrer">{app.composePath ?? 'Detected; open repository'}</a> : 'Not detected' },
    { label: 'ARM64', field: 'arm64Supported', value: (app) => architectureValue(app.arm64Supported) },
    { label: 'AMD64', field: 'amd64Supported', value: (app) => architectureValue(app.amd64Supported) },
    { label: 'Databases', field: 'databases', value: (app) => app.databases.join(', ') || 'Unknown' },
    { label: 'Maintenance', value: maintenanceValue },
    { label: 'Last activity', value: (app) => app.repository.pushedAt.toISOString().slice(0, 10) },
    { label: 'Latest release', value: (app) => app.repository.latestReleaseTag ? `${app.repository.latestReleaseTag} (${app.repository.latestReleaseAt?.toISOString().slice(0, 10) ?? 'date unknown'})` : 'Unknown' },
    { label: 'Documentation', value: (app) => app.documentationUrl ? <a href={app.documentationUrl} target="_blank" rel="noreferrer" className="underline">Documentation →</a> : 'Not detected' },
    { label: 'Review', value: (app) => app.verificationStatus === 'MANUALLY_VERIFIED' ? 'Manually reviewed' : app.verificationStatus === 'AUTO_VERIFIED' ? 'Automatically checked' : 'Unverified' },
    { label: 'Last analyzed', value: (app) => app.repository.lastScannedAt?.toISOString().slice(0, 10) ?? 'Unknown' },
  ];
  return <div>
    <h1 className="text-3xl font-bold mb-3">Compare self-hosted apps</h1>
    <p className="text-slate-500 mb-6">Choose two or three apps. Share the resulting URL to share your comparison.</p>
    <form action="/compare" method="get" className="grid sm:grid-cols-3 gap-3 mb-6">
      {[0, 1, 2].map((index) => <label key={index} className="text-sm">App {index + 1}{index === 2 ? ' (optional)' : ''}
        <select name="app" defaultValue={apps[index]?.slug ?? ''} required={index < 2} className="block w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 mt-1">
          <option value="">Choose an app</option>
          {choices.map((app) => <option key={app.slug} value={app.slug}>{app.name} ({app.slug})</option>)}
        </select>
      </label>)}
      <div className="sm:col-span-3 flex gap-4 items-center">
        <button type="submit" className="rounded bg-brand-600 text-white px-4 py-2">Compare</button>
        <Link href="/compare" className="text-sm underline">Clear</Link>
      </div>
    </form>
    {slugs.length > apps.length && <p role="status" className="mb-4">Some selected apps are no longer available in the public catalog.</p>}
    {apps.length < 2 ? <p>Select at least two different applications to compare.</p> : <>
      <p className="text-sm text-slate-500 mb-3">Reported compatibility is not an installation test. Unknown means we have no reliable evidence.</p>
      <div className="overflow-x-auto" role="region" aria-label="Application comparison" tabIndex={0}>
        <table className="w-full text-sm border-collapse">
          <caption className="sr-only">Comparison of {apps.map((app) => app.name).join(', ')}</caption>
          <thead><tr><th scope="col" className="p-3 text-left">Feature</th>{apps.map((app) => <th key={app.id} scope="col" className="p-3 text-left min-w-56"><Link href={`/apps/${app.slug}`} className="text-brand-500 underline">{app.name}</Link></th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label} className="border-t border-slate-200 dark:border-slate-800">
            <th scope="row" className="p-3 text-left align-top whitespace-nowrap">{row.label}</th>
            {apps.map((app) => <td key={app.id} className="p-3 align-top break-words">{row.value(app)}{row.field && <span className="block text-xs text-slate-500 mt-1">{evidenceLabel(app, row.field)}</span>}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </div>;
}
