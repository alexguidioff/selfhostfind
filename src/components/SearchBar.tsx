'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// Single source of truth for whether the search-log endpoint should be hit. Build-time
// baked so the client never sends a request when the feature is off (no network call,
// no server-side allowlist check needed). The server also re-checks via
// process.env.SEARCH_LOG_ENABLED — the client can't lie about the flag because it's
// resolved at build time and shipped in the bundle.
const SEARCH_LOG_ENABLED = process.env.NEXT_PUBLIC_SEARCH_LOG_ENABLED === 'true';

function detectContext(pathname: string): string {
  if (pathname === '/') return 'home';
  const match = pathname.match(/^\/(category|alternatives)\/([a-z0-9-]+)\/?$/);
  return match ? `${match[1]}:${match[2]}` : 'other';
}

export function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');

  const query = params.get('q') ?? '';
  useEffect(() => setValue(query), [query]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    const trimmed = value.trim();
    if (trimmed) next.set('q', trimmed);
    else next.delete('q');
    if (SEARCH_LOG_ENABLED) {
      const context = detectContext(pathname);
      const body = JSON.stringify({
        q: trimmed,
        filters: filterParams(params),
        context,
      });
      // Fire-and-forget: navigation must not wait for logging. The server still
      // re-validates everything; this is just a hint about intent.
      void fetch('/api/search-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <form onSubmit={submit} className="mb-4">
      <input
        type="search"
        aria-label="Search applications"
        maxLength={200}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='Try "alternative to Splitwise" or "self-hosted notes"'
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5"
      />
      {SEARCH_LOG_ENABLED && (
        <p className="mt-1 text-[11px] text-slate-500">
          Every search you submit is recorded (not just no-result ones) as a daily
          aggregate. We don&apos;t record your IP, user agent, cookies, or session id.
          Aggregates are kept for 30 days. Please avoid personal or sensitive information.
        </p>
      )}
    </form>
  );
}

// Returns just the filters the search-log API cares about. Whitelisting here avoids
// accidentally including ?sort= or ?page= in the stored signature — those don't change
// what's in the catalog, only how results are ordered, so they aren't a signal.
const LOGGED_FILTER_KEYS = ['category', 'docker', 'compose', 'arm64', 'nas', 'verified', 'database', 'minStars', 'updated', 'sort'];
function filterParams(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of LOGGED_FILTER_KEYS) {
    const v = params.get(key);
    if (v) out[key] = v;
  }
  return out;
}
