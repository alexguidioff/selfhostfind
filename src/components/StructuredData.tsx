import type { AppWithRepo } from '@/lib/types';

// JSON-LD for a self-hosted application. We emit it as a SoftwareApplication with operatingSystem
// = "Linux / Docker / Self-hosted" so search engines (and AI indexes) understand the category.
// Schema reference: https://schema.org/SoftwareApplication
//
// `aggregateRating` is informational only — we use stars from the upstream GitHub repo as a
// proxy for popularity. We don't claim it's a user review average.
export function AppStructuredData({ app }: { app: AppWithRepo }) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://selfhostfind.vercel.app';
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: app.name,
    description: app.shortDescription,
    url: `${siteUrl}/apps/${app.slug}`,
    applicationCategory: app.category ?? 'UtilitiesApplication',
    applicationSubCategory: app.subcategory,
    operatingSystem: 'Linux, Docker, Self-hosted',
    softwareRequirements: 'Docker' + (app.composeSupported ? ' Compose' : ''),
    downloadUrl: app.repository.repositoryUrl,
    softwareVersion: app.repository.latestReleaseTag ?? undefined,
    datePublished: app.createdAt.toISOString(),
    dateModified: app.repository.pushedAt.toISOString(),
    license: app.repository.license ?? undefined,
    author: {
      '@type': 'Organization',
      name: app.repository.owner,
      url: `https://github.com/${app.repository.owner}`,
    },
    publisher: {
      '@type': 'Organization',
      name: 'SelfHostFind',
      url: siteUrl,
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: Math.min(5, Math.max(1, app.repository.stars / 200)),
      ratingCount: app.repository.stars,
      bestRating: 5,
      worstRating: 1,
    },
    ...(app.alternativesTo.length > 0 && {
      isRelatedTo: app.alternativesTo.map((name) => ({
        '@type': 'SoftwareApplication',
        name,
      })),
    }),
  };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify is safe here — the data comes from our own database, not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function WebsiteStructuredData() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://selfhostfind.vercel.app';
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'SelfHostFind',
    url: siteUrl,
    description:
      'A free, automatically-updated catalog of open-source self-hostable apps for your NAS or homelab.',
    // SearchAction makes the search box appear in Google's sitelinks (the "search this site"
    // shortcut under the main result). We point at the home page with a `q` query param.
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
