// Decides which per-field values from a fresh analyze() call should overwrite the
// existing rows, and which should be preserved. The previous implementation always
// overwrote: a 503 from GitHub on the README call would have written empty strings for
// documentationUrl, demoUrl, latestReleaseAt, etc., silently regressing an app's catalog
// entry from "has docs" to "no docs" because of a transient outage.
//
// The map distinguishes Repository fields (live on the Repository row) from Application
// fields (separate table, joined by repositoryId). The previous version mixed the two:
// refresh.ts looked up fields like readmeExcerpt on existing.application, but
// readmeExcerpt is a Repository column. Calling buildPreserveMap and then looking up
// the value on the wrong table returned undefined and silently fell through to the new
// (possibly null) value.
//
// `not_found` is treated as a fresh answer (the resource really is absent). Only
// transient/auth/rate-limited statuses trigger preservation.

import type { AnalysisDiagnostics } from '@/pipeline/analyze';

export type FieldProvenance = 'preserved-stale' | 'fresh-analysis' | 'manual' | 'unchanged';

export interface PreserveOutcome {
  field: string;
  provenance: FieldProvenance;
}

// True when the fetch for this field returned a fresh answer (ok or not_found).
function isFresh(status: 'ok' | 'not_found' | 'rate_limited' | 'auth_error' | 'transient_error'): boolean {
  return status === 'ok' || status === 'not_found';
}

interface FieldMeta {
  table: 'repository' | 'application';
  source: 'readme' | 'contents' | 'release' | 'languages';
}

// Source of truth for which column lives where and which diagnostic owns it. Both the
// Repository write path and the Application write path look at this when deciding
// what to overwrite vs preserve.
const FIELD_META: Record<string, FieldMeta> = {
  readmeExcerpt: { table: 'repository', source: 'readme' },
  readmeFull: { table: 'repository', source: 'readme' },
  documentationUrl: { table: 'application', source: 'readme' },
  demoUrl: { table: 'application', source: 'readme' },
  screenshotUrls: { table: 'application', source: 'readme' },
  databases: { table: 'application', source: 'readme' },
  envVars: { table: 'application', source: 'readme' },
  ports: { table: 'application', source: 'readme' },
  installMethods: { table: 'application', source: 'readme' },
  containerImage: { table: 'application', source: 'readme' },
  arm64Supported: { table: 'application', source: 'readme' },
  amd64Supported: { table: 'application', source: 'readme' },
  dockerSupported: { table: 'application', source: 'contents' },
  composeSupported: { table: 'application', source: 'contents' },
  composePath: { table: 'application', source: 'contents' },
  languages: { table: 'repository', source: 'languages' },
  latestReleaseAt: { table: 'repository', source: 'release' },
  latestReleaseTag: { table: 'repository', source: 'release' },
};

export function buildPreserveMap(diagnostics: AnalysisDiagnostics): {
  [field: string]: 'fresh-analysis' | 'preserved-stale';
} {
  const out: { [field: string]: 'fresh-analysis' | 'preserved-stale' } = {};
  const statusOf: Record<'readme' | 'contents' | 'release' | 'languages', 'ok' | 'not_found' | 'rate_limited' | 'auth_error' | 'transient_error'> = {
    readme: diagnostics.readmeStatus,
    contents: diagnostics.contentsStatus,
    release: diagnostics.releaseStatus,
    languages: diagnostics.languagesStatus,
  };
  for (const [field, meta] of Object.entries(FIELD_META)) {
    out[field] = isFresh(statusOf[meta.source]) ? 'fresh-analysis' : 'preserved-stale';
  }
  return out;
}

// Returns true when at least one diagnostic indicates a non-ok outcome. Refresh uses
// this to decide whether to skip the whole write (transient outage, no point clobbering
// the existing row with whatever made it through) or commit a partial update that
// preserves fields whose fetch failed.
export function hasTransientFailure(diagnostics: AnalysisDiagnostics): boolean {
  return [diagnostics.contentsStatus, diagnostics.readmeStatus, diagnostics.releaseStatus,
    diagnostics.languagesStatus].some((s) => s === 'rate_limited' || s === 'auth_error' || s === 'transient_error');
}
