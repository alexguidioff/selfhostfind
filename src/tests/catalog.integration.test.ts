import { reclassifyCatalog } from '@/pipeline/reclassify';
import { getAlternativeProducts } from '@/lib/alternatives';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { getCatalogPage } from '@/lib/catalog';

// Opt in only against a disposable database: TEST_DATABASE_URL=... pnpm test.
const databaseUrl = process.env.TEST_DATABASE_URL;
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
const prefix = `catalog-test-${randomUUID()}`;
const scope = { slug: { startsWith: prefix } };

describe.skipIf(!databaseUrl)('catalog on PostgreSQL', () => {
  beforeAll(async () => {
    for (let i = 0; i < 65; i++) {
      await prisma.repository.create({ data: {
        githubId: BigInt(Date.now()) * 100n + BigInt(i), owner: prefix, name: String(i), fullName: `${prefix}/${i}`,
        repositoryUrl: 'https://github.com/example/app', createdAt: new Date(), pushedAt: new Date(),
        unreachable: i === 64,
        application: { create: {
          slug: `${prefix}-${i}`, name: i === 0 ? 'Notes' : `App ${i}`,
          shortDescription: 'Notes application with photo storage', category: 'Notes', isSelfHosted: i !== 63,
          hidden: i === 62, alternativesTo: i === 1 ? ['gOoGlE   Photos'] : [],
          healthScore: i, dockerSupported: i % 2 === 0,
        } },
      } });
    }
  }, 30000);
  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner: prefix } });
    await prisma.$disconnect();
  });
  it('counts all visible results and paginates without duplicates, keeping exact names first', async () => {
    const first = await getCatalogPage({ q: 'self-hosted notes' }, scope);
    const second = await getCatalogPage({ q: 'self-hosted notes', page: '2' }, scope);
    expect(first.total).toBe(62);
    expect(first.apps).toHaveLength(60);
    expect(first.apps[0].name).toBe('Notes');
    expect(second.apps).toHaveLength(2);
    expect(new Set([...first.apps, ...second.apps].map((app) => app.id)).size).toBe(62);
    const sorted = await getCatalogPage({ sort: 'health' }, scope);
    expect(sorted.apps[0].healthScore).toBe(61);
    expect((await getCatalogPage({ page: '999' }, scope)).page).toBe(2);
  });
  it('matches multiword alternatives regardless of case, honors filters and binds hostile input', async () => {
    const alternatives = await getCatalogPage({ q: 'alternative to GOOGLE PHOTOS' }, scope);
    expect(alternatives.apps.map((app) => app.name)).toEqual(['App 1']);
    expect((await getCatalogPage({ q: 'alternative to google photos', docker: '1' }, scope)).total).toBe(0);
    expect((await getCatalogPage({ q: "' OR 1=1 --" }, scope)).total).toBe(0);
    expect((await getCatalogPage({ q: 'notes storage' }, scope)).total).toBe(62);
  });
  it('reclassifies existing apps while preserving manual corrections and queuing ambiguity', async () => {
    const curated = await prisma.application.findUniqueOrThrow({ where: { slug: `${prefix}-0` } });
    const ambiguous = await prisma.application.findUniqueOrThrow({ where: { slug: `${prefix}-2` } });
    await prisma.repository.update({ where: { id: curated.repositoryId }, data: {
      description: 'Self-hosted bookmark manager.', topics: ['self-hosted', 'bookmarks'],
    } });
    await prisma.application.update({ where: { id: curated.id }, data: {
      category: 'Gaming', alternativesTo: ['Curated Service'], manualOverrides: { category: true, alternativesTo: true },
      verificationStatus: 'MANUALLY_VERIFIED',
    } });
    await prisma.repository.update({ where: { id: ambiguous.repositoryId }, data: {
      description: 'Self-hosted bookmarks and RSS.',
    } });
    await prisma.application.update({ where: { id: ambiguous.id }, data: { verificationStatus: 'AUTO_VERIFIED' } });
    const selection = { id: { in: [curated.id, ambiguous.id] } };
    await reclassifyCatalog(selection);
    await reclassifyCatalog(selection);
    const kept = await prisma.application.findUniqueOrThrow({ where: { id: curated.id } });
    expect(kept.category).toBe('Gaming');
    expect(kept.alternativesTo).toEqual(['Curated Service']);
    expect(kept.verificationStatus).toBe('MANUALLY_VERIFIED');
    const pending = await prisma.application.findUniqueOrThrow({ where: { id: ambiguous.id } });
    expect(pending.category).toBeNull();
    expect(pending.classificationReviewReasons.join(' ')).toContain('ambiguous');
    expect(pending.verificationStatus).toBe('UNVERIFIED');
    expect(pending.isSelfHosted).toBe(true);
  });

  it('only offers alternative pages for publicly visible applications', async () => {
    await prisma.application.update({ where: { slug: `${prefix}-62` }, data: { alternativesTo: [`${prefix} secret`] } });
    await prisma.application.update({ where: { slug: `${prefix}-64` }, data: { alternativesTo: [`${prefix} gone`] } });
    const products = await getAlternativeProducts();
    expect(products.some((product) => product.name === `${prefix} secret`)).toBe(false);
    expect(products.some((product) => product.name === `${prefix} gone`)).toBe(false);
    const google = products.find((product) => product.slug === 'google-photos')!;
    const result = await getCatalogPage({}, { AND: [scope, { alternativesTo: { hasSome: google.names } }] });
    expect(result.apps.map((app) => app.slug)).toEqual([`${prefix}-1`]);
  });

});
