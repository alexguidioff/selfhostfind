import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://selfhostfind.vercel.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Keep admin and API out of every indexer — admin auth shouldn't show in search,
        // and the cron/discover endpoint would just confuse crawlers if it ever returned
        // anything (it's protected by CRON_SECRET, but no reason to advertise it).
        disallow: ['/admin', '/api/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
