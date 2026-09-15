-- Add context to the SearchAggregate unique key. Same-day, same-query, same-filter
-- searches from different page contexts are now separate rows; the admin view can
-- tell "global gap" apart from "this user couldn't find anything in the alternatives
-- view specifically".
--
-- Drop the old 3-column unique constraint, then add the 4-column one. The migration
-- is idempotent on a fresh database (the DROP IF EXISTS no-ops), which is what makes
-- `prisma migrate deploy` safe.
ALTER TABLE "SearchAggregate" DROP CONSTRAINT IF EXISTS "SearchAggregate_dayUtc_normalizedQuery_filterSignature_key";
ALTER TABLE "SearchAggregate" ADD CONSTRAINT "SearchAggregate_dayUtc_normalizedQuery_filterSignatu_key"
  UNIQUE ("dayUtc", "normalizedQuery", "filterSignature", "context");
