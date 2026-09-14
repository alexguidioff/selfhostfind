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
    if (value.trim()) next.set('q', value.trim());
    else next.delete('q');
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
