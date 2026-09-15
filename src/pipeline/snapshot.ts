// Run daily (after discover/refresh) to record a MetricSnapshot per repository and refresh
// each Application's growthScore from the delta vs ~30 days ago. Run with `pnpm snapshot`.

import { prisma } from '@/lib/db';
import { computeScores } from '@/lib/scoring';
import { resolveVerificationStatus } from '@/lib/verification';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';
import { scoreUpdate, applyManualOverrides } from './persist';
import { computeStarsGained30d } from './stars-since';

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

  for (const candidate of repos) {
    await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Repository" WHERE id = ${candidate.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Application" WHERE "repositoryId" = ${candidate.id} FOR UPDATE`;
    const repo = await tx.repository.findUnique({ where: { id: candidate.id }, include: { application: true } });
    if (!repo) return;
    // Idempotent upsert on (repositoryId, recordedDay): same UTC day → same row
    // replaced. The denormalised recordedDay column exists specifically so this is a
    // typed Prisma upsert, not a delete-then-create dance (delete+create would not
    // be atomic against a concurrent snapshot run and could lose counts).
    const recordedDay = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()));
    await tx.metricSnapshot.upsert({
      where: {
        repositoryId_recordedDay: {
          repositoryId: repo.id,
          recordedDay,
        },
      },
      create: {
        repositoryId: repo.id,
        stars: repo.stars,
        forks: repo.forks,
        openIssues: repo.openIssues,
        recordedAt: todayUtc,
        recordedDay,
      },
      update: {
        stars: repo.stars,
        forks: repo.forks,
        openIssues: repo.openIssues,
        recordedAt: todayUtc,
      },
    });

    if (!repo.application) return;

    const { starsGained } = await computeStarsGained30d(repo.id, repo.stars, clock.now(), tx);
    const starsGained30d = starsGained;

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

    const update = applyManualOverrides({
      ...scoreUpdate(scores, starsGained30d, clock.now()), verificationStatus,
    }, repo.application);
    await tx.application.update({ where: { id: repo.application.id }, data: update as never });
    });
  }

  console.log('[snapshot] done');
  await pingHeartbeat();
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
