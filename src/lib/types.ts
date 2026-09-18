import type { Application, Repository } from '@prisma/client';

// readmeExcerpt is 4 KB a row and only /apps/[slug] and /llms-full.txt render it — both
// truncated, to 1200 and 400 chars. Every other query omits it, so the shared shape leaves it
// out and the compiler stops anyone from rendering what the listing queries no longer fetch.
// Use AppWithFullRepo (assignable to this) where the excerpt really is needed.
export type AppWithRepo = Application & { repository: Omit<Repository, 'readmeExcerpt'> };
export type AppWithFullRepo = Application & { repository: Repository };

export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const steps: [number, string][] = [
    [60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'],
  ];
  let value = seconds;
  for (const [divisor, name] of steps) {
    if (value < divisor) return value <= 1 ? `1 ${name} ago` : `${value} ${name}s ago`;
    value = Math.floor(value / divisor);
  }
  return value <= 1 ? '1 year ago' : `${value} years ago`;
}
