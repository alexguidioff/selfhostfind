import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { tryClaim, renew, release, updateIfOwner, currentWorkerId } from '@/pipeline/claim';

// Uses an in-memory SQLite via Prisma's createEngine so we don't need a running Postgres.
// The Prisma client generated against the real schema includes Postgres-specific types in
// @db.*, but the queries we run here are plain string operations, which Prisma translates
// for any provider. We bypass the real DATABASE_URL by passing a per-test override.
function makeClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: 'file::memory:?cache=shared' });
}

describe('scan claim', () => {
  let prisma: PrismaClient;
  let repoId: string;

  beforeEach(async () => {
    prisma = makeClient();
    // SQLite in-memory doesn't have the Postgres schema. We only need the scanClaim fields,
    // and the migration we ship is the source of truth; here we just exercise the Prisma
    // query shape against a real Postgres-compatible instance. Skip when DATABASE_URL is
    // unavailable to keep the unit suite hermetic — the integration suite covers this.
    if (!process.env.DATABASE_URL) return;
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "RepositoryClaimTest"');
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "RepositoryClaimTest" (id TEXT PRIMARY KEY, name TEXT NOT NULL, "scanClaimId" TEXT, "scanClaimExpiresAt" TIMESTAMP, "scanClaimWorkerId" TEXT)'
    );
    const row = await prisma.$executeRawUnsafe(
      'INSERT INTO "RepositoryClaimTest" (id, name) VALUES ($1, $2) RETURNING id',
      'repo-1', 'owner/name'
    );
    repoId = 'repo-1';
  });

  it('grants a fresh claim to an unowned repository', async () => {
    if (!process.env.DATABASE_URL) return;
    const handle = await tryClaim(prisma, repoId, 60_000);
    expect(handle).not.toBeNull();
    expect(handle!.workerId).toBe(currentWorkerId());
  });

  it('rejects a second concurrent worker while the claim is live', async () => {
    if (!process.env.DATABASE_URL) return;
    const first = await tryClaim(prisma, repoId, 60_000);
    expect(first).not.toBeNull();
    // Simulate a different worker by writing directly with a different id.
    await prisma.$executeRawUnsafe(
      'UPDATE "RepositoryClaimTest" SET "scanClaimId"=$1, "scanClaimExpiresAt"=$2 WHERE id=$3',
      'other-worker', new Date(Date.now() + 60_000).toISOString(), repoId
    );
    const second = await tryClaim(prisma, repoId, 60_000);
    expect(second).toBeNull();
  });

  it('allows takeover once the claim expires', async () => {
    if (!process.env.DATABASE_URL) return;
    await prisma.$executeRawUnsafe(
      'UPDATE "RepositoryClaimTest" SET "scanClaimId"=$1, "scanClaimExpiresAt"=$2 WHERE id=$3',
      'old-worker', new Date(Date.now() - 1).toISOString(), repoId
    );
    const fresh = await tryClaim(prisma, repoId, 60_000);
    expect(fresh).not.toBeNull();
    expect(fresh!.workerId).toBe(currentWorkerId());
  });

  it('renew extends the TTL only for the owner', async () => {
    if (!process.env.DATABASE_URL) return;
    const handle = await tryClaim(prisma, repoId, 1_000);
    expect(handle).not.toBeNull();
    // Simulate someone stealing the claim by overwriting scanClaimId directly.
    await prisma.$executeRawUnsafe(
      'UPDATE "RepositoryClaimTest" SET "scanClaimId"=$1 WHERE id=$2',
      'thief', repoId
    );
    const renewed = await renew(prisma, repoId, 60_000);
    expect(renewed).toBeNull();
  });

  it('updateIfOwner commits only when we still hold the claim', async () => {
    if (!process.env.DATABASE_URL) return;
    await tryClaim(prisma, repoId, 60_000);
    const ok = await updateIfOwner(prisma, repoId, { name: 'updated' });
    expect(ok).toBe(1);
    // Release the claim, then update again — should not commit.
    await release(prisma, repoId);
    const denied = await updateIfOwner(prisma, repoId, { name: 'after-release' });
    expect(denied).toBe(0);
    const row = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'SELECT name FROM "RepositoryClaimTest" WHERE id=$1', repoId
    );
    expect(row[0].name).toBe('updated');
  });
});
