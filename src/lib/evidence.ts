import type { AppWithRepo } from './types';

export function evidenceLabel(app: AppWithRepo, field: string): string {
  const overrides = app.manualOverrides as Record<string, boolean> | null;
  if (overrides?.[field]) return 'Manually corrected';
  const sources = app.fieldSources as Record<string, string> | null;
  const source = sources?.[field];
  if (source === 'manual') return 'Manually corrected';
  if (source === 'repository-files') return 'Detected in repository files';
  if (source === 'readme-mention' || source === 'readme-scan') return 'Inferred from README; not tested';
  if (source === 'keyword-rules') return 'Inferred from keywords; not tested';
  return 'Source unavailable; not tested';
}

export function composeUrl(app: AppWithRepo): string {
  if (!app.composePath) return app.repository.repositoryUrl;
  return `${app.repository.repositoryUrl}/blob/${encodeURIComponent(app.repository.defaultBranch)}/${app.composePath.split('/').map(encodeURIComponent).join('/')}`;
}
