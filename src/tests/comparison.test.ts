import { expect, it } from 'vitest';
import { comparisonSlugs, architectureValue, maintenanceValue } from '@/lib/comparison';
import { groupAlternatives } from '@/lib/alternatives';
import { resolveVerificationStatus } from '@/lib/verification';
import type { AppWithRepo } from '@/lib/types';

it('accepts at most three distinct valid slugs without conflating missing and false data', () => {
  expect(comparisonSlugs({ app: ['one', 'one', '', '../../admin', 'two', 'three', 'four'] })).toEqual(['one', 'two', 'three']);
  expect(comparisonSlugs({ app: 'single' })).toEqual(['single']);
  expect(comparisonSlugs({})).toEqual([]);
  expect(architectureValue(null)).toBe('Unknown');
  expect(architectureValue(false)).toBe('Reported unsupported');
  expect(maintenanceValue({ repository: { archived: true, pushedAt: new Date() } } as AppWithRepo)).toBe('Archived upstream');
});

it('groups product spelling variants, counts apps once, and disambiguates URL collisions', () => {
  const groups = groupAlternatives([
    { id: '1', alternativesTo: ['Google Photos', ' GOOGLE   photos ', 'a+b'] },
    { id: '2', alternativesTo: ['google photos', 'a-b'] },
  ]);
  const photos = groups.find((group) => group.slug === 'google-photos')!;
  expect(photos.count).toBe(2);
  expect(photos.names).toHaveLength(3);
  expect(new Set(groups.map((group) => group.slug)).size).toBe(3);
});

it('never auto-verifies a classification requiring review', () => {
  expect(resolveVerificationStatus({ currentStatus: 'AUTO_VERIFIED', classificationConfidence: 1,
    reviewReasons: ['Category ambiguous'], category: 'Gaming', license: 'MIT', dockerSupported: true,
    composeSupported: true, hasReadme: true, pushedAt: new Date() })).toBe('UNVERIFIED');
});
