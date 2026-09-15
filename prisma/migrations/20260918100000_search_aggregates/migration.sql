-- Daily aggregates of zero-result searches. Written only when SEARCH_LOG_ENABLED=true
-- (a server-side gate, see /api/search-log), so the table stays empty by default.
-- Atomic increments via upsert keyed on (day, normalized_query, filter_signature) mean
-- concurrent submissions never lose a count, and the admin view can read this table
-- directly without joining events.
CREATE TABLE "SearchAggregate" (
    id                 TEXT PRIMARY KEY,
    "dayUtc"           TIMESTAMP(3) NOT NULL,
    "normalizedQuery"  TEXT NOT NULL,
    "filterSignature"  TEXT NOT NULL,
    "searchCount"      INTEGER NOT NULL DEFAULT 0,
    "zeroResultCount"  INTEGER NOT NULL DEFAULT 0,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SearchAggregate_day_query_filters_key"
  ON "SearchAggregate" ("dayUtc", "normalizedQuery", "filterSignature");
CREATE INDEX "SearchAggregate_dayUtc_idx" ON "SearchAggregate" ("dayUtc");
