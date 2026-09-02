// Run daily (after discover.ts) to record a MetricSnapshot per repository and refresh
// each Application's growthScore from the delta vs ~30 days ago. Run with `pnpm snapshot`.

import { prisma } from '@/lib/db';
import { computeScores } from '@/lib/scoring';
import { resolveVerificationStatus } from '@/lib/verification';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';

async function main() {
  const repos = await prisma.repository.findMany({
    include: { application: true },
  });

  console.log(`[snapshot] recording metrics for ${repos.length} repositories`);

  for (const repo of repos) {
    await prisma.metricSnapshot.create({
      data: {
        repositoryId: repo.id,
        stars: repo.stars,
        forks: repo.forks,
        openIssues: repo.openIssues,
      },
    });

    if (!repo.application) continue;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const oldSnapshot = await prisma.metricSnapshot.findFirst({
      where: { repositoryId: repo.id, recordedAt: { lte: thirtyDaysAgo } },
      orderBy: { recordedAt: 'desc' },
    });

    const starsGained30d = oldSnapshot ? repo.stars - oldSnapshot.stars : null;
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

    // Re-resolved daily against the repos already in the DB (not just newly-discovered
    // ones), so a project that quietly goes stale between discovery runs still loses its
    // auto-verified badge without anyone noticing or re-running discovery on it.
    const verificationStatus = resolveVerificationStatus({
      currentStatus: repo.application.verificationStatus,
      classificationConfidence: repo.application.classificationConfidence,
      category: repo.application.category,
      license: repo.license,
      dockerSupported: repo.application.dockerSupported,
      composeSupported: repo.application.composeSupported,
      hasReadme: (repo.readmeExcerpt?.length ?? 0) > 100,
      pushedAt: repo.pushedAt,
      archived: repo.archived,
      unreachable: repo.unreachable,
    });

    const update: Record<string, unknown> = { ...scores, verificationStatus };
    for (const key of Object.keys(overrides)) {
      if (overrides[key]) delete update[key];
    }

    await prisma.application.update({ where: { id: repo.application.id }, data: update as any });
  }

  console.log('[snapshot] done');
  await pingHeartbeat();
  await prisma.$disconnect();
}

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
