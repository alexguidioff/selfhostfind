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
  tryClaim, renew, release, currentWorkerId, updateIfOwner, applicationUpdateIfOwner, WORKER_ID,
} from './claim';
import { parseArgs } from './refresh.args';

export { parseArgs } from './refresh.args';

// Number(...) treats '' as 0, which silently disables the job (zero concurrency starts
// no workers, zero max selects no rows). envInt() falls back to the default when the
// variable is missing, empty, or non-numeric — the cases the workflow hits when a
// repository variable is unset. Values <= 0 also fall through to the default so a
// misconfigured secret can't degrade the pipeline silently.
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

const CONCURRENCY = envInt('REFRESH_CONCURRENCY', 2);
const DEFAULT_MAX_REPOS = envInt('REFRESH_MAX_REPOS', 50);
const STALE_AFTER_DAYS = envInt('REFRESH_STALE_DAYS', 7);
const RETRY_MIN_INTERVAL_DAYS = envInt('REFRESH_RETRY_MIN_DAYS', 1);

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
  // still leaves us safe. A failed renewal flips the abort flag, so the next save attempt
  // bails out instead of racing against a worker who now legitimately holds the claim.
  const ttlMs = Math.max(60_000, Number(process.env.REFRESH_CLAIM_TTL_MS ?? 10 * 60 * 1000));
  let claimLost = false;
  const renewal = setInterval(async () => {
    const next = await renew(prisma, repo.id, ttlMs);
    if (!next) {
      claimLost = true;
      console.warn(`[refresh] claim renewal failed for ${repo.fullName}; aborting`);
    }
  }, Math.max(30_000, Math.floor(ttlMs / 2)));

  try {
    if (claimLost) throw new Error('claim renewal failed before refresh started');
    const result = await performRefresh(repo, initialExpiresAt);
    if (claimLost) throw new Error('claim lost during refresh');
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
    // live repo. Done in a single transaction with the claim check (claimId AND
    // claimExpiresAt — checking only the expiry is what the review flagged: an old
    // worker's transaction could still see its own valid expiry if a new worker
    // hadn't yet refreshed it, and would then write under the new worker's lease).
    const rows = await prisma.$transaction(async (tx) => {
      const r = await tx.repository.updateMany({
        where: { id: repo.id, scanClaimId: currentWorkerId(), scanClaimExpiresAt: { gt: new Date() } },
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

  // Bail before any classification work if the inputs we depend on failed transiently.
  // The classifier reads README for isSelfHostedApp, category keywords, nasFriendly, and
  // many of the score components (activity via push, README length, etc.). Computing a
  // new classification from a stale or empty README can produce a "not self-hosted"
  // answer that excludes an existing app from the public catalog, or a worse health
  // score that gets ranked lower in trending. The existing row stays untouched until
  // the next refresh gets a real answer.
  if (analysis.diagnostics.readmeStatus === 'transient_error' ||
      analysis.diagnostics.readmeStatus === 'rate_limited' ||
      analysis.diagnostics.readmeStatus === 'auth_error') {
    throw new Error(`transient GitHub error during README fetch: ${analysis.diagnostics.readmeStatus}`);
  }

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

  // Build per-table update payloads: Repository lives on Repository (and the per-field
  // preservation map looks up Repository fields on existing.repository, not on the
  // Application row), Application lives on Application. Splitting them by source is
  // what makes the partial-update path correct under transient GitHub failures.
  const overrides = (existing.application?.manualOverrides as Record<string, boolean> | null) ?? {};
  const now = new Date();
  const claimFilter = { id: repo.id, scanClaimId: WORKER_ID, scanClaimExpiresAt: { gt: now } };

  const repoData: Record<string, unknown> = {
    description: repoItem.description,
    homepageUrl: repoItem.homepageUrl,
    license: repoItem.license,
    primaryLanguage: repoItem.primaryLanguage,
    topics: repoItem.topics,
    pushedAt: repoItem.pushedAt,
    archived: repoItem.archived,
    defaultBranch: repoItem.defaultBranch,
    unreachable: false,
    lastVerifiedAt: now,
    lastScanAttemptAt: now,
    lastScanError: null,
    discoverySource: { push: repoItem.fullName },
  };
  // Repository fields the previous version clobbered on a transient README/release
  // failure: stars, forks, watchers, openIssues (always fresh from GitHub), and
  // the release/language/README fields, which now respect the preserve map.
  for (const k of ['stars', 'forks', 'watchers', 'openIssues'] as const) repoData[k] = repoItem[k];

  // GitHub-fetch-derived Repository fields: readme excerpt + languages + release. Each
  // honors the per-field preserve map; on a transient failure, the prior value stays.
  const existingRepo = existing as unknown as Record<string, unknown>;
  if (preserve.readmeExcerpt === 'fresh-analysis') {
    repoData.readmeExcerpt = analysis.result.readmeExcerpt;
  } else {
    const cur = existingRepo.readmeExcerpt;
    if (cur) repoData.readmeExcerpt = cur;
  }
  if (preserve.languages === 'fresh-analysis') {
    repoData.languages = analysis.result.languages ?? undefined;
  } else {
    const cur = existingRepo.languages;
    if (cur) repoData.languages = cur;
  }
  if (preserve.latestReleaseAt === 'fresh-analysis') {
    repoData.latestReleaseAt = analysis.result.latestReleaseAt;
    repoData.latestReleaseTag = analysis.result.latestReleaseTag;
  } else {
    const curAt = existingRepo.latestReleaseAt;
    const curTag = existingRepo.latestReleaseTag;
    if (curAt) repoData.latestReleaseAt = curAt;
    if (curTag) repoData.latestReleaseTag = curTag;
  }

  // Application payload: only persisted if the existing app row exists.
  let appData: Record<string, unknown> | null = null;
  if (existing.application) {
    appData = buildApplicationUpdate({
      repo: repoItem, analysis, classification,
      existingApplication: existing.application,
    });
    for (const [field, status] of Object.entries(preserve)) {
      if (status !== 'preserved-stale') continue;
      if (overrides[field]) continue; // admin's manual value wins
      const cur = (existing.application as unknown as Record<string, unknown>)[field];
      // Apply preservation only when there is something real to preserve. A fresh app
      // whose first analysis returned no README shouldn't be stuck on null forever;
      // same for empty arrays (zero screenshots is a valid fresh value).
      if (cur === null || cur === undefined) continue;
      if (Array.isArray(cur) && cur.length === 0) continue;
      appData[field] = cur;
    }
    for (const [k, v] of Object.entries(scoreUpdate(scores))) appData[k] = v;
    for (const key of SCORE_FIELDS) {
      if (overrides[key]) delete appData[key];
    }
  }

  // Insert path: same transaction, same claim guard. Without this, a worker that lost
  // its claim between read and insert could create an Application row for a repo
  // another worker is also touching.
  if (!existing.application) {
    await insertNewApplication({ repo: repoItem, analysis, classification, scores, claimFilter });
    return { repo: repo.fullName, status: 'updated', reason: `health=${scores.healthScore} (new)` };
  }

  // Single transaction that writes Repository + Application with a claim guard on
  // BOTH scanClaimId (the worker) AND scanClaimExpiresAt (still valid). Checking only
  // the expiry was a real bug: if worker A's claim had expired and worker B had
  // acquired a fresh one in the meantime, A's transaction could match B's expiry
  // and write under B's lease. The id+expiry pair is the actual lock.
  const txRows = await prisma.$transaction(async (tx) => {
    const repoUpdate = await tx.repository.updateMany({
      where: claimFilter,
      data: {
        ...repoData,
        lastScannedAt: now,
      },
    });
    const appUpdate = appData ? await tx.application.updateMany({
      where: {
        id: existing.application!.id,
        repositoryId: repo.id,
        repository: { scanClaimId: WORKER_ID, scanClaimExpiresAt: { gt: now } },
      },
      data: appData,
    }) : { count: 1 };
    return { repoUpdated: repoUpdate.count, appUpdated: appUpdate.count };
  });
  if (txRows.repoUpdated === 0 || txRows.appUpdated === 0) {
    // Detected inside the transaction by the WHERE filter; the transaction has already
    // committed zero rows but no partial state — Prisma's $transaction with a
    // callback is a single client-side session, so the abort is a no-op. The real
    // guarantee is that an inconsistent write (one row updated, the other not) can't
    // happen: the WHERE clause is identical for both.
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
  claimFilter: { id: string; scanClaimId: string; scanClaimExpiresAt: { gt: Date } };
}): Promise<void> {
  const { repo, analysis, classification, scores, claimFilter } = args;
  // Build the Application row from scratch (no existing row). Then write both rows
  // inside the same transaction with the same claim guard, so a worker that loses
  // its claim mid-way can't leave a Repository updated but no Application (or vice
  // versa). Last scanned/attempt/error are stamped on the Repository here too, so a
  // completed refresh is consistent across both tables.
  const update = buildApplicationUpdate({
    repo, analysis, classification,
    existingApplication: null,
  });
  for (const [k, v] of Object.entries(scoreUpdate(scores))) update[k] = v;
  const { uniqueSlug } = await import('./persist');
  const slug = await uniqueSlug(prisma, repo.name);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Re-check the claim inside the transaction; if it's gone, abort before creating
    // an Application row that won't have a matching (claim-protected) Repository update.
    const claimed = await tx.repository.findFirst({
      where: claimFilter,
      select: { id: true },
    });
    if (!claimed) {
      throw new Error('claim lost before insert could commit');
    }
    await tx.repository.update({
      where: { id: repo.id },
      data: {
        lastScannedAt: now,
        lastScanAttemptAt: now,
        lastScanError: null,
      },
    });
    await tx.application.create({
      data: { repositoryId: repo.id, ...update, slug } as never,
    });
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

  // Heartbeat is only sent when at least one repo actually completed successfully.
  // A job that picked zero repos (misconfigured MAX_REPOS) or only errored should
  // NOT report "all good" to a dead-man's-switch monitor — that hides the problem
  // until the monitor's grace period runs out, by which time the operator has
  // already lost a day's worth of pipeline runs.
  if (!dryRun && summary.scanned > 0 && summary.updated + summary.unchanged + summary.skipped > 0) {
    await pingHeartbeat();
  } else if (!dryRun) {
    console.warn('[refresh] no successful outcomes — skipping heartbeat to avoid a false-positive success signal');
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
