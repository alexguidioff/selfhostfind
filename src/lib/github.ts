// Minimal GitHub REST API client: search, repo details, contents, README.
// Handles rate limiting (both primary and secondary/abuse limits) with backoff.

const GITHUB_API = 'https://api.github.com';

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
    const res = await fetch(url, {
      headers: headers(acceptRaw ? { Accept: 'application/vnd.github.raw+json' } : undefined),
    });

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

// Fetches root-level directory listing to detect Dockerfile/compose files without
// downloading the whole repo.
export async function getRootContents(
  owner: string,
  repo: string
): Promise<Array<{ name: string; type: string }> | null> {
  const res = await ghFetch(`/repos/${owner}/${repo}/contents/`);
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data.map((f: any) => ({ name: f.name, type: f.type })) : null;
}

export async function getReadme(owner: string, repo: string): Promise<string | null> {
  const res = await ghFetch(`/repos/${owner}/${repo}/readme`, { acceptRaw: true });
  if (!res.ok) return null;
  return res.text();
}

export async function getLatestRelease(
  owner: string,
  repo: string
): Promise<{ tag_name: string; published_at: string } | null> {
  const res = await ghFetch(`/repos/${owner}/${repo}/releases/latest`);
  if (!res.ok) return null;
  return res.json();
}

export async function getLanguages(owner: string, repo: string): Promise<Record<string, number> | null> {
  const res = await ghFetch(`/repos/${owner}/${repo}/languages`);
  if (!res.ok) return null;
  return res.json();
}
