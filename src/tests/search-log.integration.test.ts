import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { recordSearch, pruneSearchLogs } from '@/lib/search-log';
import { POST } from '@/app/api/search-log/route';
vi.hoisted(() => { if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; });
const prefix = `searchqa${randomUUID().replaceAll('-', '')}`;
const product = `${prefix}product`;

describe.skipIf(!process.env.TEST_DATABASE_URL)('search aggregation on PostgreSQL', () => {
  beforeAll(async () => {
    vi.stubEnv('SEARCH_LOG_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://catalog.example');
    for (const [index, name, category, alternativesTo] of [[0, `${prefix}notes`, 'Notes', []], [1, `${prefix}photos`, 'Photos', [product]]] as const) {
      await prisma.repository.create({ data: {
        githubId: BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 13)}`), owner: prefix, name, fullName: `${prefix}/${index}`,
        repositoryUrl: 'https://github.com/example/app', createdAt: new Date(), pushedAt: new Date(),
        application: { create: { slug: name, name, category, alternativesTo: [...alternativesTo], isSelfHosted: true } },
      } });
    }
  });
  afterAll(async () => {
    await prisma.searchAggregate.deleteMany({ where: { normalizedQuery: { startsWith: prefix } } });
    await prisma.repository.deleteMany({ where: { owner: prefix } });
    await prisma.$disconnect(); vi.unstubAllEnvs();
  });

  it('counts the actual alternative/category scope and separates it from global searches', async () => {
    for (const context of ['home', `alternatives:${product}`, 'category:photos']) {
      expect(await recordSearch({ query: `${prefix}notes`, params: {}, context }), context).toEqual({ recorded: true });
    }
    const rows = await prisma.searchAggregate.findMany({ where: { normalizedQuery: `${prefix}notes` } });
    expect(rows).toHaveLength(3);
    expect(rows.find(r => r.context === 'home')!.zeroResultCount).toBe(0);
    expect(rows.filter(r => r.context !== 'home').every(r => r.zeroResultCount === 1)).toBe(true);
    expect((await recordSearch({ query: `${prefix}notes`, params: { category: 'invalid' } })).recorded).toBe(false);
    expect((await recordSearch({ query: `${prefix}notes`, params: {}, context: 'alternatives:not-in-catalog' })).recorded).toBe(false);
  });

  it('atomically accumulates concurrent searches and prunes only expired data', async () => {
    const query = `${prefix}missing`;
    await Promise.all(Array.from({ length: 8 }, () => recordSearch({ query, params: { docker: '1' } })));
    const rows = await prisma.searchAggregate.findMany({ where: { normalizedQuery: query } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ searchCount: 8, zeroResultCount: 8 });
    await prisma.searchAggregate.create({ data: { dayUtc: new Date(0), normalizedQuery: `${prefix}expired`, filterSignature: '', context: 'home' } });
    await pruneSearchLogs();
    expect(await prisma.searchAggregate.count({ where: { normalizedQuery: `${prefix}expired` } })).toBe(0);
    expect(await prisma.searchAggregate.count({ where: { normalizedQuery: query } })).toBe(1);
  });

  it('rejects secrets, invalid payloads and cross-origin requests without writes', async () => {
    expect((await recordSearch({ query: `${prefix} sk-proj-abcdefghijklmnop`, params: {} })).recorded).toBe(false);
    const request = (body: string, origin = 'https://catalog.example') => new Request('https://catalog.example/api/search-log', { method: 'POST', headers: { origin }, body });
    expect((await POST(request('null'))).status).toBe(400);
    expect((await POST(request('{}', 'https://elsewhere.example'))).status).toBe(403);
    expect((await POST(request(JSON.stringify({ q: `${prefix}route`, context: 'home' })))).status).toBe(200);
    vi.stubEnv('SEARCH_LOG_ENABLED', 'false');
    expect((await POST(request('not json'))).status).toBe(204);
    vi.stubEnv('SEARCH_LOG_ENABLED', 'true');
  });

  it('cancels a chunked body as soon as the byte budget is exceeded', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(4097)); },
      cancel() { cancelled = true; },
    });
    const request = new Request('https://catalog.example/api/search-log', {
      method: 'POST', headers: { origin: 'https://catalog.example' }, body: stream, duplex: 'half',
    } as RequestInit);
    expect((await POST(request)).status).toBe(413);
    expect(cancelled).toBe(true);
  });
});
