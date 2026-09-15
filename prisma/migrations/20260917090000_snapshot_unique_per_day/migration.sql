-- recordedAt is a timestamp WITHOUT timezone, stored as UTC by the application.
-- Its direct date cast is independent of the database session timezone.
ALTER TABLE "MetricSnapshot" ADD COLUMN "recordedDay" DATE;
UPDATE "MetricSnapshot" SET "recordedDay" = "recordedAt"::date WHERE "recordedDay" IS NULL;

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
