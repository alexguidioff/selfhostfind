// Minimal GitHub REST API client: search, repo details, contents, README.
// Handles rate limiting (both primary and secondary/abuse limits) with backoff.

const GITHUB_API = 'https://api.github.com';
const NETWORK_TIMEOUT_MS = 20_000;

function token(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'selfhosted-discovery-bot',
    ...extra,
  };
  const t = token();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FetchOptions {
  maxRetries?: number;
  acceptRaw?: boolean;
}

// Wraps fetch with: rate-limit-aware waiting, exponential backoff on 5xx/secondary limits,
// and a single retry on 404 for eventual-consistency blips.
export async function ghFetch(path: string, opts: FetchOptions = {}): Promise<Response> {
  const { maxRetries = 5, acceptRaw = false } = opts;
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;

  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: headers(acceptRaw ? { Accept: 'application/vnd.github.raw+json' } : undefined),
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level failure (DNS, TCP, TLS, abort on timeout). Treat as transient:
      // exponential backoff then return a synthetic 503 so callers see a single failure mode.
      attempt++;
      if (attempt > maxRetries) {
        return new Response(`network error: ${(err as Error).message}`, { status: 503 });
      }
      await sleep(2 ** attempt * 1000);
      continue;
    }

    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '1');
    const resetAt = Number(res.headers.get('x-ratelimit-reset') ?? '0');

    if (res.status === 403 || res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter) {
        await sleep(Number(retryAfter) * 1000 + 500);
      } else if (remaining === 0 && resetAt) {
        const waitMs = Math.max(0, resetAt * 1000 - Date.now()) + 1000;
        console.warn(`[github] rate limit hit, sleeping ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
      } else {
        // secondary rate limit / abuse detection: exponential backoff
        attempt++;
        if (attempt > maxRetries) return res;
        await sleep(2 ** attempt * 1000);
        continue;
      }
      attempt++;
      if (attempt > maxRetries) return res;
      continue;
    }

    if (res.status >= 500) {
      attempt++;
      if (attempt > maxRetries) return res;
      await sleep(2 ** attempt * 1000);
      continue;
    }

    return res;
  }
}

// Discriminated outcome for resource-shaped helpers. Callers that want to preserve valid
// previously-saved data on transient failures match on `kind` and only clear fields on
// `not_found`. Returning a bare null for every error was hiding "GitHub is being slow" as
// "the project has no README" — refresh was wiping evidence it should have kept.
export type ResourceFetch<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'not_found' } // 404 or 410: resource genuinely absent
  | { kind: 'rate_limited' } // 403/429 after backoff exhausted: should be retried later
  | { kind: 'auth_error' } // 401, 403 with non-rate-limit body: token wrong/missing scope
  | { kind: 'transient_error'; status: number }; // 5xx, network: retry on a future run

function classifyFailure(res: Response): Exclude<ResourceFetch<never>, { kind: 'ok' }> {
  const status = res.status;
  if (status === 404 || status === 410) return { kind: 'not_found' };
  if (status === 429) return { kind: 'rate_limited' };
  if (status === 401) return { kind: 'auth_error' };
  if (status === 403) {
    // 403 with rate-limit headers is already exhausted inside ghFetch; whatever surfaces here
    // is either abuse-detection (still throttling) or a permission/scope problem.
    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '1');
    if (remaining === 0) return { kind: 'rate_limited' };
    return { kind: 'auth_error' };
  }
  return { kind: 'transient_error', status };
}

async function resourceFetch<T>(
  path: string,
  acceptRaw: false,
  parse: (data: unknown) => T
): Promise<ResourceFetch<T>>;
async function resourceFetch<T>(
  path: string,
  acceptRaw: true,
  parse: (data: string) => T
): Promise<ResourceFetch<T>>;
async function resourceFetch<T>(
  path: string,
  acceptRaw: boolean,
  parse: (data: any) => T
): Promise<ResourceFetch<T>> {
  const res = await ghFetch(path, { acceptRaw });
  if (res.ok) {
    try {
      const body = acceptRaw ? await res.text() : await res.json();
      return { kind: 'ok', value: parse(body) };
    } catch (err) {
      return { kind: 'transient_error', status: 200 };
    }
  }
  return classifyFailure(res);
}

export interface GhRepoSearchItem {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  license: { spdx_id: string; name: string } | null;
  language: string | null;
  topics: string[];
  created_at: string;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
  default_branch: string;
}

interface SearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GhRepoSearchItem[];
}

// Searches repositories with a single query, paginating up to maxPages (funnel discovery,
// not a full crawl). GitHub search API caps at 1000 results per query regardless.
export async function searchRepositories(
  query: string,
  { maxPages = 3, perPage = 50 }: { maxPages?: number; perPage?: number } = {}
): Promise<GhRepoSearchItem[]> {
  const results: GhRepoSearchItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({
      q: query,
      sort: 'updated',
      order: 'desc',
      per_page: String(perPage),
      page: String(page),
    });
    const res = await ghFetch(`/search/repositories?${qs.toString()}`);
    if (!res.ok) {
      if (page === 1) {
        // First page failing means this query never returned real results — most likely an
        // invalid/expired GITHUB_TOKEN, a malformed query, or a GitHub outage, not "genuinely
        // zero matches". Throw instead of silently treating it as an empty result set, so a
        // systemic problem doesn't masquerade as "the catalog just has nothing new today".
        const body = await res.text().catch(() => '');
        throw new Error(`GitHub search failed (HTTP ${res.status}) for query="${query}": ${body.slice(0, 300)}`);
      }
      console.warn(`[github] search failed (${res.status}) for query="${query}" on page ${page}, keeping partial results`);
      break;
    }
    const data = (await res.json()) as SearchResponse;
    results.push(...data.items);
    if (data.items.length < perPage) break; // last page
    if (page * perPage >= data.total_count) break;
  }
  return results;
}

export type RepositoryLookupResult =
  | { found: true; repo: GhRepoSearchItem }
  | { found: false }; // 404/410: deleted, or transferred somewhere this token can no longer see

// Looks a repository up by its immutable numeric GitHub ID rather than owner/name — this
// transparently follows renames and ownership transfers (GitHub resolves the current
// full_name for you), which a lookup by the old owner/name string cannot do. Used by the
// `reconcile` job so a renamed repo gets its new URL instead of quietly going stale, and a
// truly deleted one is distinguishable from "GitHub is just being slow".
export async function getRepositoryById(githubId: number | bigint): Promise<RepositoryLookupResult> {
  const res = await ghFetch(`/repositories/${githubId}`);
  if (res.status === 404 || res.status === 410) return { found: false };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub repo lookup failed (HTTP ${res.status}) for id=${githubId}: ${body.slice(0, 300)}`);
  }
  return { found: true, repo: (await res.json()) as GhRepoSearchItem };
}

// Fetches root-level directory listing. Returns the discriminated outcome so callers can
// distinguish GitHub outages from genuinely empty repositories.
export async function getRootContents(
  owner: string,
  repo: string,
  path = ''
): Promise<ResourceFetch<Array<{ name: string; type: string }>>> {
  return resourceFetch(
    `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
    false,
    (data) =>
      Array.isArray(data) ? data.map((f: any) => ({ name: f.name, type: f.type })) : []
  );
}

export async function getReadme(owner: string, repo: string): Promise<ResourceFetch<string>> {
  return resourceFetch(
    `/repos/${owner}/${repo}/readme`,
    true,
    (data) => data as string
  );
}

export async function getLatestRelease(
  owner: string,
  repo: string
): Promise<ResourceFetch<{ tag_name: string; published_at: string }>> {
  return resourceFetch(`/repos/${owner}/${repo}/releases/latest`, false, (data) => data as {
    tag_name: string;
    published_at: string;
  });
}

export async function getLanguages(owner: string, repo: string): Promise<ResourceFetch<Record<string, number>>> {
  return resourceFetch(`/repos/${owner}/${repo}/languages`, false, (data) => data as Record<string, number>);
}
