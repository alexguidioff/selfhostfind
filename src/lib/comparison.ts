import type { SearchParams } from './query';
import type { AppWithRepo } from './types';

export function comparisonSlugs(params: SearchParams): string[] {
  const values = params.app === undefined ? [] : Array.isArray(params.app) ? params.app : [params.app];
  return [...new Set(values.filter((value) => /^[a-z0-9][a-z0-9-]{0,99}$/.test(value)))].slice(0, 3);
}

export function architectureValue(value: boolean | null): string {
  return value === null ? 'Unknown' : value ? 'Reported' : 'Reported unsupported';
}

export function maintenanceValue(app: AppWithRepo): string {
  if (app.repository.archived) return 'Archived upstream';
  const days = (Date.now() - app.repository.pushedAt.getTime()) / 86400000;
  return days < 90 ? 'Recent activity' : days < 365 ? 'Activity within a year' : 'Low activity';
}
