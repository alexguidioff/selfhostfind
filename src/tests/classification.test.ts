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
