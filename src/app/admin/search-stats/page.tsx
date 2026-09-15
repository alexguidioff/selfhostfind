import { redirect } from 'next/navigation';
import { isAdminAuthenticated } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SignOutButton } from '../SignOutButton';
import { isEnabled as searchLogEnabled } from '@/lib/search-log';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

// Admin-only table of zero-result searches aggregated over the last 30 days.
// Intentionally bare: no chart, no export, no drill-down. The point is to spot
// "this search gets nothing" signals fast and follow up by hand.
export default async function SearchStatsPage() {
  if (!(await isAdminAuthenticated())) redirect('/admin/login');
  if (!searchLogEnabled()) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Admin — search stats</h1>
          <SignOutButton />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 p-4">
          Search logging is disabled. Set <code className="font-mono">SEARCH_LOG_ENABLED=true</code> to
          start collecting zero-result aggregates. No events are recorded until then.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/admin" className="underline">← Back to admin</Link>
        </p>
      </div>
    );
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.searchAggregate.findMany({
    where: { dayUtc: { gte: since } },
    orderBy: [{ dayUtc: 'desc' }, { searchCount: 'desc' }],
  });

  // Group by normalized query + filter signature so the user can see patterns, not raw
  // daily buckets. Sum across days gives the 30-day picture.
  type Agg = {
    query: string; context: string; filters: string; searches: number; zero: number;
    days: number; lastSeen: Date;
  };
  const grouped = new Map<string, Agg>();
  for (const r of rows) {
    const key = JSON.stringify([r.normalizedQuery, r.filterSignature, r.context]);
    const existing = grouped.get(key);
    if (existing) {
      existing.searches += r.searchCount;
      existing.zero += r.zeroResultCount;
      existing.days += 1;
      if (r.dayUtc > existing.lastSeen) existing.lastSeen = r.dayUtc;
    } else {
      grouped.set(key, {
        query: r.normalizedQuery,
        context: r.context,
        filters: r.filterSignature || '(no filters)',
        searches: r.searchCount,
        zero: r.zeroResultCount,
        days: 1,
        lastSeen: r.dayUtc,
      });
    }
  }
  const flat = [...grouped.values()].sort((a, b) => b.searches - a.searches);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Admin — search stats (last 30 days)</h1>
        <SignOutButton />
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Aggregated from explicit form submits. Typing, prefetch, pagination, and filter-only
        changes do not increment. The server re-runs the search to count zero-result
        occurrences: the client never tells us when a search has nothing to show.
      </p>

      <h2 className="text-sm font-semibold mt-6 mb-2">Unfiltered queries</h2>
      <p className="text-xs text-slate-500 mb-2">
        These are the strongest &ldquo;the catalog is missing something&rdquo; signals: a search hits
        the full catalog and finds nothing.
      </p>
      <StatsTable rows={flat.filter((r) => r.filters === '(no filters)' && r.context === 'home')} />

      <h2 className="text-sm font-semibold mt-8 mb-2">Filtered queries</h2>
      <p className="text-xs text-slate-500 mb-2">
        A zero-result here can mean the catalog has nothing OR that the filter combination
        is too narrow. Treat these as a starting point for manual investigation, not a
        catalog gap to fill automatically.
      </p>
      <StatsTable rows={flat.filter((r) => r.filters !== '(no filters)' || r.context !== 'home')} />

      <p className="mt-8 text-sm">
        <Link href="/admin" className="underline">← Back to admin</Link>
      </p>
    </div>
  );
}

function StatsTable({ rows }: { rows: Array<{ query: string; context: string; filters: string; searches: number; zero: number; days: number; lastSeen: Date }> }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No data in the last 30 days.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-slate-200 dark:border-slate-800">
        <thead className="bg-slate-50 dark:bg-slate-900 text-left">
          <tr>
            <th className="px-3 py-2">Query</th>
            <th className="px-3 py-2">Context</th>
            <th className="px-3 py-2">Filters</th>
            <th className="px-3 py-2 text-right">Searches</th>
            <th className="px-3 py-2 text-right">Zero</th>
            <th className="px-3 py-2 text-right">% zero</th>
            <th className="px-3 py-2 text-right">Days</th>
            <th className="px-3 py-2">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={JSON.stringify([r.query, r.filters, r.context])} className="border-t border-slate-200 dark:border-slate-800">
              <td className="px-3 py-2 font-mono text-xs">{r.query || '(empty)'}</td>
              <td className="px-3 py-2 text-xs">{r.context}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.filters}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.searches}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.zero}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.searches > 0 ? Math.round((r.zero / r.searches) * 100) : 0}%
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.days}</td>
              <td className="px-3 py-2 text-xs">{r.lastSeen.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
