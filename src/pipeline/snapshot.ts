// Run daily (after discover/refresh) to record a MetricSnapshot per repository and refresh
// each Application's growthScore from the delta vs ~30 days ago. Run with `pnpm snapshot`.

import { prisma } from '@/lib/db';
import { computeScores } from '@/lib/scoring';
import { resolveVerificationStatus } from '@/lib/verification';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';
import { scoreUpdate, SCORE_FIELDS } from './persist';
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

  for (const repo of repos) {
    // Idempotent upsert on (repositoryId, recordedDay): same UTC day → same row
    // replaced. The denormalised recordedDay column exists specifically so this is a
    // typed Prisma upsert, not a delete-then-create dance (delete+create would not
    // be atomic against a concurrent snapshot run and could lose counts).
    const recordedDay = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()));
    await prisma.metricSnapshot.upsert({
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

    if (!repo.application) continue;

    const { starsGained, source: starsGainedSource } = await computeStarsGained30d(repo.id, repo.stars, clock.now());
    const starsGained30d = starsGained;
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

    // scoreUpdate does the column-name remapping (breakdown → scoreBreakdown, etc.)
    // and stamps scoreComputedAt; spreading its result gives us a verified-by-types
    // payload that can't silently write wrong names. Adding verificationStatus and
    // growthScoreSource last keeps those two outside the override-protection strip
    // below — the admin UI doesn't expose them, so flagging them manually would be
    // noise, and silently dropping them on every run would erase provenance.
    const update: Record<string, unknown> = {
      ...scoreUpdate(scores),
      verificationStatus,
      // Stash whether growth is real or "not enough history" so the UI can label
      // consistently without re-deriving.
      growthScoreSource: starsGainedSource,
    };
    // Apply manual overrides AFTER all derived fields are merged in. If a score column
    // is in manualOverrides, the admin's value stands. Breakdown travels with the score
    // so it follows the same rule.
    for (const key of [...SCORE_FIELDS, 'verificationStatus', 'growthScoreSource']) {
      if (overrides[key]) delete update[key];
    }

    await prisma.application.update({ where: { id: repo.application.id }, data: update as never });
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
