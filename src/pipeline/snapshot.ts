// Run daily (after discover/refresh) to record a MetricSnapshot per repository and refresh
// each Application's growthScore from the delta vs ~30 days ago. Run with `pnpm snapshot`.

import { prisma } from '@/lib/db';
import { computeScores } from '@/lib/scoring';
import { resolveVerificationStatus } from '@/lib/verification';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';

// UTC day boundary, used as the dedupe key for snapshots. Postgres side via the
// unique index defined in 20260917090000_snapshot_unique_per_day/migration.sql.
function startOfUtcDay(d: Date = new Date()): Date {
  const utc = new Date(d.getTime());
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

interface Clock { now(): Date; }
const realClock: Clock = { now: () => new Date() };

async function main() {
  await runSnapshot(realClock);
}

export async function runSnapshot(clock: Clock = realClock): Promise<void> {
  const repos = await prisma.repository.findMany({
    include: { application: true },
  });

  console.log(`[snapshot] recording metrics for ${repos.length} repositories`);

  const todayUtc = startOfUtcDay(clock.now());

  for (const repo of repos) {
    // The unique index on (repositoryId, UTC day) means re-running within the same UTC
    // day replaces today's row rather than appending. We delete first then insert inside
    // a single transaction so a concurrent snapshot run can't see zero rows momentarily.
    // Raw SQL is needed because the unique constraint is a functional index on
    // date_trunc('day', recordedAt) — Prisma's typed upsert can't address it.
    await prisma.$transaction([
      prisma.metricSnapshot.deleteMany({
        where: { repositoryId: repo.id, recordedAt: todayUtc },
      }),
      prisma.metricSnapshot.create({
        data: {
          repositoryId: repo.id,
          stars: repo.stars,
          forks: repo.forks,
          openIssues: repo.openIssues,
          recordedAt: todayUtc,
        },
      }),
    ]);

    if (!repo.application) continue;

    const { starsGained30d, starsGainedSource } = await computeStarsGained30d(repo.id, repo.stars, clock.now());
    const overrides = (repo.application.manualOverrides as Record<string, boolean> | null) ?? {};

    const scores = computeScores({
      pushedAt: repo.pushedAt,
      latestReleaseAt: repo.latestReleaseAt,
      dockerfilePresent: repo.application.dockerSupported,
      composePresent: repo.application.composeSupported,
      readmeLength: repo.readmeExcerpt?.length ?? 0,
      hasDocumentationUrl: Boolean(repo.application.documentationUrl),
      hasScreenshots: repo.application.screenshotUrls.length > 0,
      stars: repo.stars,
      forks: repo.forks,
      license: repo.license,
      nasFriendly: repo.application.isNasFriendly,
      arm64Supported: repo.application.arm64Supported,
      databases: repo.application.databases,
      starsGained30d,
    });

    const verificationStatus = resolveVerificationStatus({
      currentStatus: repo.application.verificationStatus,
      classificationConfidence: repo.application.classificationConfidence,
      reviewReasons: repo.application.classificationReviewReasons,
      category: repo.application.category,
      license: repo.license,
      dockerSupported: repo.application.dockerSupported,
      composeSupported: repo.application.composeSupported,
      hasReadme: (repo.readmeExcerpt?.length ?? 0) > 100,
      pushedAt: repo.pushedAt,
      archived: repo.archived,
      unreachable: repo.unreachable,
    });

    const update: Record<string, unknown> = {
      ...scores,
      verificationStatus,
      scoreBreakdown: scores.breakdown,
      scoreAlgorithmVersion: scores.algorithmVersion,
      scoreComputedAt: clock.now(),
      // Stash whether growth is real or "not enough history" so the UI can label
      // consistently without re-deriving.
      growthScoreSource: starsGainedSource,
    };
    for (const key of Object.keys(overrides)) {
      if (overrides[key]) delete update[key];
    }

    await prisma.application.update({ where: { id: repo.application.id }, data: update as any });
  }

  console.log('[snapshot] done');
  await pingHeartbeat();
}

// 30-day reference: the snapshot closest to 30 days ago, accepted only if it's within
// 48 hours of the target. Returns null when no usable reference exists so the UI can
// distinguish "no growth" from "we don't know" (the latter must not surface the app in
// trending rankings).
export async function computeStarsGained30d(
  repositoryId: string,
  currentStars: number,
  now: Date
): Promise<{ starsGained30d: number | null; starsGainedSource: 'computed' | 'insufficient-history' }> {
  const target = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const toleranceMs = 48 * 60 * 60 * 1000;
  const min = new Date(target.getTime() - toleranceMs);
  const max = new Date(target.getTime() + toleranceMs);
  const reference = await prisma.metricSnapshot.findFirst({
    where: { repositoryId, recordedAt: { gte: min, lte: max } },
    orderBy: { recordedAt: 'desc' },
  });
  if (!reference) return { starsGained30d: null, starsGainedSource: 'insufficient-history' };
  return { starsGained30d: currentStars - reference.stars, starsGainedSource: 'computed' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error('[snapshot] fatal error', err);
    await sendAlert({
      level: 'error',
      title: 'Snapshot job crashed',
      message: String(err instanceof Error ? err.message : err),
    });
    await prisma.$disconnect();
    process.exit(1);
  });
}
