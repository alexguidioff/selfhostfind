import { describe, it, expect } from 'vitest';
import { classify } from '@/lib/classification';

describe('classify', () => {
  it('identifies a self-hosted finance app and its alternative-to targets', () => {
    const result = classify({
      name: 'balancia',
      description:
        'Self-hosted, open-source expense splitting app. An alternative to Splitwise and Tricount that you run on your own server with Docker Compose.',
      readme: 'Run with docker-compose up. Requires PostgreSQL.',
      topics: ['self-hosted', 'expense-sharing', 'finance'],
    });

    expect(result.isSelfHostedApp).toBe(true);
    expect(result.category).toBe('Finance');
    expect(result.alternativesTo).toEqual(expect.arrayContaining(['Splitwise', 'Tricount']));
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('rejects an SDK/client-library repo even if it mentions self-hosted infra', () => {
    const result = classify({
      name: 'acme-sdk',
      description: 'A TypeScript SDK / client library for talking to your self-hosted Acme server.',
      readme: 'npm install acme-sdk',
      topics: ['sdk', 'typescript'],
    });

    expect(result.isSelfHostedApp).toBe(false);
  });

  it('flags NAS-friendly signals independently of category', () => {
    const result = classify({
      name: 'homeboard',
      description: 'A self-hosted dashboard for your homelab, runs great on Synology NAS and Raspberry Pi.',
      readme: 'docker-compose up -d',
      topics: ['self-hosted', 'dashboard', 'nas'],
    });

    expect(result.nasFriendly).toBe(true);
  });

  it('detects known commercial products via "alternative to" phrasing without an explicit list', () => {
    const result = classify({
      name: 'photonest',
      description: 'Self-hosted photo management, an alternative to Google Photos.',
      readme: '',
      topics: ['self-hosted', 'photos'],
    });

    expect(result.alternativesTo).toContain('Google Photos');
  });
});

import { classificationCorpus } from './classification-corpus';
import { CATEGORIES } from '@/lib/constants';
import { slugify } from '@/lib/slug';

it.each(classificationCorpus)('classifies the upstream summary for $name', ({ name, description, readme, category, subcategory }) => {
  const result = classify({ name, description, readme, topics: [] });
  expect(result.isSelfHostedApp).toBe(true);
  expect(result.category).toBe(category);
  expect(result.subcategory).toBe(subcategory);
});

it('keeps strong identity ahead of incidental README features', () => {
  const result = classify({ name: 'bookmark-hub', description: 'Self-hosted bookmark manager with an SDK.',
    topics: ['bookmark-manager', 'self-hosted'],
    readme: 'RSS feed reader, local AI, analytics, SSO, backup, dashboard and SDK integrations.' });
  expect(result.isSelfHostedApp).toBe(true);
  expect(result.category).toBe('Bookmarks');
});

it('separates home automation from service workflows and flags tied categories', () => {
  expect(classify({ name: 'home', description: 'Self-hosted home automation for a smart home.', topics: [], readme: 'Workflow automation integrations.' }).category).toBe('Home Automation');
  const ambiguous = classify({ name: 'hub', description: 'Self-hosted bookmarks and RSS.', topics: [], readme: '' });
  expect(ambiguous.category).toBeNull();
  expect(ambiguous.reviewReasons.join(' ')).toContain('ambiguous');
  expect(ambiguous.confidence).toBeLessThanOrEqual(0.6);
});

it('does not invent an alternative from an unrelated README sentence', () => {
  const result = classify({ name: 'app', description: 'Self-hosted dashboard.', topics: [], readme: 'An alternative dashboard. Join us on Discord.' });
  expect(result.alternativesTo).not.toContain('Discord');
});

it('has 22 distinct categories and URL slugs', () => {
  expect(CATEGORIES).toHaveLength(22);
  expect(new Set(CATEGORIES.map(slugify)).size).toBe(22);
  expect(slugify('AI & LLM')).toBe('ai-llm');
  expect(slugify('RSS & News')).toBe('rss-news');
});
