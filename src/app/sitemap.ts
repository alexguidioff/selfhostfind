import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/db';
import { CATEGORIES } from '@/lib/constants';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://selfhostfind.vercel.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // One row per app detail page. We use the latest pushedAt as lastModified so search engines
  // know when to come back; pages for archived/unreachable repos are excluded so Google doesn't
  // index dead content.
  const apps = await prisma.application.findMany({
    where: { hidden: false },
    select: {
      slug: true,
      updatedAt: true,
      repository: { select: { pushedAt: true, unreachable: true } },
    },
  });

  const appEntries: MetadataRoute.Sitemap = apps
    .filter((a) => !a.repository?.unreachable)
    .map((a) => ({
      url: `${SITE_URL}/apps/${a.slug}`,
      lastModified: a.repository?.pushedAt ?? a.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.8,
    }));

  // Category landing pages — each one is a long-tail SEO target ("self-hosted media server",
  // "self-hosted password manager", etc.). Static list, so we can hardcode them.
  const categoryEntries: MetadataRoute.Sitemap = CATEGORIES.map((slug) => ({
    url: `${SITE_URL}/category/${slug.toLowerCase().replace(/\s+/g, '-')}`,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  const now = new Date();

  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/?sort=trending`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/?sort=newest`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/llms-full.txt`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
    ...categoryEntries,
    ...appEntries,
  ];
}
