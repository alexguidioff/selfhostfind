import { cache } from 'react';
import { createHash } from 'node:crypto';
import { prisma } from './db';
import { buildApplicationWhere } from './query';
import { slugify } from './slug';

export function groupAlternatives(apps: { id: string; alternativesTo: string[] }[]) {
  const groups = new Map<string, { name: string; names: Set<string>; ids: Set<string> }>();
  for (const app of apps) for (const name of app.alternativesTo) {
    const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) continue;
    const group = groups.get(key) ?? { name: name.trim().replace(/\s+/g, ' '), names: new Set<string>(), ids: new Set<string>() };
    group.names.add(name);
    group.ids.add(app.id);
    groups.set(key, group);
  }
  const bases = [...groups.keys()].map((key) => slugify(key) || 'product');
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);
  return [...groups.entries()].map(([key, group], index) => {
    const base = bases[index];
    const collision = (counts.get(base) ?? 0) > 1;
    return { name: group.name, names: [...group.names], count: group.ids.size,
      slug: collision ? `${base}-${createHash('sha256').update(key).digest('hex').slice(0, 8)}` : base };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Scans the whole catalog, and /alternatives/[slug] calls it twice per request — once in
// generateMetadata, once in the page. cache() collapses those into one query per request.
export const getAlternativeProducts = cache(async () => {
  return groupAlternatives(await prisma.application.findMany({
    where: buildApplicationWhere({}), select: { id: true, alternativesTo: true },
  }));
});
