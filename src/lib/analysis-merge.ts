// Decides which per-field values from a fresh analyze() call should overwrite the
// existing Application row, and which should be preserved. The previous implementation
// always overwrote: a 503 from GitHub on the README call would have written empty strings
// for documentationUrl, demoUrl, latestReleaseAt, etc., silently regressing an app's
// catalog entry from "has docs" to "no docs" because of a transient outage.

import type { AnalysisDiagnostics } from '@/pipeline/analyze';

export type FieldProvenance = 'preserved-stale' | 'fresh-analysis' | 'manual' | 'unchanged';

export interface PreserveOutcome {
  field: string;
  provenance: FieldProvenance;
}

// A field with a fresh value is overwritten; a field whose analyze() outcome failed is
// kept from the existing Application. Manual provenance always wins (admin's call).
// `not_found` is treated as a fresh answer (the resource really is absent) — only
// transient/auth/rate-limited statuses trigger preservation.
export function buildPreserveMap(diagnostics: AnalysisDiagnostics): {
  [field: string]: 'fresh-analysis' | 'preserved-stale';
} {
  const isFreshReadme = diagnostics.readmeStatus === 'ok' || diagnostics.readmeStatus === 'not_found';
  const isFreshContents = diagnostics.contentsStatus === 'ok' || diagnostics.contentsStatus === 'not_found';
  const isFreshRelease = diagnostics.releaseStatus === 'ok' || diagnostics.releaseStatus === 'not_found';
  const isFreshLanguages = diagnostics.languagesStatus === 'ok' || diagnostics.languagesStatus === 'not_found';
  return {
    readmeExcerpt: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
    readmeFull: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
    documentationUrl: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
    demoUrl: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
    screenshotUrls: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
    latestReleaseAt: isFreshRelease ? 'fresh-analysis' : 'preserved-stale',
    latestReleaseTag: isFreshRelease ? 'fresh-analysis' : 'preserved-stale',
    dockerSupported: isFreshContents ? 'fresh-analysis' : 'preserved-stale',
    composeSupported: isFreshContents ? 'fresh-analysis' : 'preserved-stale',
    composePath: isFreshContents ? 'fresh-analysis' : 'preserved-stale',
    languages: isFreshLanguages ? 'fresh-analysis' : 'preserved-stale',
    arm64Supported: isFreshContents ? 'fresh-analysis' : 'preserved-stale',
    amd64Supported: isFreshContents ? 'fresh-analysis' : 'preserved-stale',
    databases: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
    envVars: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
    ports: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
    installMethods: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
    containerImage: isFreshReadme ? 'fresh-analysis' : 'preserved-stale',
  };
}

// Returns true when at least one diagnostic indicates a non-ok outcome. Refresh uses
// this to decide whether to skip the whole write (transient outage, no point clobbering
// the existing row with whatever made it through) or commit a partial update that
// preserves fields whose fetch failed.
export function hasTransientFailure(diagnostics: AnalysisDiagnostics): boolean {
  return [diagnostics.contentsStatus, diagnostics.readmeStatus, diagnostics.releaseStatus,
    diagnostics.languagesStatus].some((s) => s === 'rate_limited' || s === 'auth_error' || s === 'transient_error');
}
