-- Idempotent daily snapshots: a snapshot recorded twice on the same UTC day for the same
-- repository is a duplicate we want to merge, not two competing rows. The unique index
-- makes the constraint explicit in the schema; the backfill dedupes existing data without
-- losing history from other days.
--
-- Note: this migration only runs on Postgres (the project's only supported DB).

-- 1. Identify and delete the older duplicate for any (repository, UTC day) pair.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "repositoryId", (date_trunc('day', "recordedAt" AT TIME ZONE 'UTC'))
           ORDER BY "recordedAt" DESC
         ) AS rn
  FROM "MetricSnapshot"
)
DELETE FROM "MetricSnapshot" m
USING ranked r
WHERE m.id = r.id AND r.rn > 1;

-- 2. Create the unique index that enforces idempotency going forward. Functional index on
--    date_trunc so we don't need to backfill a separate column.
CREATE UNIQUE INDEX "MetricSnapshot_repository_day_key"
  ON "MetricSnapshot" ("repositoryId", (date_trunc('day', "recordedAt" AT TIME ZONE 'UTC')));
