-- Atomic claim for refresh workers. Two CLI runs (or a worker plus the API route)
-- must not both write to the same Repository row at the same time. The worker takes the
-- claim with a TTL; if it crashes, another worker (or the next run) reclaims after
-- expiry. The TTL is short (default 10 min in code) and refreshed during long-running
-- analyses so a healthy worker never loses its claim mid-flight.
ALTER TABLE "Repository" ADD COLUMN "scanClaimId" TEXT;
ALTER TABLE "Repository" ADD COLUMN "scanClaimExpiresAt" TIMESTAMP(3);
ALTER TABLE "Repository" ADD COLUMN "scanClaimWorkerId" TEXT;
CREATE INDEX "Repository_scanClaimExpiresAt_idx" ON "Repository"("scanClaimExpiresAt");
