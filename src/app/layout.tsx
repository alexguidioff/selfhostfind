import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://selfhostfind.vercel.app';
const SITE_NAME = 'SelfHostFind';
const DESCRIPTION =
  'A free, automatically-updated catalog of open-source self-hostable apps. ' +
  'Find your next NAS, homelab, or privacy-friendly replacement — sorted by health, trending, and stars.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Discover self-hosted apps for your NAS & homelab`,
    template: `%s — ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'self-hosted', 'self host', 'homelab', 'NAS', 'docker', 'docker compose',
    'open source', 'privacy', 'self-hostable', 'apps', 'catalog', 'directory',
    'alternative to', 'Nextcloud alternative', 'Plex alternative',
  ],
  authors: [{ name: 'SelfHostFind' }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Discover self-hosted apps for your NAS & homelab`,
    description: DESCRIPTION,
    images: [
      {
        url: '/og-default.png',
        width: 1200,
        height: 630,
        alt: 'SelfHostFind — the catalog of self-hosted apps',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Discover self-hosted apps`,
    description: DESCRIPTION,
    images: ['/og-default.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  // Help AI crawlers (GPTBot, ClaudeBot, PerplexityBot) know they can use our content
  // for citations — these tokens are honored by all major model providers.
  other: {
    'ai-content-declaration': 'allowed',
    // Google Search Console verification — paste the value Google gives you here, or set
    // NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION in Vercel env vars and it'll be picked up.
    'google-site-verification': process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ?? '',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-semibold text-lg text-brand-600 dark:text-brand-500">
              SelfHostFind
            </Link>
            <nav className="text-sm flex gap-4 text-slate-600 dark:text-slate-400" aria-label="Main">
              <Link href="/?sort=trending">Trending</Link>
              <Link href="/?sort=newest">New</Link>
              <Link href="/category">Categories</Link>
              <Link href="/tag">Capabilities</Link>
              <Link href="/admin">Admin</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-500 border-t border-slate-200 dark:border-slate-800 mt-12">
          <p>
            SelfHostFind is an <strong>open-source</strong>, automatically-updated catalog of
            self-hostable apps. Data is discovered from public GitHub repositories each night —
            unverified entries may contain inaccuracies, see each app&apos;s verification status.
          </p>
          <p className="mt-2 flex flex-wrap gap-3">
            <Link href="/llms.txt" className="underline">llms.txt</Link>
            <Link href="/llms-full.txt" className="underline">llms-full.txt</Link>
            <Link href="/sitemap.xml" className="underline">sitemap</Link>
            <a href="https://github.com/alexguidioff/selfhostfind" className="underline" rel="noreferrer">GitHub</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
