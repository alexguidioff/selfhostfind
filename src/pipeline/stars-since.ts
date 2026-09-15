// 30-day reference snapshot lookup, shared between snapshot.ts and refresh.ts.
//
// One implementation, one definition of "30 days ago, with a 48-hour tolerance". The
// previous version lived twice (with a subtle bug in refresh: it used existing.stars
// rather than the freshly-fetched GitHub stars), which meant refresh zeroed out the
// growth delta on every successful run.
//
// Returns null when no usable reference exists; the caller must surface that as a real
// "insufficient history" signal, never as a 0% growth.

import { prisma } from '@/lib/db';

interface ReferenceOutcome {
  starsGained: number | null;
  source: 'computed' | 'insufficient-history';
}

export async function computeStarsGained30d(
  repositoryId: string,
  currentStars: number,
  now: Date = new Date()
): Promise<ReferenceOutcome> {
  const target = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const toleranceMs = 48 * 60 * 60 * 1000;
  const min = new Date(target.getTime() - toleranceMs);
  const max = new Date(target.getTime() + toleranceMs);
  const reference = await prisma.metricSnapshot.findFirst({
    where: { repositoryId, recordedAt: { gte: min, lte: max } },
    orderBy: { recordedAt: 'desc' },
  });
  if (!reference) return { starsGained: null, source: 'insufficient-history' };
  return { starsGained: currentStars - reference.stars, source: 'computed' };
}

// Discovery variant: takes the GitHub numeric ID rather than our Repository row id,
// because discovery is the path that creates the row. Falls back to null (no history)
// on a brand-new repo; an existing repo gets its prior 30-day delta.
export async function computeStarsGained30dByGithubId(
  githubId: bigint,
  currentStars: number,
  now: Date = new Date()
): Promise<number | null> {
  const repo = await prisma.repository.findUnique({ where: { githubId }, select: { id: true } });
  if (!repo) return null;
  const { starsGained } = await computeStarsGained30d(repo.id, currentStars, now);
  return starsGained;
}
