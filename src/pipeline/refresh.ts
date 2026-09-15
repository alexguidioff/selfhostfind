// Complete analyses are saved atomically; network failures leave the catalog intact.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getRepositoryById } from '@/lib/github';
import { classify } from '@/lib/classification';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';
import { analyzeRepository, assertCompleteAnalysis } from './analyze';
import { buildApplicationUpdate, buildScores, scoreUpdate, applyManualOverrides, repositoryData, repoItemFromSearch, uniqueSlug } from './persist';
import { computeStarsGained30d } from './stars-since';
import { runWithConcurrency } from './concurrency';
import { tryClaim, renew, release, updateIfOwner, claimWhere, DEFAULT_TTL_MS, type ClaimHandle } from './claim';
import { parseArgs, positiveInt } from './refresh.args';
export { parseArgs } from './refresh.args';

type Repo = { id: string; githubId: bigint; fullName: string };
export interface RefreshOutcome { repo: string; status: 'updated' | 'skipped' | 'error' | 'preview'; reason?: string; }

export async function pickRepos(max: number, singleRepo: string | null): Promise<Repo[]> {
  if (singleRepo) return prisma.repository.findMany({ where: { fullName: singleRepo }, select: { id: true, githubId: true, fullName: true } });
  const stale = new Date(Date.now() - positiveInt(process.env.REFRESH_STALE_DAYS, 7) * 86400000);
  const retry = new Date(Date.now() - positiveInt(process.env.REFRESH_RETRY_MIN_DAYS, 1) * 86400000);
  return prisma.$queryRaw<Repo[]>`
    SELECT id, "githubId", "fullName" FROM "Repository"
    WHERE ("lastScannedAt" IS NULL OR "lastScannedAt" < ${stale})
      AND ("lastScanAttemptAt" IS NULL OR "lastScanAttemptAt" < ${retry})
      AND ("scanClaimId" IS NULL OR "scanClaimExpiresAt" <= NOW())
    ORDER BY "lastScannedAt" ASC NULLS FIRST, "lastScanAttemptAt" ASC NULLS FIRST, id
    LIMIT ${max}
  `;
}

export async function refreshOne(repo: Repo, dryRun = false): Promise<RefreshOutcome> {
  let claim: ClaimHandle | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let renewal: Promise<void> = Promise.resolve();
  let claimLost = false;
  const assertClaim = () => { if (claimLost) throw new Error('Claim renewal failed'); };
  try {
    if (!dryRun) {
      claim = await tryClaim(prisma, repo.id);
      if (!claim) return { repo: repo.fullName, status: 'skipped', reason: 'claimed by another scan' };
      const held = claim;
      timer = setInterval(() => {
        renewal = renewal.then(async () => {
          if (claimLost) return;
          try { if (!await renew(prisma, repo.id, held)) claimLost = true; }
          catch { claimLost = true; }
        });
      }, Math.max(1, Math.floor(DEFAULT_TTL_MS / 3)));
    }
    const lookup = await getRepositoryById(repo.githubId);
    if (!lookup.found) {
      if (claim) {
        assertClaim();
        const count = await updateIfOwner(prisma, repo.id, claim, {
          unreachable: true, lastVerifiedAt: new Date(), lastScanAttemptAt: new Date(), lastScanError: null,
        });
        if (!count) throw new Error('Claim lost before availability update');
      }
      return { repo: repo.fullName, status: dryRun ? 'preview' : 'updated', reason: 'unreachable; previous evidence retained' };
    }
    const item = lookup.repo;
    if (BigInt(item.id) !== repo.githubId) throw new Error('GitHub repository identity mismatch');
    const analysis = await analyzeRepository(item.owner.login, item.name, item.default_branch);
    assertCompleteAnalysis(analysis);
    const classification = classify({ name: item.name, description: item.description ?? '', readme: analysis.result.readmeFull ?? '', topics: item.topics });
    const repoItem = repoItemFromSearch(item, repo.id);
    const { starsGained } = await computeStarsGained30d(repo.id, item.stargazers_count);
    const scores = buildScores({ repo: repoItem, analysis, classification, starsGained30d: starsGained });
    if (dryRun) return { repo: repo.fullName, status: 'preview', reason: classification.isSelfHostedApp ? `health=${scores.healthScore}` : 'classification needs review' };

    assertClaim();
    await prisma.$transaction(async (tx) => {
      // The conditional UPDATE locks Repository until commit, fencing expired workers.
      assertClaim();
      const locked = await tx.repository.updateMany({ where: claimWhere(repo.id, claim!), data: repositoryData(repoItem, analysis) });
      if (locked.count !== 1) throw new Error('Claim lost before save');
      // Read manual corrections after locking the app, so an admin edit during I/O survives.
      await tx.$queryRaw`SELECT id FROM "Application" WHERE "repositoryId" = ${repo.id} FOR UPDATE`;
      const existing = await tx.application.findUnique({ where: { repositoryId: repo.id } });
      if (!classification.isSelfHostedApp) {
        if (existing) await tx.application.update({ where: { id: existing.id }, data: {
          classificationReviewReasons: [...new Set([...existing.classificationReviewReasons, 'Latest analysis no longer identifies a self-hosted app; manual review required'])],
        } });
      } else {
        const proposed = applyManualOverrides({
          ...buildApplicationUpdate({ repo: repoItem, analysis, classification, existingApplication: existing }),
          ...scoreUpdate(scores, starsGained),
        }, existing);
        if (existing) await tx.application.update({ where: { id: existing.id }, data: proposed as Prisma.ApplicationUpdateInput });
        else await tx.application.create({ data: {
          ...proposed, repositoryId: repo.id, slug: await uniqueSlug(tx, repoItem.name),
        } as Prisma.ApplicationUncheckedCreateInput });
      }
      assertClaim();
      await tx.scan.create({ data: {
        repositoryId: repo.id, githubFullName: item.full_name, stage: 'refresh', status: 'SUCCEEDED', completedAt: new Date(),
        included: classification.isSelfHostedApp, reason: classification.isSelfHostedApp ? 'Complete refresh' : 'Classification requires review; existing listing retained',
      } });
    });
    return { repo: repo.fullName, status: 'updated', reason: classification.isSelfHostedApp ? `health=${scores.healthScore}` : 'classification needs review' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (claim) {
      await updateIfOwner(prisma, repo.id, claim, { lastScanAttemptAt: new Date(), lastScanError: reason.slice(0, 500) }).catch(() => undefined);
      await prisma.scan.create({ data: { repositoryId: repo.id, githubFullName: repo.fullName, stage: 'refresh', status: 'FAILED', completedAt: new Date(), error: reason.slice(0, 500) } }).catch(() => undefined);
    }
    return { repo: repo.fullName, status: 'error', reason };
  } finally {
    clearInterval(timer);
    await renewal;
    if (claim) await release(prisma, repo.id, claim);
  }
}

export async function runRefresh(argv = process.argv.slice(2)) {
  const { dryRun, repo, max } = parseArgs(argv);
  const repos = await pickRepos(max, repo);
  if (repo && !repos.length) throw new Error(`Repository not in catalog: ${repo}`);
  const outcomes = await runWithConcurrency(repos, positiveInt(process.env.REFRESH_CONCURRENCY, 2), r => refreshOne(r, dryRun));
  for (const result of outcomes) console.log(`[refresh] ${result.status} ${result.repo}: ${result.reason ?? ''}`);
  const summary = {
    scanned: outcomes.length, updated: outcomes.filter(o => o.status === 'updated').length,
    skipped: outcomes.filter(o => o.status === 'skipped').length, errors: outcomes.filter(o => o.status === 'error').length, dryRun,
  };
  if (!dryRun) {
    if (summary.errors) await sendAlert({ level: 'warning', title: 'Refresh failures', message: `${summary.errors}/${summary.scanned} repositories failed` });
    if (!summary.errors) await pingHeartbeat(); // A healthy run with nothing due is still healthy.
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRefresh().then(summary => { if (summary.errors) process.exitCode = 1; })
    .catch(async error => { console.error('[refresh] failed', error); process.exitCode = 1; await sendAlert({ level: 'error', title: 'Refresh failed', message: String(error) }); })
    .finally(() => prisma.$disconnect());
}
