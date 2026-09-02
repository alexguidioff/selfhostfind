import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'SelfHostFind — Discover self-hosted apps',
  description: 'An automatically-updated catalog of open-source, self-hostable applications for your NAS or homelab.',
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
            <nav className="text-sm flex gap-4 text-slate-600 dark:text-slate-400">
              <Link href="/?sort=trending">Trending</Link>
              <Link href="/?sort=newest">New</Link>
              <Link href="/admin">Admin</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-500">
          Data is discovered automatically from public GitHub repositories. Unverified entries
          may contain inaccuracies — see each app&apos;s verification status.
        </footer>
      </body>
    </html>
  );
}
