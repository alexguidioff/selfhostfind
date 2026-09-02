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
import { computeScores } from '@/lib/scoring';
import { resolveVerificationStatus } from '@/lib/verification';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';
import { slugify } from '@/lib/slug';
import { runWithConcurrency } from './concurrency';

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
      readme: analysis.readmeFull ?? '',
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
          extractedData: { analysis: trimForJson(analysis), classification } as unknown as Prisma.InputJsonValue,
        },
      });
      return 'ok';
    }

    await prisma.scan.update({ where: { id: scan.id }, data: { stage: 'score' } });
    const scores = computeScores({
      pushedAt: new Date(item.pushed_at),
      latestReleaseAt: analysis.latestReleaseAt,
      dockerfilePresent: analysis.dockerfilePresent,
      composePresent: analysis.composePresent,
      readmeLength: analysis.readmeFull?.length ?? 0,
      hasDocumentationUrl: Boolean(analysis.documentationUrl),
      hasScreenshots: analysis.screenshotUrls.length > 0,
      stars: item.stargazers_count,
      forks: item.forks_count,
      license,
      nasFriendly: classification.nasFriendly,
      arm64Supported: analysis.arm64Supported,
      databases: analysis.databases,
      starsGained30d: null, // filled in by trending job once snapshots exist
    });

    await prisma.scan.update({ where: { id: scan.id }, data: { stage: 'persist' } });

    const repository = await prisma.repository.upsert({
      where: { githubId: BigInt(item.id) },
      create: {
        githubId: BigInt(item.id),
        owner: item.owner.login,
        name: item.name,
        fullName,
        description: item.description,
        repositoryUrl: item.html_url,
        homepageUrl: item.homepage || null,
        stars: item.stargazers_count,
        forks: item.forks_count,
        watchers: item.watchers_count,
        openIssues: item.open_issues_count,
        license,
        primaryLanguage: item.language,
        languages: analysis.languages ?? undefined,
        topics: item.topics,
        readmeExcerpt: analysis.readmeExcerpt,
        createdAt: new Date(item.created_at),
        pushedAt: new Date(item.pushed_at),
        latestReleaseAt: analysis.latestReleaseAt,
        latestReleaseTag: analysis.latestReleaseTag,
        archived: item.archived,
        fork: item.fork,
        defaultBranch: item.default_branch,
        discoverySource: [...sources],
        lastScannedAt: new Date(),
      },
      update: {
        description: item.description,
        homepageUrl: item.homepage || null,
        stars: item.stargazers_count,
        forks: item.forks_count,
        watchers: item.watchers_count,
        openIssues: item.open_issues_count,
        license,
        primaryLanguage: item.language,
        languages: analysis.languages ?? undefined,
        topics: item.topics,
        readmeExcerpt: analysis.readmeExcerpt,
        pushedAt: new Date(item.pushed_at),
        latestReleaseAt: analysis.latestReleaseAt,
        latestReleaseTag: analysis.latestReleaseTag,
        archived: item.archived,
        discoverySource: { push: [...sources] },
        lastScannedAt: new Date(),
      },
    });

    const existingApp = await prisma.application.findUnique({ where: { repositoryId: repository.id } });
    const overrides = (existingApp?.manualOverrides as Record<string, boolean> | null) ?? {};

    const dockerSupported = analysis.dockerfilePresent || analysis.composePresent;

    // Re-evaluated every run, in both directions: a project that later goes stale or drops
    // Docker support loses its auto-verified badge without anyone having to notice. A
    // manually-verified status is never touched (see resolveVerificationStatus).
    const verificationStatus = resolveVerificationStatus({
      currentStatus: existingApp?.verificationStatus ?? 'UNVERIFIED',
      classificationConfidence: classification.confidence,
      category: classification.category,
      license,
      dockerSupported,
      composeSupported: analysis.composePresent,
      hasReadme: Boolean(analysis.readmeFull && analysis.readmeFull.length > 100),
      pushedAt: new Date(item.pushed_at),
      archived: item.archived, // always false here in practice — prefilter already rejects archived repos
    });

    const proposed = {
      name: item.name,
      shortDescription: item.description,
      category: classification.category,
      subcategory: classification.subcategory,
      alternativesTo: classification.alternativesTo,
      isSelfHosted: classification.isSelfHostedApp,
      isNasFriendly: classification.nasFriendly,
      dockerSupported,
      composeSupported: analysis.composePresent,
      arm64Supported: analysis.arm64Supported,
      amd64Supported: analysis.amd64Supported,
      databases: analysis.databases,
      installMethods: analysis.installMethods,
      envVars: analysis.envVars,
      ports: analysis.ports,
      containerImage: analysis.containerImage,
      documentationUrl: analysis.documentationUrl,
      demoUrl: analysis.demoUrl,
      screenshotUrls: analysis.screenshotUrls,
      classificationConfidence: classification.confidence,
      classificationSource: 'keyword-rules',
      verificationStatus,
      ...scores,
    } as Record<string, unknown>;

    // Never overwrite fields a human has manually corrected.
    for (const key of Object.keys(overrides)) {
      if (overrides[key]) delete proposed[key];
    }

    await prisma.application.upsert({
      where: { repositoryId: repository.id },
      create: {
        repositoryId: repository.id,
        slug: await uniqueSlug(item.name),
        ...proposed,
      } as any,
      update: proposed as any,
    });

    await prisma.scan.update({
      where: { id: scan.id },
      data: {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        repositoryId: repository.id,
        included: true,
        reason: 'included: passed prefilter, classified as self-hosted app',
        extractedData: { analysis: trimForJson(analysis), classification, scores } as unknown as Prisma.InputJsonValue,
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

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'app';
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.application.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
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
