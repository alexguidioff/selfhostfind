import Link from 'next/link';
import Image from 'next/image';
import { Badge } from './Badge';
import type { AppWithRepo } from '@/lib/types';
import { timeAgo } from '@/lib/types';

export function AppCard({ app }: { app: AppWithRepo }) {
  const logo = app.logoUrl ?? app.screenshotUrls[0] ?? null;

  return (
    <Link
      href={`/apps/${app.slug}`}
      className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-brand-500 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center text-slate-400 text-xs">
          {logo ? (
            <Image src={logo} alt="" width={40} height={40} className="object-cover h-full w-full" unoptimized />
          ) : (
            app.name.slice(0, 2).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{app.name}</h3>
            {app.category && <Badge>{app.category}</Badge>}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mt-1">
            {app.shortDescription ?? 'No description available.'}
          </p>
        </div>
      </div>

      {app.alternativesTo.length > 0 && (
        <p className="text-xs text-slate-500 mt-2">
          Alternative to <span className="font-medium">{app.alternativesTo.join(', ')}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {app.composeSupported && <Badge variant="docker">Docker Compose</Badge>}
        {!app.composeSupported && app.dockerSupported && <Badge variant="docker">Docker</Badge>}
        {app.arm64Supported && <Badge variant="arm">ARM64</Badge>}
        {app.repository.license && <Badge variant="license">{app.repository.license}</Badge>}
        {app.repository.archived && <Badge variant="archived">Archived upstream</Badge>}
        <Badge variant={app.verificationStatus === 'UNVERIFIED' ? 'unverified' : 'verified'}>
          {app.verificationStatus === 'UNVERIFIED' ? 'Unverified' : app.verificationStatus === 'AUTO_VERIFIED' ? 'Auto-verified' : 'Verified'}
        </Badge>
      </div>

      <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
        <span>⭐ {app.repository.stars.toLocaleString()}</span>
        <span>Updated {timeAgo(app.repository.pushedAt)}</span>
        <span>Health {Math.round(app.healthScore)}</span>
      </div>
    </Link>
  );
}
