import type { GhRepoSearchItem } from '@/lib/github';

export interface PrefilterResult {
  passed: boolean;
  reason: string;
}

const LIBRARY_KEYWORDS = [
  'sdk', 'client library', 'api wrapper', 'npm package', 'python package',
  'go module', 'rust crate', 'bindings for', 'wrapper for', 'utility library',
];

const NOT_AN_APP_KEYWORDS = [
  'awesome list', 'curated list', 'a list of', 'collection of links',
  'dotfiles', 'my personal config', 'boilerplate', 'starter template',
  'cookiecutter', 'scaffold for', 'example project', 'proof of concept',
  'cheat sheet', 'notes and', 'personal notes',
];

const PLUGIN_KEYWORDS = [
  'plugin for', 'extension for', 'addon for', 'module for', 'theme for',
];

const TEMPLATE_NAME_HINTS = ['template', 'boilerplate', 'starter', 'skeleton', 'cookiecutter'];

const ABANDONED_CUTOFF_DAYS = 730; // ~2 years with no push = treat as abandoned

function monthsAgo(dateIso: string): number {
  return (Date.now() - new Date(dateIso).getTime()) / (1000 * 60 * 60 * 24 * 30);
}

function daysAgo(dateIso: string): number {
  return (Date.now() - new Date(dateIso).getTime()) / (1000 * 60 * 60 * 24);
}

function textContains(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  return keywords.find((k) => lower.includes(k)) ?? null;
}

// Cheap, explainable rules applied before we spend GitHub API calls on deep analysis
// (README fetch, contents listing). Each rejection carries a human-readable reason
// that gets stored on the Scan row for auditability.
export function prefilterRepository(item: GhRepoSearchItem): PrefilterResult {
  if (item.fork) return { passed: false, reason: 'is a fork' };
  if (item.archived) return { passed: false, reason: 'archived repository' };
  if (!item.license) return { passed: false, reason: 'no license detected' };
  if (daysAgo(item.pushed_at) > ABANDONED_CUTOFF_DAYS) {
    return { passed: false, reason: `no push in ${Math.round(daysAgo(item.pushed_at))} days (likely abandoned)` };
  }

  const description = item.description ?? '';
  const name = item.name.toLowerCase();

  const libHit = textContains(description, LIBRARY_KEYWORDS);
  if (libHit) return { passed: false, reason: `looks like a library/SDK ("${libHit}")` };

  const notAppHit = textContains(description, NOT_AN_APP_KEYWORDS);
  if (notAppHit) return { passed: false, reason: `looks like a list/dotfiles/template ("${notAppHit}")` };

  const pluginHit = textContains(description, PLUGIN_KEYWORDS);
  if (pluginHit) return { passed: false, reason: `looks like a plugin/extension, not standalone ("${pluginHit}")` };

  if (TEMPLATE_NAME_HINTS.some((h) => name.includes(h))) {
    return { passed: false, reason: 'repo name suggests a template/boilerplate' };
  }

  if (!description || description.trim().length < 8) {
    return { passed: false, reason: 'missing or too-short description' };
  }

  return { passed: true, reason: 'passed prefilter rules' };
}

export function isRecentlyActive(pushedAtIso: string, withinMonths = 12): boolean {
  return monthsAgo(pushedAtIso) <= withinMonths;
}
