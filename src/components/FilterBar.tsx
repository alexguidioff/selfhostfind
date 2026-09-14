'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { CATEGORIES, SORT_OPTIONS } from '@/lib/constants';

const DB_OPTIONS = ['SQLite', 'PostgreSQL', 'MySQL', 'MariaDB', 'MongoDB', 'none'];
const UPDATED_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last year' },
];

export function FilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  function toggle(key: string) {
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    if (next.get(key) === '1') next.delete(key);
    else next.set(key, '1');
    router.push(`${pathname}?${next.toString()}`);
  }

  const boolActive = (key: string) => params.get(key) === '1';

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
      <select
        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
        aria-label="Category"
        value={params.get('category') ?? ''}
        onChange={(e) => update('category', e.target.value)}
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <select
        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
        aria-label="Database mentioned"
        value={params.get('database') ?? ''}
        onChange={(e) => update('database', e.target.value)}
      >
        <option value="">Any database</option>
        {DB_OPTIONS.map((d) => (
          <option key={d} value={d}>{d === 'none' ? 'Database unknown' : d}</option>
        ))}
      </select>

      <select
        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
        aria-label="Last updated"
        value={params.get('updated') ?? ''}
        onChange={(e) => update('updated', e.target.value)}
      >
        {UPDATED_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
        aria-label="Sort results"
        value={params.get('sort') ?? (params.get('q') ? '' : 'health')}
        onChange={(e) => update('sort', e.target.value)}
      >
        <option value="">Relevance (search)</option>
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => toggle('docker')}
        aria-pressed={boolActive('docker')}
        className={`rounded-full px-3 py-1 border ${boolActive('docker') ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-300 dark:border-slate-700'}`}
      >
        Docker
      </button>
      <button
        type="button"
        onClick={() => toggle('compose')}
        aria-pressed={boolActive('compose')}
        className={`rounded-full px-3 py-1 border ${boolActive('compose') ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-300 dark:border-slate-700'}`}
      >
        Compose
      </button>
      <button
        type="button"
        onClick={() => toggle('arm64')}
        aria-pressed={boolActive('arm64')}
        className={`rounded-full px-3 py-1 border ${boolActive('arm64') ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-300 dark:border-slate-700'}`}
      >
        ARM64 mentioned
      </button>
      <button
        type="button"
        onClick={() => toggle('nas')}
        aria-pressed={boolActive('nas')}
        className={`rounded-full px-3 py-1 border ${boolActive('nas') ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-300 dark:border-slate-700'}`}
      >
        NAS signals
      </button>
      <button
        type="button"
        onClick={() => toggle('verified')}
        aria-pressed={boolActive('verified')}
        className={`rounded-full px-3 py-1 border ${boolActive('verified') ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-300 dark:border-slate-700'}`}
      >
        Verified only
      </button>

      <input
        type="number"
        min={0}
        placeholder="Min stars"
        aria-label="Minimum stars"
        key={params.get('minStars') ?? ''}
        defaultValue={params.get('minStars') ?? ''}
        onBlur={(e) => update('minStars', e.target.value)}
        className="w-28 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
      />
    </div>
  );
}
