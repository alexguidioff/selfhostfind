// Opt-in logging of zero-result searches. Disabled unless SEARCH_LOG_ENABLED=true; when
// it is on, the SearchBar fires a POST to /api/search-log on each explicit form submit.
// The server validates, normalizes, counts against the real catalog, and writes one row
// per (UTC day, normalized query, filter signature) with atomic increments.
//
// Privacy contract (per the plan):
//   - no IP, no user-agent, no cookie, no referrer, no path, no session id captured;
//   - the user must explicitly submit (typing, prefetch, pagination don't increment);
//   - queries >100 chars, emails, URLs, file paths, secrets-looking strings are dropped;
//   - categories/filters are validated against the same allowlist the catalog uses.

import { prisma } from '@/lib/db';
import { normalizeSearch, type SearchParams } from '@/lib/query';
import { getCatalogPage } from '@/lib/catalog';
import { getAlternativeProducts } from '@/lib/alternatives';
import { slugify } from '@/lib/slug';
import { positiveInt } from '@/pipeline/refresh.args';
import type { Prisma } from '@prisma/client';

const MAX_QUERY_LENGTH = 100;
const SEARCH_LOGS_PER_MINUTE = positiveInt(process.env.SEARCH_LOG_RATE_PER_MINUTE, 60);

// In-memory sliding-window rate limit, scoped to the server process. Conservative
// because the plan asks for "a global conservative write limit per minute, without
// identifying visitors": we count requests regardless of source. Sufficient for the
// single-process Next.js deployment the project targets; a multi-instance deploy would
// move this into Postgres or Redis. No PII touches the counter.
const recentTimestamps: number[] = [];
function underRateLimit(now: number): boolean {
  // Drop entries older than 60s.
  while (recentTimestamps.length && recentTimestamps[0] < now - 60_000) recentTimestamps.shift();
  if (recentTimestamps.length >= SEARCH_LOGS_PER_MINUTE) return false;
  recentTimestamps.push(now);
  return true;
}

// Patterns the search itself should never log. None of these are anchored at the start:
// "my email is foo@bar.com" or "see https://example.com" still trigger, because the
// secret-looking substring inside otherwise-benign text is what we want to drop. A pure
// substring match is what the privacy contract calls for; an anchored regex would miss
// the very common "see <URL>" or "my secret is <token>" phrasing. False positives
// (legitimate words containing these patterns) are accepted as a cost of the safer
// default.
const DROP_PATTERNS: RegExp[] = [
  /(?:github_pat_|sk-(?:proj-|svcacct-)?)[A-Za-z0-9_-]{12,}/i,
  /(?:^|\s)(?:[A-Z]:\\|~?\/)[^\s]+/i,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,                                         // email
  /https?:\/\/[^\s<>"']+/i,                                                          // URL anywhere
  /(?:^|\s)\/[a-z0-9._-]+(?:\/[a-z0-9._-]+){2,}/i,                                  // absolute-ish path
  /\b(?:gh[opr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[bpoas]-[A-Za-z0-9-]{10,})\b/i, // secret tokens
];

export function looksSensitive(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.length > MAX_QUERY_LENGTH) return true;
  return DROP_PATTERNS.some((re) => re.test(v));
}

// Bounds-check the raw byte length of a request body. The Content-Length header can
// be absent (chunked) or lie, so the route also measures TextEncoder output on the
// already-parsed body. This helper is just the upper-bound precheck.
export function exceedsByteLimit(value: string, maxBytes: number): boolean {
  // TextEncoder gives the UTF-8 byte length (browsers' fetch uses UTF-8 over the wire).
  return new TextEncoder().encode(value).byteLength > maxBytes;
}

// The list of categories the catalog exposes; derived here so a new category added in
// lib/constants.ts is automatically valid for logging too.
import { CATEGORIES } from '@/lib/constants';
// CATEGORIES in lib/constants.ts is a readonly tuple of plain strings — values are the
// slugs the catalog uses. The catalog doesn't accept a literal 'all' as a category
// filter (it's only used in the UI to mean "no filter"), so we don't need to exclude it
// here: the allowlist is just the set of real category slugs.
const CATEGORY_SET = new Set<string>(CATEGORIES);

const ALLOWED_FILTER_KEYS = new Set([
  'category', 'docker', 'compose', 'arm64', 'nas', 'verified', 'database', 'minStars', 'updated', 'sort',
]);

export function validateFilterValue(key: string, value: string): boolean {
  if (!ALLOWED_FILTER_KEYS.has(key)) return false;
  switch (key) {
    case 'sort': return value === 'trending';
    case 'category': return CATEGORY_SET.has(value);
    case 'docker': case 'compose': case 'arm64': case 'nas': return value === '1';
    case 'verified': return value === '0' || value === '1';
    case 'database': return ['none', 'SQLite', 'PostgreSQL', 'MySQL', 'MariaDB', 'MongoDB', 'Redis'].includes(value);
    case 'minStars': return /^\d{1,9}$/.test(value);
    case 'updated': return /^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) <= 36500;
    default: return false;
  }
}

// Canonical filter signature: stable JSON of the validated filters, so the unique key
// (dayUtc, normalizedQuery, signature) actually distinguishes the same query under
// different filter combinations instead of collapsing them into one.
export function filterSignature(params: SearchParams): string {
  const entries: string[] = [];
  for (const key of ALLOWED_FILTER_KEYS) {
    const v = strParam(params, key);
    if (v == null) continue;
    if (!validateFilterValue(key, v)) continue;
    entries.push(`${key}=${v}`);
  }
  entries.sort();
  return entries.join('&');
}

function strParam(params: SearchParams, key: string): string | null {
  const raw = params[key];
  if (raw == null) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : null;
}

function startOfUtcDay(d: Date = new Date()): Date {
  const utc = new Date(d.getTime());
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

export function isEnabled(): boolean {
  return process.env.SEARCH_LOG_ENABLED === 'true';
}

export interface LogInput {
  query: string;
  params: SearchParams;
  context?: string | null;
}

export interface LogOutcome {
  recorded: boolean;
  reason?: string;
}

async function searchScope(context: string): Promise<Prisma.ApplicationWhereInput | null> {
  if (context === 'home') return {};
  if (context.length > 150) return null;
  const [kind, slug] = context.split(':');
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || context !== `${kind}:${slug}`) return null;
  if (kind === 'category') {
    const category = CATEGORIES.find(c => slugify(c) === slug);
    return category ? { category } : null;
  }
  if (kind === 'alternatives') {
    const product = (await getAlternativeProducts()).find(p => p.slug === slug);
    return product ? { alternativesTo: { hasSome: product.names } } : null;
  }
  return null;
}

// Returns true if the row was inserted/updated. Failures are swallowed and logged as a
// warning: a broken search-log endpoint must NEVER break navigation.
export async function recordSearch({ query, params, context }: LogInput): Promise<LogOutcome> {
  if (!isEnabled()) return { recorded: false, reason: 'disabled' };
  const normalized = normalizeSearch(query);
  if (looksSensitive(query) || looksSensitive(normalized)) {
    return { recorded: false, reason: 'sensitive' };
  }
  if (!normalized) {
    return { recorded: false, reason: 'empty' };
  }
  const now = Date.now();
  if (!underRateLimit(now)) return { recorded: false, reason: 'rate-limited' };

  const signature = filterSignature(params);
  const safeContext = context ?? 'home';
  const dayUtc = startOfUtcDay(new Date(now));

  try {
    // Server-side count: re-run the same query the catalog would. This is the only way
    // the "zero result" classification can be honest: trusting the client would let any
    // bot lie about being stuck.
    const scope = await searchScope(safeContext);
    if (!scope) return { recorded: false, reason: 'invalid-context' };
    const catalogParams: SearchParams = { q: normalized };
    for (const key of ALLOWED_FILTER_KEYS) {
      const value = strParam(params, key);
      if (!value) continue;
      if (key === 'sort' && value !== 'trending') continue;
      if (!validateFilterValue(key, value)) return { recorded: false, reason: 'invalid-filter' };
      catalogParams[key] = value;
    }
    const page = await getCatalogPage(catalogParams, scope);
    const zeroResult = page.total === 0;

    // Atomic increment: $queryRaw with ON CONFLICT keeps both counters consistent even
    // when two requests land in the same millisecond.
    // The unique key is (dayUtc, normalizedQuery, filterSignature, context). Including
    // context here means a search from the home page and the same search from an
    // alternatives list are aggregated separately, which is what the admin view needs
    // to tell "global gap" apart from "local gap". The schema's @@unique on the first
    // three columns is augmented with context by the migration below.
    await prisma.$executeRaw`
      INSERT INTO "SearchAggregate" (id, "dayUtc", "normalizedQuery", "filterSignature", "context",
                                      "searchCount", "zeroResultCount", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${dayUtc}, ${normalized}, ${signature}, ${safeContext},
              1, ${zeroResult ? 1 : 0}, NOW(), NOW())
      ON CONFLICT ("dayUtc", "normalizedQuery", "filterSignature", "context") DO UPDATE
        SET "searchCount" = "SearchAggregate"."searchCount" + 1,
            "zeroResultCount" = "SearchAggregate"."zeroResultCount" + ${zeroResult ? 1 : 0},
            "updatedAt" = NOW()
    `;
    return { recorded: true };
  } catch (err) {
    console.warn('[search-log] failed to record'); // Never log a query or Prisma payload.
    return { recorded: false, reason: 'error' };
  }
}

// 30-day retention. Called by the maintenance job; safe to run more often.
export async function pruneSearchLogs(retentionDays: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.searchAggregate.deleteMany({ where: { dayUtc: { lt: cutoff } } });
  return count;
}
