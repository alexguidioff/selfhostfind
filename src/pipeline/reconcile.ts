// Run periodically (recommended: daily, right before `snapshot`) to catch repos that go
// stale in a way discovery can never see: a repo that gets deleted or renamed simply stops
// appearing in search results — its old owner/name 404s, and discovery only *finds* new
// candidates, it never re-checks ones already in the catalog. This job looks every known
// repo up by its immutable githubId (which transparently follows renames) and heals the
// catalog: renamed repos get their new URL, archived repos lose their auto-verified badge
// (via lib/verification.ts), and deleted ones are flagged unreachable and filtered out of
// the public catalog (see lib/query.ts) without deleting their row — the history stays for
// anyone auditing why something disappeared.
//
// Also prunes old Scan rows (see SCAN_RETENTION_DAYS) so that table doesn't grow forever.

import { prisma } from '@/lib/db';
import { getRepositoryById, type RepositoryLookupResult } from '@/lib/github';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';
import { runWithConcurrency } from './concurrency';

const CONCURRENCY = Number(process.env.RECONCILE_CONCURRENCY ?? 5);
const SCAN_RETENTION_DAYS = Number(process.env.SCAN_RETENTION_DAYS ?? 90);

export interface ReconciliationInput {
  currentFullName: string;
  currentArchived: boolean;
  currentUnreachable: boolean;
  lookup: RepositoryLookupResult;
}

export interface ReconciliationUpdate {
  lastVerifiedAt: Date;
  unreachable?: boolean;
  owner?: string;
  name?: string;
  fullName?: string;
  repositoryUrl?: string;
  archived?: boolean;
  stars?: number;
  forks?: number;
  watchers?: number;
  openIssues?: number;
  pushedAt?: Date;
}

export interface ReconciliationResult {
  notable: boolean; // true for a rename/archive/reachability change worth logging
  update: ReconciliationUpdate;
  reason: string;
}

// Pure decision logic, kept separate from the DB/HTTP orchestration below so it's cheap to
// unit test against fabricated GitHub responses without a network or database.
export function resolveRepositoryReconciliation(input: ReconciliationInput, now: Date = new Date()): ReconciliationResult {
  if (!input.lookup.found) {
    if (input.currentUnreachable) {
      return { notable: false, update: { lastVerifiedAt: now }, reason: 'still unreachable' };
    }
    return {
      notable: true,
      update: { unreachable: true, lastVerifiedAt: now },
      reason: 'repository no longer found on GitHub (deleted, or transferred out of reach)',
    };
  }

  const repo = input.lookup.repo;
  const update: ReconciliationUpdate = {
    lastVerifiedAt: now,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.watchers_count,
    openIssues: repo.open_issues_count,
    pushedAt: new Date(repo.pushed_at),
  };
  const changes: string[] = [];

  if (input.currentUnreachable) {
    update.unreachable = false;
    changes.push('reachable again');
  }
  if (repo.full_name !== input.currentFullName) {
    update.owner = repo.owner.login;
    update.name = repo.name;
    update.fullName = repo.full_name;
    update.repositoryUrl = repo.html_url;
    changes.push(`renamed from ${input.currentFullName} to ${repo.full_name}`);
  }
  if (repo.archived !== input.currentArchived) {
    update.archived = repo.archived;
    changes.push(repo.archived ? 'became archived' : 'un-archived upstream');
  }

  return {
    notable: changes.length > 0,
    update,
    reason: changes.length > 0 ? changes.join('; ') : 'no material change',
  };
}

async function reconcileOne(repo: {
  id: string;
  githubId: bigint;
  fullName: string;
  archived: boolean;
  unreachable: boolean;
}): Promise<'ok' | 'error'> {
  try {
    const lookup = await getRepositoryById(repo.githubId);
    const result = resolveRepositoryReconciliation({
      currentFullName: repo.fullName,
      currentArchived: repo.archived,
      currentUnreachable: repo.unreachable,
      lookup,
    });

    await prisma.repository.update({ where: { id: repo.id }, data: result.update });

    if (result.notable) {
      console.log(`[reconcile] ${repo.fullName}: ${result.reason}`);
    }
    return 'ok';
  } catch (err) {
    console.error(`[reconcile] error checking ${repo.fullName}:`, err);
    return 'error';
  }
}

const FAILURE_RATE_ALERT_THRESHOLD = 0.3;
const FAILURE_RATE_ALERT_MIN_COUNT = 5;

export async function runReconcile(): Promise<{ checked: number; errors: number }> {
  const repos = await prisma.repository.findMany({
    where: { fork: false }, // forks are never stored as their own catalog entries in the first place, but guard anyway
    select: { id: true, githubId: true, fullName: true, archived: true, unreachable: true },
  });

  console.log(`[reconcile] checking ${repos.length} repositories against GitHub`);
  const outcomes = await runWithConcurrency(repos, CONCURRENCY, reconcileOne);
  const errors = outcomes.filter((o) => o === 'error').length;

  if (errors > 0 && errors === outcomes.length && outcomes.length > 0) {
    throw new Error(
      `All ${outcomes.length} repository lookups failed — likely an invalid/expired GITHUB_TOKEN or a GitHub API outage.`
    );
  }

  if (errors >= FAILURE_RATE_ALERT_MIN_COUNT && errors / outcomes.length > FAILURE_RATE_ALERT_THRESHOLD) {
    await sendAlert({
      level: 'warning',
      title: 'Reconcile: high failure rate',
      message: `${errors} of ${outcomes.length} repository lookups failed this run. This usually points to a systemic issue rather than isolated bad repos.`,
    });
  }

  const scanCutoff = new Date(Date.now() - SCAN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count: prunedScans } = await prisma.scan.deleteMany({ where: { startedAt: { lt: scanCutoff } } });
  if (prunedScans > 0) {
    console.log(`[reconcile] pruned ${prunedScans} Scan rows older than ${SCAN_RETENTION_DAYS} days`);
  }

  console.log(`[reconcile] done (${errors} errors)`);
  await pingHeartbeat();
  return { checked: repos.length, errors };
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runReconcile()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('[reconcile] fatal error', err);
      await sendAlert({
        level: 'error',
        title: 'Reconcile job crashed',
        message: String(err instanceof Error ? err.message : err),
      });
      await prisma.$disconnect();
      process.exit(1);
    });
}
