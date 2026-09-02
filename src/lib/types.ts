import type { Application, Repository } from '@prisma/client';

export type AppWithRepo = Application & { repository: Repository };

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
