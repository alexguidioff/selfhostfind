// Periodic refresh of repositories already in the catalog. Run with `pnpm refresh`.
//
// Why this is a separate command from `pnpm discover`:
//   - discovery searches GitHub for *new* candidates and only processes ones it hasn't
//     seen; refresh walks repositories already in the DB and re-analyzes them against
//     current data (README may have moved, the license may have changed, the project
//     may now be archived or have shipped a new release).
//   - refresh is bounded: a configurable maximum per run (default 50), with priority
//     given to never-scanned repos, then oldest successful scan, then repos whose last
//     attempt errored but are now due for a retry.
//   - refresh has a `--dry-run` / `--preview` mode that prints what would change without
//     touching the DB. Useful for verifying the impact of a classifier tweak or a
//     schema migration before letting it loose.
//
// Idempotent like discover: claims the repo atomically, only updates rows we still own,
// preserves manual overrides, and never zeros out a starsGained30d already calculated by
// the snapshot job.

import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import {
  getRepositoryById, type RepositoryLookupResult, type ResourceFetch,
  ghFetch,
} from '@/lib/github';
import { analyzeRepository, type AnalysisOutcome } from './analyze';
import { classify } from '@/lib/classification';
import { buildApplicationUpdate, buildScores, scoreUpdate, SCORE_FIELDS, type RepoItem } from './persist';
import { computeStarsGained30d } from './stars-since';
import { buildPreserveMap, hasTransientFailure } from '@/lib/analysis-merge';
import { runWithConcurrency } from './concurrency';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';
import {
  tryClaim, renew, release, currentWorkerId, updateIfOwner, applicationUpdateIfOwner,
} from './claim';
import { parseArgs } from './refresh.args';

export { parseArgs } from './refresh.args';

const CONCURRENCY = Number(process.env.REFRESH_CONCURRENCY ?? 2);
const DEFAULT_MAX_REPOS = Number(process.env.REFRESH_MAX_REPOS ?? 50);
const STALE_AFTER_DAYS = Number(process.env.REFRESH_STALE_DAYS ?? 7);
const RETRY_MIN_INTERVAL_DAYS = Number(process.env.REFRESH_RETRY_MIN_DAYS ?? 1);

// Selection order: never-scanned first (NULLS FIRST via ascending nulls first), then
// oldest successful scan (lastScannedAt ASC NULLS FIRST), then repos whose last attempt
// errored but whose retry interval has elapsed (lastScanAttemptAt ASC NULLS FIRST).
async function pickRepos(max: number, singleRepo: string | null): Promise<Array<{
  id: string; githubId: bigint; fullName: string;
}>> {
  if (singleRepo) {
    const fallback = await prisma.repository.findFirst({
      where: {
        OR: [
          { fullName: singleRepo },
          { owner: { equals: singleRepo.split('/')[0] }, name: { equals: singleRepo.split('/')[1] ?? '' } },
        ],
      },
      select: { id: true, githubId: true, fullName: true },
    });
    return fallback ? [fallback] : [];
  }
  const staleThreshold = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const retryThreshold = new Date(Date.now() - RETRY_MIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  return prisma.$queryRaw<Array<{ id: string; githubId: bigint; fullName: string }>>`
    SELECT id, "githubId", "fullName"
    FROM "Repository"
    WHERE
      -- Both conditions must hold: a repo is eligible iff it's never been scanned OR
      -- its last successful scan is older than STALE_AFTER_DAYS, AND we haven't
      -- retried it too recently. The original OR-between-branches forgot the retry
      -- interval for already-scanned repos; conflating them here keeps the invariant
      -- "don't hammer a sick repo" true for both kinds of staleness.
      (("lastScannedAt" IS NULL OR "lastScannedAt" < ${staleThreshold})
        AND ("lastScanAttemptAt" IS NULL OR "lastScanAttemptAt" < ${retryThreshold}))
    ORDER BY
      CASE WHEN "lastScannedAt" IS NULL THEN 0 ELSE 1 END,
      -- '1970-01-01'::timestamp is a real timestamp literal; the bare string version
      -- was parsed as a column name and would error at runtime.
      COALESCE("lastScannedAt", "lastScanAttemptAt", '1970-01-01'::timestamp) ASC
    LIMIT ${max}
  `;
}

interface RefreshOutcome {
  repo: string;
  status: 'updated' | 'unchanged' | 'skipped' | 'error' | 'preview';
  reason?: string;
}

async function refreshOne(repo: { id: string; githubId: bigint; fullName: string }, dryRun: boolean): Promise<RefreshOutcome> {
  // --dry-run takes the same path up to GitHub I/O, then bails before any write — no
  // tryClaim, no release, no heartbeat, no lastScanAttemptAt stamp. That's how a
  // preview should behave: completely side-effect-free.
  if (!dryRun) {
    const claim = await tryClaim(prisma, repo.id);
    if (!claim) {
      return { repo: repo.fullName, status: 'skipped', reason: 'claim held by another worker' };
    }
    return refreshWithClaim(repo, claim.expiresAt);
  }
  return refreshPreview(repo);
}

interface ClaimHandle { workerId: string; expiresAt: Date; }

async function refreshPreview(repo: { id: string; githubId: bigint; fullName: string }): Promise<RefreshOutcome> {
  // Preview path: read-only GitHub call, no DB writes, no claim.
  try {
    const lookup = await getRepositoryById(repo.githubId);
    if (!lookup.found) return { repo: repo.fullName, status: 'preview', reason: 'unreachable' };
    const existing = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id }, include: { application: true } });
    const item = lookup.repo;
    const { starsGained: starsGained30d } = await computeStarsGained30d(repo.id, item.stargazers_count);
    const analysis = await analyzeRepository(item.owner.login, item.name, item.default_branch);
    const classification = classify({
      name: item.name, description: item.description ?? '',
      readme: analysis.result.readmeFull ?? '', topics: item.topics,
    });
    const repoItem: RepoItem = { id: repo.id, githubId: repo.githubId,
      name: item.name, fullName: item.full_name, description: item.description,
      repositoryUrl: item.html_url, homepageUrl: item.homepage || null,
      stars: item.stargazers_count, forks: item.forks_count, watchers: item.watchers_count,
      openIssues: item.open_issues_count, license: item.license?.spdx_id ?? null,
      primaryLanguage: item.language, topics: item.topics,
      createdAt: existing.createdAt, pushedAt: new Date(item.pushed_at),
      archived: item.archived, fork: item.fork, defaultBranch: item.default_branch,
    };
    const scores = buildScores({ repo: repoItem, analysis, classification, starsGained30d });
    return { repo: repo.fullName, status: 'preview',
      reason: `health=${scores.healthScore}, docker=${analysis.result.dockerfilePresent || analysis.result.composePresent}, license=${repoItem.license ?? 'unknown'}` };
  } catch (err) {
    return { repo: repo.fullName, status: 'preview', reason: String(err instanceof Error ? err.message : err) };
  }
}

// Single-flight write path. Outer try/finally owns the claim lifetime: the inner code
// can throw freely (network, Prisma, classification, anything) and the claim still gets
// released in one place. Errors that need to be recorded on the row go through
// recordScanError, which itself uses updateIfOwner — and it works because we haven't
// released the claim yet.
async function refreshWithClaim(
  repo: { id: string; githubId: bigint; fullName: string },
  initialExpiresAt: Date
): Promise<RefreshOutcome> {
  // Renewal timer: keeps the claim alive for long analyses. Renewed TTL must outlive
  // the next renewal interval; we use ttl/2 (default 5min) so a single missed renewal
  // still leaves us safe.
  const ttlMs = Math.max(60_000, Number(process.env.REFRESH_CLAIM_TTL_MS ?? 10 * 60 * 1000));
  const renewal = setInterval(() => { void renew(prisma, repo.id, ttlMs); }, Math.max(30_000, Math.floor(ttlMs / 2)));

  try {
    const result = await performRefresh(repo, initialExpiresAt);
    return result;
  } catch (err) {
    // Record the failure for the next operator to see. Best-effort: if recording fails
    // too, the row just keeps its previous lastScanError.
    await recordScanError(repo.id, err).catch(() => undefined);
    return { repo: repo.fullName, status: 'error', reason: String(err instanceof Error ? err.message : err) };
  } finally {
    clearInterval(renewal);
    // Release happens LAST, after both the happy path and the error-recording write
    // are done — earlier the inner finally released before the catch could write, so
    // updateIfOwner on the error path was silently no-oping against an unclaimed row.
    await release(prisma, repo.id);
  }
}

async function performRefresh(
  repo: { id: string; githubId: bigint; fullName: string },
  initialExpiresAt: Date
): Promise<RefreshOutcome> {
  const lookup = await getRepositoryById(repo.githubId);
  if (!lookup.found) {
    // Permanent disappearance: mark unreachable and clear the field that depends on a
    // live repo. Done in a single transaction with the claim check.
    const rows = await prisma.$transaction(async (tx) => {
      const r = await tx.repository.updateMany({
        where: { id: repo.id, scanClaimExpiresAt: { gt: new Date() } },
        data: {
          unreachable: true, lastVerifiedAt: new Date(),
          lastScanAttemptAt: new Date(), lastScanError: null,
          // Clear evidence that required a live repo. Names that came from the file
          // listing or README stay: the repo may come back under the same owner/name.
          latestReleaseAt: null, latestReleaseTag: null,
        },
      });
      return { repoUpdated: r.count };
    });
    if (rows.repoUpdated === 0) {
      throw new Error('claim lost before unreachable update could commit');
    }
    return { repo: repo.fullName, status: 'updated', reason: 'unreachable' };
  }

  const existing = await prisma.repository.findUniqueOrThrow({
    where: { id: repo.id }, include: { application: true },
  });

  // Identity check after a possible rename. GitHub's immutable ID lookup returns the
  // current owner/name; if they don't match what we previously stored, it could be a
  // rename OR a different project that somehow got this numeric ID (extreme edge case
  // but happens when a deleted repo's ID is reused). Refuse to overwrite the row with
  // conflicting metadata; require a human to reconcile.
  const item = lookup.repo;
  if (existing.fullName !== item.full_name && existing.githubId === BigInt(item.id)) {
    console.warn(`[refresh] ${repo.fullName}: rename detected ${existing.fullName} -> ${item.full_name}, skipping metadata overwrite`);
    await recordScanError(repo.id, new Error(`rename: ${existing.fullName} -> ${item.full_name}`));
    return { repo: repo.fullName, status: 'skipped', reason: `renamed to ${item.full_name}, manual reconcile required` };
  }

  const { starsGained: starsGained30d } = await computeStarsGained30d(repo.id, item.stargazers_count);

  const analysis = await analyzeRepository(item.owner.login, item.name, item.default_branch);
  const classification = classify({
    name: item.name,
    description: item.description ?? '',
    readme: analysis.result.readmeFull ?? '',
    topics: item.topics,
  });

  // On a transient GitHub failure during classification inputs, refuse to write the
  // possibly-wrong negative classification: the row stays as-is, the error is recorded.
  if (!classification.isSelfHostedApp && hasTransientFailure(analysis.diagnostics)) {
    throw new Error(`transient GitHub failure during classify: ${analysis.diagnostics.readmeStatus}/${analysis.diagnostics.contentsStatus}`);
  }

  const repoItem: RepoItem = {
    id: repo.id, githubId: repo.githubId,
    name: item.name, fullName: item.full_name, description: item.description,
    repositoryUrl: item.html_url, homepageUrl: item.homepage || null,
    stars: item.stargazers_count, forks: item.forks_count, watchers: item.watchers_count,
    openIssues: item.open_issues_count, license: item.license?.spdx_id ?? null,
    primaryLanguage: item.language, topics: item.topics,
    createdAt: existing.createdAt, pushedAt: new Date(item.pushed_at),
    archived: item.archived, fork: item.fork, defaultBranch: item.default_branch,
  };

  const scores = buildScores({ repo: repoItem, analysis, classification, starsGained30d });
  const preserve = buildPreserveMap(analysis.diagnostics);

  if (!existing.application) {
    await insertNewApplication({ repo: repoItem, analysis, classification, scores });
    return { repo: repo.fullName, status: 'updated', reason: `health=${scores.healthScore} (new)` };
  }

  const update = buildApplicationUpdate({
    repo: repoItem, analysis, classification,
    existingApplication: existing.application,
  });
  // Per-field preservation: keep the existing value of any field whose fetch failed.
  // Manual overrides always win — even if a fetch succeeded, an admin-marked field is
  // not touched.
  const overrides = (existing.application.manualOverrides as Record<string, boolean> | null) ?? {};
  for (const [field, status] of Object.entries(preserve)) {
    if (status === 'preserved-stale' && !overrides[field]) {
      const existingValue = (existing.application as unknown as Record<string, unknown>)[field];
      if (existingValue !== null && existingValue !== undefined &&
          !(Array.isArray(existingValue) && existingValue.length === 0)) {
        update[field] = existingValue;
      }
    }
  }
  // Merge scores via scoreUpdate (renames breakdown → scoreBreakdown, etc.).
  for (const [k, v] of Object.entries(scoreUpdate(scores))) update[k] = v;
  for (const key of SCORE_FIELDS) {
    if (overrides[key]) delete update[key];
  }

  // Single transaction that writes Repository + Application with a claim guard.
  // The claim guard on both updateMany calls is redundant when they're inside one
  // transaction, but the inner Prisma updateMany calls don't know about the claim —
  // we use the WHERE clause to filter by a still-valid claim as the contract.
  const now = new Date();
  const txRows = await prisma.$transaction(async (tx) => {
    const repoUpdate = await tx.repository.updateMany({
      where: { id: repo.id, scanClaimExpiresAt: { gt: now } },
      data: {
        description: repoItem.description,
        homepageUrl: repoItem.homepageUrl,
        stars: repoItem.stars, forks: repoItem.forks, watchers: repoItem.watchers,
        openIssues: repoItem.openIssues, license: repoItem.license,
        primaryLanguage: repoItem.primaryLanguage, topics: repoItem.topics,
        pushedAt: repoItem.pushedAt,
        latestReleaseAt: analysis.result.latestReleaseAt,
        latestReleaseTag: analysis.result.latestReleaseTag,
        archived: repoItem.archived,
        // Pull the README excerpt, languages, and defaultBranch forward — the old code
        // did not, so a refreshed row could end up with stale README content even when
        // we just successfully fetched it.
        defaultBranch: repoItem.defaultBranch,
        languages: analysis.result.languages ?? undefined,
        readmeExcerpt: analysis.result.readmeExcerpt,
        unreachable: false,
        lastVerifiedAt: now,
        lastScannedAt: now,
        lastScanAttemptAt: now,
        lastScanError: null,
        discoverySource: { push: repoItem.fullName }, // provenance kept; refresh just touches
      },
    });
    const appUpdate = await tx.application.updateMany({
      where: { id: existing.application!.id, repositoryId: repo.id, repository: { scanClaimExpiresAt: { gt: now } } },
      data: update,
    });
    return { repoUpdated: repoUpdate.count, appUpdated: appUpdate.count };
  });
  if (txRows.repoUpdated === 0 || txRows.appUpdated === 0) {
    throw new Error('claim lost mid-transaction (race with another worker)');
  }
  return { repo: repo.fullName, status: 'updated', reason: `health=${scores.healthScore}` };
}

async function recordScanError(repositoryId: string, err: unknown): Promise<void> {
  await updateIfOwner(prisma, repositoryId, {
    lastScanAttemptAt: new Date(),
    lastScanError: String(err instanceof Error ? err.message : err).slice(0, 500),
  });
}

// starsGained30d lives in ./stars-since.ts; refresh uses that shared helper so the
// 30-day delta definition can't drift between the snapshot and refresh pipelines.

async function insertNewApplication(args: {
  repo: RepoItem;
  analysis: AnalysisOutcome;
  classification: ReturnType<typeof classify>;
  scores: ReturnType<typeof buildScores>;
}): Promise<void> {
  const { repo, analysis, classification, scores } = args;
  const update = buildApplicationUpdate({
    repo, analysis, classification,
    existingApplication: null,
  });
  for (const [k, v] of Object.entries(scoreUpdate(scores))) update[k] = v;
  const { uniqueSlug } = await import('./persist');
  const slug = await uniqueSlug(prisma, repo.name);
  await prisma.application.create({
    data: { repositoryId: repo.id, ...update, slug } as never,
  });
}

export interface RefreshSummary {
  scanned: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
}

export async function runRefresh(argv: string[] = process.argv.slice(2)): Promise<RefreshSummary> {
  const { dryRun, repo: singleRepo, max } = parseArgs(argv);
  const startedAt = Date.now();
  const repos = await pickRepos(max, singleRepo);
  console.log(`[refresh] ${dryRun ? '[dry-run] ' : ''}selected ${repos.length} repositories (worker=${currentWorkerId()})`);

  const outcomes = await runWithConcurrency(repos, CONCURRENCY, (r) => refreshOne(r, dryRun));
  const summary: RefreshSummary = {
    scanned: outcomes.length,
    updated: outcomes.filter((o) => o.status === 'updated').length,
    unchanged: outcomes.filter((o) => o.status === 'unchanged').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    errors: outcomes.filter((o) => o.status === 'error').length,
    dryRun,
  };

  for (const outcome of outcomes) {
    const tag = outcome.status === 'error' ? console.error : console.log;
    tag(`[refresh] ${outcome.status} ${outcome.repo}${outcome.reason ? ` — ${outcome.reason}` : ''}`);
  }

  console.log(`[refresh] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (${summary.errors} errors, ${summary.skipped} skipped)`);
  if (summary.errors > 0) {
    await sendAlert({
      level: 'warning',
      title: 'Refresh: per-repo failures',
      message: `${summary.errors} of ${summary.scanned} repositories failed to refresh this run.`,
    });
  }

  if (!dryRun) {
    await pingHeartbeat();
  }
  return summary;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runRefresh()
    .then((s) => {
      // Exit non-zero only on hard failures, not on per-repo skips/errors (those are
      // logged and alerted). This matches how discover treats the same shape.
      const exitCode = s.errors === s.scanned && s.scanned > 0 ? 1 : 0;
      return prisma.$disconnect().then(() => process.exit(exitCode));
    })
    .catch(async (err) => {
      console.error('[refresh] fatal error', err);
      await sendAlert({ level: 'error', title: 'Refresh pipeline crashed', message: String(err instanceof Error ? err.message : err) });
      await prisma.$disconnect();
      process.exit(1);
    });
}
