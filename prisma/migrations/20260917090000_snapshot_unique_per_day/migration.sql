-- Idempotent daily snapshots: a snapshot recorded twice on the same UTC day for the same
-- repository is a duplicate we want to merge, not two competing rows.
--
-- Implementation notes:
-- - recordedAt is TIMESTAMP(3) (no time zone) in Prisma's default mapping. Applying
--   AT TIME ZONE 'UTC' to a TIMESTAMP raises "cannot cast type timestamp without time
--   zone to timestamp with time zone" on PostgreSQL. We instead backfill a recordedDay
--   column (DATE) at midnight UTC and unique-index on (repositoryId, recordedDay). Two
--   rows in the same UTC day converge to the same recordedDay value and the older one is
--   deleted by the dedupe CTE before the unique index is created.
-- - This migration is a no-op on an empty table (CTE matches nothing). On a populated
--   catalog it preserves the most recent recordedAt per (repository, day) without
--   deleting history from other days.

-- 1. Add the column. Existing rows get NULL; we backfill next.
ALTER TABLE "MetricSnapshot" ADD COLUMN "recordedDay" DATE;

-- 2. Backfill recordedDay from existing recordedAt, treating it as UTC (the snapshot
--    job always writes UTC values, by the project's convention).
UPDATE "MetricSnapshot"
SET "recordedDay" = ("recordedAt" AT TIME ZONE 'UTC')::date
WHERE "recordedDay" IS NULL;

-- 3. For the few repositories that have more than one row per UTC day, keep the latest
--    and delete the rest. This is what made the previous version fail: an old row at,
--    say, 14:32 on the same day would survive a later delete targeted at midnight.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "repositoryId", "recordedDay"
           ORDER BY "recordedAt" DESC
         ) AS rn
  FROM "MetricSnapshot"
)
DELETE FROM "MetricSnapshot" m
USING ranked r
WHERE m.id = r.id AND r.rn > 1;

-- 4. Make the column NOT NULL now that every row has a value, and enforce uniqueness.
ALTER TABLE "MetricSnapshot" ALTER COLUMN "recordedDay" SET NOT NULL;
CREATE UNIQUE INDEX "MetricSnapshot_repository_day_key"
  ON "MetricSnapshot" ("repositoryId", "recordedDay");
CREATE INDEX "MetricSnapshot_recordedDay_idx" ON "MetricSnapshot" ("recordedDay");
