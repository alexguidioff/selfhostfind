'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

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
    // Fire-and-forget search-log POST. We deliberately do not await it: the navigation
    // must not be delayed by logging, and a server error must not block the search.
    // The server-side guard (SEARCH_LOG_ENABLED=false) returns 204 immediately anyway.
    void fetch('/api/search-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: trimmed, filters: filterParams(params) }),
      keepalive: true,
    }).catch(() => { /* logging failure never blocks navigation */ });
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
    </form>
  );
}

// Returns just the filters the search-log API cares about. Whitelisting here avoids
// accidentally including ?sort= or ?page= in the stored signature — those don't change
// what's in the catalog, only how results are ordered, so they aren't a signal.
const LOGGED_FILTER_KEYS = ['category', 'docker', 'compose', 'arm64', 'nas', 'verified', 'database', 'minStars', 'updated'];
function filterParams(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of LOGGED_FILTER_KEYS) {
    const v = params.get(key);
    if (v) out[key] = v;
  }
  return out;
}
