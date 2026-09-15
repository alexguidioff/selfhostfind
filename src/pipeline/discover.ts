// Main discovery pipeline entrypoint: run with `pnpm discover`.
// Funnel: search queries -> dedupe -> prefilter -> deep analysis -> classify -> score -> upsert.
// Idempotent: repositories are upserted on the unique githubId, so re-running never duplicates
// rows. Fields a human has manually corrected (tracked in Application.manualOverrides) are
// skipped on subsequent automatic writes.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { searchRepositories, type GhRepoSearchItem } from '@/lib/github';
import { buildDiscoveryQueries, labelForQuery } from './queries';
import { prefilterRepository } from './prefilter';
import { analyzeRepository, type AnalysisResult } from './analyze';
import { classify } from '@/lib/classification';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';
import { runWithConcurrency } from './concurrency';
import { buildApplicationUpdate, buildScores, repoItemFromSearch, uniqueSlug, applyManualOverrides, scoreUpdate, SCORE_FIELDS, type RepoItem } from './persist';

const MAX_PAGES_PER_QUERY = Number(process.env.DISCOVERY_MAX_PAGES_PER_QUERY ?? 2);
const CONCURRENCY = Number(process.env.DISCOVERY_CONCURRENCY ?? 3);

interface Candidate {
  item: GhRepoSearchItem;
  sources: Set<string>;
}

async function collectCandidates(): Promise<Map<number, Candidate>> {
  const queries = buildDiscoveryQueries();
  const candidates = new Map<number, Candidate>();
  let succeeded = 0;
  let failed = 0;

  for (const query of queries) {
    console.log(`[discover] searching: ${query}`);
    try {
      const items = await searchRepositories(query, { maxPages: MAX_PAGES_PER_QUERY });
      succeeded++;
      const label = labelForQuery(query);
      for (const item of items) {
        const existing = candidates.get(item.id);
        if (existing) existing.sources.add(label);
        else candidates.set(item.id, { item, sources: new Set([label]) });
      }
    } catch (err) {
      failed++;
      console.error(`[discover] query failed entirely: ${query}`, err);
    }
  }

  // Every single query failing is the strong signal — an isolated bad query shouldn't abort
  // a whole run, but zero successes out of N almost always means GITHUB_TOKEN is invalid/
  // expired or the GitHub API is down, not "there's nothing new on GitHub today".
  if (succeeded === 0 && queries.length > 0) {
    throw new Error(
      `All ${queries.length} discovery queries failed — likely an invalid/expired GITHUB_TOKEN or a GitHub API outage. Aborting without touching the catalog.`
    );
  }

  if (failed > 0) {
    await sendAlert({
      level: 'warning',
      title: 'Discovery: some search queries failed',
      message: `${failed}/${queries.length} discovery queries failed; ${succeeded} succeeded, so the run continued with partial coverage. See job logs for which queries and why.`,
    });
  }

  console.log(`[discover] ${candidates.size} unique candidates from ${succeeded}/${queries.length} queries`);
  return candidates;
}

async function processCandidate(candidate: Candidate): Promise<'ok' | 'error'> {
  const { item, sources } = candidate;
  const fullName = item.full_name;
  const license = item.license?.spdx_id ?? null;

  const scan = await prisma.scan.create({
    data: { githubFullName: fullName, status: 'RUNNING', stage: 'prefilter' },
  });

  try {
    const pre = prefilterRepository(item);
    if (!pre.passed) {
      await prisma.scan.update({
        where: { id: scan.id },
        data: { status: 'SUCCEEDED', completedAt: new Date(), included: false, reason: pre.reason },
      });
      return 'ok';
    }

    await prisma.scan.update({ where: { id: scan.id }, data: { stage: 'analyze' } });
    const analysis = await analyzeRepository(item.owner.login, item.name, item.default_branch);

    await prisma.scan.update({ where: { id: scan.id }, data: { stage: 'classify' } });
    const classification = classify({
      name: item.name,
      description: item.description ?? '',
      readme: analysis.result.readmeFull ?? '',
      topics: item.topics,
    });

    if (!classification.isSelfHostedApp) {
      await prisma.scan.update({
        where: { id: scan.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          included: false,
          reason: `classifier: not a self-hosted application (confidence ${classification.confidence})`,
          extractedData: { analysis: trimForJson(analysis.result), classification } as unknown as Prisma.InputJsonValue,
        },
      });
      return 'ok';
    }

    await prisma.scan.update({ where: { id: scan.id }, data: { stage: 'score' } });
    // Discovery runs first, so no prior snapshot exists yet for brand-new repos:
    // growthScore will be 0 until the snapshot job has at least one full 30-day window.
    // The Repository id is filled in by the upsert below; we use a placeholder here so
    // the score payload has the right shape, then re-bind once the row is known.
    const repo = repoItemFromSearch(item, '');
    const scores = buildScores({ repo, analysis, classification, starsGained30d: null });

    await prisma.scan.update({ where: { id: scan.id }, data: { stage: 'persist' } });

    const repository = await prisma.repository.upsert({
      where: { githubId: repo.githubId },
      create: {
        githubId: repo.githubId,
        owner: repo.fullName.split('/')[0],
        name: repo.name,
        fullName: repo.fullName,
        description: repo.description,
        repositoryUrl: repo.repositoryUrl,
        homepageUrl: repo.homepageUrl,
        stars: repo.stars,
        forks: repo.forks,
        watchers: repo.watchers,
        openIssues: repo.openIssues,
        license: repo.license,
        primaryLanguage: repo.primaryLanguage,
        languages: analysis.result.languages ?? undefined,
        topics: repo.topics,
        readmeExcerpt: analysis.result.readmeExcerpt,
        createdAt: repo.createdAt,
        pushedAt: repo.pushedAt,
        latestReleaseAt: analysis.result.latestReleaseAt,
        latestReleaseTag: analysis.result.latestReleaseTag,
        archived: repo.archived,
        fork: repo.fork,
        defaultBranch: repo.defaultBranch,
        discoverySource: [...sources],
        lastScannedAt: new Date(),
      },
      update: {
        description: repo.description,
        homepageUrl: repo.homepageUrl,
        stars: repo.stars,
        forks: repo.forks,
        watchers: repo.watchers,
        openIssues: repo.openIssues,
        license: repo.license,
        primaryLanguage: repo.primaryLanguage,
        languages: analysis.result.languages ?? undefined,
        topics: repo.topics,
        readmeExcerpt: analysis.result.readmeExcerpt,
        pushedAt: repo.pushedAt,
        latestReleaseAt: analysis.result.latestReleaseAt,
        latestReleaseTag: analysis.result.latestReleaseTag,
        archived: repo.archived,
        discoverySource: { push: [...sources] },
        lastScannedAt: new Date(),
      },
    });

    const existingApp = await prisma.application.findUnique({ where: { repositoryId: repository.id } });

    // Apply manual overrides AFTER scores are merged in, not before — otherwise the
    // override-protection pass would strip scores that were just written, and a
    // manually-corrected healthScore would silently revert to an automated one.
    // buildApplicationUpdate already protects its own fields; scores need the same
    // treatment but with their own key set.
    const proposed = buildApplicationUpdate({
      repo,
      analysis,
      classification,
      existingApplication: existingApp,
    });
    for (const [key, value] of Object.entries(scoreUpdate(scores))) {
      proposed[key] = value;
    }
    // Strip any score fields the admin marked as manual. The breakdown and
    // algorithmVersion travel with the score so the UI can explain it; mark them
    // manual too so a forced recalc doesn't show a stale breakdown next to a current
    // override.
    const overrides = (existingApp?.manualOverrides as Record<string, boolean> | null) ?? {};
    for (const key of SCORE_FIELDS) {
      if (overrides[key]) {
        delete proposed[key];
      }
    }

    await prisma.application.upsert({
      where: { repositoryId: repository.id },
      create: {
        repositoryId: repository.id,
        slug: await uniqueSlug(prisma, repo.name),
        ...proposed,
      } as never,
      update: proposed as never,
    });

    await prisma.scan.update({
      where: { id: scan.id },
      data: {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        repositoryId: repository.id,
        included: true,
        reason: 'included: passed prefilter, classified as self-hosted app',
        extractedData: { analysis: trimForJson(analysis.result), classification, scores } as unknown as Prisma.InputJsonValue,
      },
    });

    console.log(`[discover] included ${fullName} (health=${scores.healthScore})`);
    return 'ok';
  } catch (err) {
    await prisma.scan.update({
      where: { id: scan.id },
      data: { status: 'FAILED', completedAt: new Date(), error: String(err) },
    });
    console.error(`[discover] error processing ${fullName}:`, err);
    return 'error';
  }
}

function trimForJson(analysis: AnalysisResult): Record<string, unknown> {
  const { readmeFull, ...rest } = analysis;
  return { ...rest, readmeLength: readmeFull?.length ?? 0 };
}

// A high per-repo failure rate (as opposed to isolated, expected failures like one repo's
// README being unreachable) usually means something systemic broke — a GitHub API response
// shape changed, the DB connection is flaky, etc. Worth a heads-up even though the run
// itself completes "successfully".
const FAILURE_RATE_ALERT_THRESHOLD = 0.3;
const FAILURE_RATE_ALERT_MIN_COUNT = 5;

// Callable from the API route (HTTP-triggered cron) as well as the CLI entrypoint below.
export async function runDiscovery(): Promise<{ candidateCount: number; elapsedSeconds: number }> {
  const startedAt = Date.now();
  const candidates = await collectCandidates();
  const outcomes = await runWithConcurrency([...candidates.values()], CONCURRENCY, processCandidate);
  const errorCount = outcomes.filter((o) => o === 'error').length;

  if (errorCount >= FAILURE_RATE_ALERT_MIN_COUNT && errorCount / outcomes.length > FAILURE_RATE_ALERT_THRESHOLD) {
    await sendAlert({
      level: 'warning',
      title: 'Discovery: high per-repo failure rate',
      message: `${errorCount} of ${outcomes.length} candidates failed processing this run (see the Scan table for details). This usually points to a systemic issue rather than isolated bad repos.`,
    });
  }

  const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  console.log(`[discover] done in ${elapsedSeconds}s (${errorCount} errors)`);
  await pingHeartbeat();
  return { candidateCount: candidates.size, elapsedSeconds };
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runDiscovery()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('[discover] fatal error', err);
      await sendAlert({
        level: 'error',
        title: 'Discovery pipeline crashed',
        message: String(err instanceof Error ? err.message : err),
      });
      await prisma.$disconnect();
      process.exit(1);
    });
}
