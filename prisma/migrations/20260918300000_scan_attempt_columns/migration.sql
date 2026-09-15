-- Add columns used by the refresh pipeline's "last attempt" tracking. These were added to
-- prisma/schema.prisma in commit 554df5a (Phase 2: refresh pipeline) but the corresponding
-- ALTER TABLE never landed in a migration. The Prisma client typed them, but querying them
-- at runtime failed with "column does not exist" until this migration runs.
ALTER TABLE "Repository" ADD COLUMN "lastScanAttemptAt" TIMESTAMP(3);
ALTER TABLE "Repository" ADD COLUMN "lastScanError" TEXT;
