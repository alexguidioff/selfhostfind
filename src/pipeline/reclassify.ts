import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { classify, classificationFields } from '@/lib/classification';
import { resolveVerificationStatus } from '@/lib/verification';

export async function reclassifyCatalog(where: Prisma.ApplicationWhereInput = {}) {
  const apps = await prisma.application.findMany({ where, include: { repository: true } });
  let pending = 0;
  for (const app of apps) {
    const repo = app.repository;
    const result = classify({ name: repo.name, description: repo.description ?? '',
      readme: repo.readmeExcerpt ?? '', topics: repo.topics });
    const data: Record<string, unknown> = classificationFields(result);
    const overrides = (app.manualOverrides as Record<string, boolean> | null) ?? {};
    const sources = { ...((app.fieldSources as Record<string, string> | null) ?? {}) };
    for (const key of Object.keys(data)) {
      if (overrides[key]) delete data[key];
      else if (['category', 'subcategory', 'alternativesTo', 'isNasFriendly'].includes(key)) sources[key] = 'keyword-rules';
    }
    const updated = { ...app, ...data };
    data.verificationStatus = resolveVerificationStatus({
      currentStatus: app.verificationStatus, classificationConfidence: updated.classificationConfidence,
      reviewReasons: updated.classificationReviewReasons, category: updated.category,
      license: repo.license, dockerSupported: app.dockerSupported, composeSupported: app.composeSupported,
      hasReadme: (repo.readmeExcerpt?.length ?? 0) > 100, pushedAt: repo.pushedAt,
      archived: repo.archived, unreachable: repo.unreachable,
    });
    // Keep existing listings visible while questionable identity is reviewed; never delete from a stored excerpt.
    await prisma.application.update({ where: { id: app.id }, data: { ...data, fieldSources: sources } });
    if (result.reviewReasons.length) pending++;
  }
  console.log(`Reclassified ${apps.length} applications; ${pending} with review reasons. Manual field overrides preserved.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reclassifyCatalog().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
