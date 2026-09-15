-- Save the scoring breakdown alongside the composite score so the UI can explain the
-- total without reconstructing it: each component, its weight, the raw sub-score (0..1),
-- the weighted contribution, and the algorithm version + computedAt timestamp. Rows
-- created before this migration have no breakdown — the UI handles that case by showing
-- 'Breakdown not yet available'.
ALTER TABLE "Application" ADD COLUMN "scoreBreakdown" JSONB;
ALTER TABLE "Application" ADD COLUMN "scoreComputedAt" TIMESTAMP(3);
ALTER TABLE "Application" ADD COLUMN "scoreAlgorithmVersion" TEXT;
