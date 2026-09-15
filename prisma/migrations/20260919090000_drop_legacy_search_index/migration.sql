-- The original migration created an INDEX, not the similarly named constraint
-- dropped later. Keeping it prevents the same search in two different contexts.
DROP INDEX IF EXISTS "SearchAggregate_day_query_filters_key";
