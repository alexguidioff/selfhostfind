'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/Badge';
import type { AppWithRepo } from '@/lib/types';
import { CATEGORIES } from '@/lib/constants';

export function AdminAppRow({ app }: { app: AppWithRepo }) {
  const [current, setCurrent] = useState(app);
  const [pending, startTransition] = useTransition();

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/apps/${current.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setCurrent(data.app);
    }
  }

  function run(body: Record<string, unknown>) {
    startTransition(() => {
      patch(body);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 dark:border-slate-800 p-3 text-sm">
      <Link href={`/apps/${current.slug}`} className="font-medium hover:underline min-w-40">
        {current.name}
      </Link>

      <select
        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
        value={current.category ?? ''}
        onChange={(e) => run({ category: e.target.value || null })}
        disabled={pending}
      >
        <option value="">No category</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <Badge variant={current.verificationStatus === 'UNVERIFIED' ? 'unverified' : 'verified'}>
        {current.verificationStatus}
      </Badge>
      {current.repository.unreachable && (
        <Badge variant="unverified">Gone from GitHub — hidden from catalog</Badge>
      )}
      {!current.repository.unreachable && current.repository.archived && (
        <Badge variant="archived">Archived upstream</Badge>
      )}

      <span className="text-slate-500">⭐ {current.repository.stars}</span>
      <span className="text-slate-500">conf. {Math.round(current.classificationConfidence * 100)}%</span>

      <div className="ml-auto flex gap-2">
        {current.verificationStatus !== 'MANUALLY_VERIFIED' && (
          <button
            disabled={pending}
            onClick={() => run({ verificationStatus: 'MANUALLY_VERIFIED', approved: true })}
            className="rounded bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1"
          >
            Approve
          </button>
        )}
        <button
          disabled={pending}
          onClick={() => run({ hidden: !current.hidden })}
          className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1"
        >
          {current.hidden ? 'Unhide' : 'Hide'}
        </button>
      </div>
    </div>
  );
}
