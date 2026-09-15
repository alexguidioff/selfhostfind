// Atomic scan claim for the refresh job.
//
// The catalog has many writers that shouldn't step on each other:
//   - the daily cron pipeline (`pnpm refresh`)
//   - the API route that triggers refresh on demand
//   - a developer running `pnpm refresh --repo <name>` locally
//
// Two of those writing the same Repository row at the same time would clobber each
// other: one saves stars=100, the other saves stars=200, whichever commits last wins,
// and there's no audit trail saying which is wrong.
//
// `claim` uses a single conditional UPDATE per repo: it only succeeds if no live claim
// exists OR the existing claim is held by the same worker. The TTL is short so a crashed
// worker doesn't lock the row indefinitely; a healthy worker renews the TTL mid-flight
// (`renew`) and verifies ownership before the final save (`release`).

import { hostname } from 'os';
import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';

export const DEFAULT_TTL_MS = Number(process.env.REFRESH_CLAIM_TTL_MS ?? 10 * 60 * 1000); // 10 min
const WORKER_ID = `${hostname()}#${process.pid}-${randomUUID().slice(0, 8)}`;

export function currentWorkerId(): string { return WORKER_ID; }

export interface ClaimHandle {
  workerId: string;
  expiresAt: Date;
}

// Atomically try to claim a repository. Returns a handle on success, null if another
// worker owns the claim and the TTL has not expired yet. Safe to call concurrently:
// the underlying UPDATE...WHERE in Postgres serializes attempts on the same row.
export async function tryClaim(
  prisma: PrismaClient,
  repositoryId: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<ClaimHandle | null> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const result = await prisma.repository.updateMany({
    where: {
      id: repositoryId,
      OR: [
        { scanClaimId: null },
        { scanClaimExpiresAt: { lt: new Date() } },
        { scanClaimId: WORKER_ID },
      ],
    },
    data: { scanClaimId: WORKER_ID, scanClaimExpiresAt: expiresAt, scanClaimWorkerId: WORKER_ID },
  });
  if (result.count === 0) return null;
  return { workerId: WORKER_ID, expiresAt };
}

// Renew the claim so a long-running analysis doesn't lose its lock. Idempotent: it only
// refreshes the TTL if the row is still ours. Returns the new expiry, or null if we lost
// the claim mid-flight (in which case the worker should abort rather than write).
export async function renew(
  prisma: PrismaClient,
  repositoryId: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<Date | null> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const result = await prisma.repository.updateMany({
    where: { id: repositoryId, scanClaimId: WORKER_ID },
    data: { scanClaimExpiresAt: expiresAt },
  });
  if (result.count === 0) return null;
  return expiresAt;
}

// Release the claim so the next worker can pick it up immediately. Safe even if we never
// held the claim: the WHERE filters by workerId, so a release from the wrong worker is
// a no-op.
export async function release(prisma: PrismaClient, repositoryId: string): Promise<void> {
  await prisma.repository.updateMany({
    where: { id: repositoryId, scanClaimId: WORKER_ID },
    data: { scanClaimId: null, scanClaimExpiresAt: null, scanClaimWorkerId: null },
  });
}

// Owner-checked update: the caller's write only commits if we still hold the claim.
// Returns the number of rows updated (0 means we lost the race and the caller must
// NOT have written elsewhere).
export async function updateIfOwner<T extends Record<string, unknown>>(
  prisma: PrismaClient,
  repositoryId: string,
  data: T
): Promise<number> {
  const result = await prisma.repository.updateMany({
    where: { id: repositoryId, scanClaimId: WORKER_ID },
    data: data as never,
  });
  return result.count;
}

export async function applicationUpdateIfOwner<T extends Record<string, unknown>>(
  prisma: PrismaClient,
  applicationId: string,
  ownerRepositoryId: string,
  data: T
): Promise<number> {
  // Application has no claim column; we verify ownership indirectly by joining through
  // the Repository's scanClaimId, which is the canonical lock holder.
  const result = await prisma.application.updateMany({
    where: { id: applicationId, repositoryId: ownerRepositoryId, repository: { scanClaimId: WORKER_ID } },
    data: data as never,
  });
  return result.count;
}
