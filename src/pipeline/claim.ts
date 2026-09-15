import { hostname } from 'os';
import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { positiveInt } from './refresh.args';

export const DEFAULT_TTL_MS = positiveInt(process.env.REFRESH_CLAIM_TTL_MS, 600_000);
const WORKER_ID = `${hostname()}#${process.pid}`;
export function currentWorkerId(): string { return WORKER_ID; }
export interface ClaimHandle { id: string; workerId: string; expiresAt: Date; }

export function claimWhere(repositoryId: string, claim: ClaimHandle) {
  return { id: repositoryId, scanClaimId: claim.id, scanClaimExpiresAt: { gt: new Date() } };
}

export async function tryClaim(prisma: PrismaClient, repositoryId: string, ttlMs = DEFAULT_TTL_MS): Promise<ClaimHandle | null> {
  const claim = { id: randomUUID(), workerId: WORKER_ID, expiresAt: new Date(Date.now() + ttlMs) };
  const result = await prisma.repository.updateMany({
    where: { id: repositoryId, OR: [{ scanClaimId: null }, { scanClaimExpiresAt: { lte: new Date() } }] },
    data: { scanClaimId: claim.id, scanClaimExpiresAt: claim.expiresAt, scanClaimWorkerId: WORKER_ID },
  });
  return result.count ? claim : null;
}

export async function renew(prisma: PrismaClient, repositoryId: string, claim: ClaimHandle, ttlMs = DEFAULT_TTL_MS): Promise<Date | null> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const result = await prisma.repository.updateMany({
    where: claimWhere(repositoryId, claim), data: { scanClaimExpiresAt: expiresAt },
  });
  return result.count ? expiresAt : null;
}

export async function release(prisma: PrismaClient, repositoryId: string, claim: ClaimHandle): Promise<void> {
  await prisma.repository.updateMany({
    where: { id: repositoryId, scanClaimId: claim.id },
    data: { scanClaimId: null, scanClaimExpiresAt: null, scanClaimWorkerId: null },
  });
}

export async function updateIfOwner(prisma: PrismaClient, repositoryId: string, claim: ClaimHandle, data: import('@prisma/client').Prisma.RepositoryUpdateManyMutationInput): Promise<number> {
  return (await prisma.repository.updateMany({ where: claimWhere(repositoryId, claim), data })).count;
}
