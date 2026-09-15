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
import { buildApplicationUpdate, buildScores, type RepoItem } from './persist';
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
      ("lastScannedAt" IS NULL AND ("lastScanAttemptAt" IS NULL OR "lastScanAttemptAt" < ${retryThreshold}))
      OR ("lastScannedAt" IS NOT NULL AND "lastScannedAt" < ${staleThreshold})
    ORDER BY
      CASE WHEN "lastScannedAt" IS NULL THEN 0 ELSE 1 END,
      COALESCE("lastScannedAt", "lastScanAttemptAt", "1970-01-01") ASC
    LIMIT ${max}
  `;
}

interface RefreshOutcome {
  repo: string;
  status: 'updated' | 'unchanged' | 'skipped' | 'error' | 'preview';
  reason?: string;
}

async function refreshOne(repo: { id: string; githubId: bigint; fullName: string }, dryRun: boolean): Promise<RefreshOutcome> {
  const claim = await tryClaim(prisma, repo.id);
  if (!claim) {
    return { repo: repo.fullName, status: 'skipped', reason: 'claim held by another worker' };
  }
  try {
    const lookup = await getRepositoryById(repo.githubId);
    if (!lookup.found) {
      if (!dryRun) {
        await updateIfOwner(prisma, repo.id, {
          unreachable: true, lastVerifiedAt: new Date(), lastScanAttemptAt: new Date(),
        });
      }
      return { repo: repo.fullName, status: 'updated', reason: 'unreachable' };
    }

    // Long analyses: keep the claim alive. Renew once per minute to a fresh TTL.
    const renewalHandle = setInterval(() => { void renew(prisma, repo.id); }, 60_000);

    try {
      const existing = await prisma.repository.findUniqueOrThrow({
        where: { id: repo.id },
        include: { application: true },
      });

      const item = lookup.repo;
      const starsGained30d = await computeStarsGained30d(repo.id, existing.stars);

      const analysis = await analyzeRepository(item.owner.login, item.name, item.default_branch);
      const classification = classify({
        name: item.name,
        description: item.description ?? '',
        readme: analysis.result.readmeFull ?? '',
        topics: item.topics,
      });

      const repoItem: RepoItem = {
        id: repo.id,
        githubId: repo.githubId,
        name: item.name,
        fullName: item.full_name,
        description: item.description,
        repositoryUrl: item.html_url,
        homepageUrl: item.homepage || null,
        stars: item.stargazers_count,
        forks: item.forks_count,
        watchers: item.watchers_count,
        openIssues: item.open_issues_count,
        license: item.license?.spdx_id ?? null,
        primaryLanguage: item.language,
        topics: item.topics,
        createdAt: existing.createdAt,
        pushedAt: new Date(item.pushed_at),
        archived: item.archived,
        fork: item.fork,
        defaultBranch: item.default_branch,
      };

      const scores = buildScores({ repo: repoItem, analysis, classification, starsGained30d });

      if (!existing.application) {
        if (dryRun) {
          return { repo: repo.fullName, status: 'preview', reason: 'no application row yet' };
        }
        await insertNewApplication({ repo: repoItem, analysis, classification, scores });
      } else {
        const update = buildApplicationUpdate({
          repo: repoItem,
          analysis,
          classification,
          existingApplication: existing.application,
        });
        // Merge scores into the update. buildApplicationUpdate does not include scores
        // because discover sets them separately; here we want to commit both together
        // so the partial-update path doesn't leave scoring stale.
        for (const [k, v] of Object.entries(scores)) update[k] = v;

        if (dryRun) {
          return {
            repo: repo.fullName, status: 'preview',
            reason: `health=${scores.healthScore}, docker=${update.dockerSupported}, license=${repoItem.license ?? 'unknown'}`,
          };
        }

        // Two writes, both verified through the claim. Repository first (so the foreign
        // key is fine), then Application. If the second fails or we lose the claim,
        // Repository still got its metadata refresh — better than half-applying nothing.
        await updateIfOwner(prisma, repo.id, {
          description: repoItem.description,
          homepageUrl: repoItem.homepageUrl,
          stars: repoItem.stars,
          forks: repoItem.forks,
          watchers: repoItem.watchers,
          openIssues: repoItem.openIssues,
          license: repoItem.license,
          primaryLanguage: repoItem.primaryLanguage,
          topics: repoItem.topics,
          pushedAt: repoItem.pushedAt,
          latestReleaseAt: analysis.result.latestReleaseAt,
          latestReleaseTag: analysis.result.latestReleaseTag,
          archived: repoItem.archived,
          unreachable: false,
          lastVerifiedAt: new Date(),
          lastScannedAt: new Date(),
          lastScanAttemptAt: new Date(),
          lastScanError: null,
        });

        await applicationUpdateIfOwner(prisma, existing.application.id, existing.id, update);
      }

      return { repo: repo.fullName, status: 'updated', reason: `health=${scores.healthScore}` };
    } finally {
      clearInterval(renewalHandle);
      await release(prisma, repo.id);
    }
  } catch (err) {
    if (!dryRun) {
      await updateIfOwner(prisma, repo.id, {
        lastScanAttemptAt: new Date(),
        lastScanError: String(err instanceof Error ? err.message : err).slice(0, 500),
      });
    }
    return { repo: repo.fullName, status: 'error', reason: String(err instanceof Error ? err.message : err) };
  }
}

// Pulls the snapshot closest to ~30 days ago (with a 48-hour tolerance) and returns the
// stars delta. Returns null when no usable reference exists: we must NOT pretend the
// growth is zero when the truth is "we don't have enough history yet" (see plan §3).
async function computeStarsGained30d(repositoryId: string, currentStars: number): Promise<number | null> {
  const now = new Date();
  const target = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const toleranceMs = 48 * 60 * 60 * 1000;
  const min = new Date(target.getTime() - toleranceMs);
  const max = new Date(target.getTime() + toleranceMs);
  const reference = await prisma.metricSnapshot.findFirst({
    where: { repositoryId, recordedAt: { gte: min, lte: max } },
    orderBy: { recordedAt: 'desc' },
  });
  if (!reference) return null;
  return currentStars - reference.stars;
}

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
  for (const [k, v] of Object.entries(scores)) update[k] = v;
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
