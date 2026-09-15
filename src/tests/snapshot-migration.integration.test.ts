import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { describe, it, expect } from 'vitest';

const migration = readFileSync('prisma/migrations/20260917090000_snapshot_unique_per_day/migration.sql', 'utf8');
describe.skipIf(!process.env.TEST_DATABASE_URL)('snapshot migration on historical data', () => {
  it.each(['UTC', 'Europe/Rome'])('deduplicates by stored UTC day with session timezone %s', async timezone => {
    const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
    const schema = `migration_${randomUUID().replaceAll('-', '')}`;
    try {
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${timezone}'`);
        await tx.$executeRawUnsafe('CREATE TABLE "MetricSnapshot" (id text PRIMARY KEY, "repositoryId" text NOT NULL, "recordedAt" timestamp(3) NOT NULL)');
        await tx.$executeRawUnsafe(`INSERT INTO "MetricSnapshot" VALUES
          ('old', 'r', '2026-01-01 00:30'), ('latest', 'r', '2026-01-01 23:30'), ('next', 'r', '2026-01-02 00:30')`);
        // This migration has plain SQL statements; strip comments before splitting.
        for (const statement of migration.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim())) {
          await tx.$executeRawUnsafe(statement);
        }
        const rows = await tx.$queryRawUnsafe<Array<{id: string; day: string}>>('SELECT id, "recordedDay"::text AS day FROM "MetricSnapshot" ORDER BY "recordedAt"');
        expect(rows).toEqual([{ id: 'latest', day: '2026-01-01' }, { id: 'next', day: '2026-01-02' }]);
        await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      });
    } finally { await db.$disconnect(); }
  });
});
