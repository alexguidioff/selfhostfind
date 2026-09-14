ALTER TABLE "Application" ADD COLUMN "composePath" TEXT;

-- Earlier scans assumed AMD64 from Docker and ARM64 from generic multi-arch text.
-- Keep human overrides; automated values need fresh evidence.
UPDATE "Application" SET "amd64Supported" = NULL
WHERE NOT COALESCE("manualOverrides" @> '{"amd64Supported": true}'::jsonb, false);
UPDATE "Application" SET "arm64Supported" = NULL
WHERE NOT COALESCE("manualOverrides" @> '{"arm64Supported": true}'::jsonb, false);
