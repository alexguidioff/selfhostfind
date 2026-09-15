'use client';

// Renders the per-component health-score breakdown for an Application. The data is
// persisted atomically with the score itself (Application.scoreBreakdown) so the
// numbers here are exactly what was used at score time — no recomputation, no risk
// of the explanation drifting if the algorithm changes.

import type { ScoreBreakdown } from '@/lib/scoring';

interface Props {
  score: number;
  breakdown: ScoreBreakdown | null | undefined;
  algorithmVersion: string | null | undefined;
  computedAt: Date | string | null | undefined;
  isManualOverride: boolean;
}

const LABELS: Record<string, string> = {
  activity: 'Recent activity',
  releases: 'Recent releases',
  docker: 'Docker / Compose',
  documentation: 'Documentation',
  community: 'Community (stars, forks)',
  license: 'License',
  nas: 'NAS compatibility',
};

export function HealthBreakdown({ score, breakdown, algorithmVersion, computedAt, isManualOverride }: Props) {
  return (
    <details className="mt-4 text-sm" open>
      <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200 hover:underline">
        How is this {Math.round(score)}/100 calculated?
      </summary>
      <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-[#fafaf8] dark:bg-slate-900 p-4">
        {isManualOverride && (
          <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
            This score was set manually. The breakdown below may not add up to the
            displayed total.
          </p>
        )}
        {!breakdown || !algorithmVersion ? (
          <p className="text-xs text-slate-500">
            Breakdown not yet available. Scores were computed before this version of the
            site — the next refresh will recompute.
          </p>
        ) : (
          <>
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="pb-2 pr-2 font-normal">Component</th>
                  <th className="pb-2 pr-2 font-normal text-right">Weight</th>
                  <th className="pb-2 pr-2 font-normal text-right">Raw</th>
                  <th className="pb-2 pr-2 font-normal text-right">Contributes</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.components.map((c) => (
                  <tr key={c.name} className="border-t border-slate-200/60 dark:border-slate-700/60">
                    <td className="py-1.5 pr-2">{LABELS[c.name] ?? c.name}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{Math.round(c.weight * 100)}%</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{Math.round(c.raw * 100)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">+{c.weighted.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-300 dark:border-slate-700">
                  <td className="pt-2 pr-2 font-medium">Total</td>
                  <td className="pt-2 pr-2 text-right tabular-nums font-medium">100%</td>
                  <td className="pt-2 pr-2" />
                  <td className="pt-2 pr-2 text-right tabular-nums font-medium">
                    {Math.round(breakdown.components.reduce((s, c) => s + c.weighted, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-3 text-[11px] text-slate-500">
              Computed {computedAt ? new Date(computedAt).toISOString().slice(0, 10) : 'unknown'} ·
              algorithm <code className="font-mono">{algorithmVersion}</code>
            </p>
          </>
        )}
      </div>
    </details>
  );
}
