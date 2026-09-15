'use client';

// Issue reporting links. Both open the project Issues page with the matching template
// pre-filled via URL params, so the user reviews the body in GitHub before submitting.
// No API token, no server-side ticket store, no automatic ingestion — the plan
// explicitly forbids all three.

const REPO = process.env.NEXT_PUBLIC_REPORT_REPO ?? 'alexguidioff/selfhostfind';

function buildUrl(template: 'suggest' | 'correction', params: Record<string, string> = {}): string {
  const qs = new URLSearchParams({ template: `${template}.yml`, ...params });
  return `https://github.com/${REPO}/issues/new?${qs.toString()}`;
}

export function SuggestAppLink() {
  const href = buildUrl('suggest');
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Opens a public GitHub issue form; a GitHub account is required"
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
    >
      Suggest an app
      <span aria-hidden="true" className="text-xs">↗</span>
    </a>
  );
}

export function ReportErrorLink({ appSlug }: { appSlug: string }) {
  const href = buildUrl('correction', { app: appSlug });
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Opens a public GitHub issue form; a GitHub account is required"
      className="inline-flex items-center gap-1 rounded-md text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white underline-offset-2 hover:underline"
    >
      Report an error
      <span aria-hidden="true" className="text-xs">↗</span>
    </a>
  );
}
