import { describe, it, expect } from 'vitest';
import { computeScores } from '@/lib/scoring';

const baseInput = {
  pushedAt: new Date(),
  latestReleaseAt: new Date(),
  dockerfilePresent: true,
  composePresent: true,
  readmeLength: 3000,
  hasDocumentationUrl: true,
  hasScreenshots: true,
  stars: 500,
  forks: 40,
  license: 'MIT',
  nasFriendly: true,
  arm64Supported: true,
  databases: ['SQLite'],
  starsGained30d: 50,
};

describe('computeScores', () => {
  it('gives a small-but-fresh, Compose-ready project a high health score', () => {
    const scores = computeScores(baseInput);
    expect(scores.healthScore).toBeGreaterThan(80);
  });

  it('ranks a small, actively maintained project above a much more popular abandoned one', () => {
    const small = computeScores(baseInput);

    const abandoned = computeScores({
      ...baseInput,
      stars: 50000,
      forks: 3000,
      pushedAt: new Date(Date.now() - 900 * 24 * 60 * 60 * 1000), // ~2.5 years ago
      latestReleaseAt: null,
      dockerfilePresent: false,
      composePresent: false,
      hasDocumentationUrl: false,
      starsGained30d: 0,
    });

    expect(small.healthScore).toBeGreaterThan(abandoned.healthScore);
    // but the abandoned repo is still far more "popular" — that's a separate axis
    expect(abandoned.popularityScore).toBeGreaterThan(small.popularityScore);
  });

  it('penalizes repos with no Docker/Compose support on installEaseScore', () => {
    const noDocker = computeScores({ ...baseInput, dockerfilePresent: false, composePresent: false });
    expect(noDocker.installEaseScore).toBe(0);
  });

  it('does not let healthScore exceed 100 or drop below 0', () => {
    const maxed = computeScores({ ...baseInput, stars: 1_000_000, forks: 100_000 });
    expect(maxed.healthScore).toBeLessThanOrEqual(100);

    const minimal = computeScores({
      ...baseInput,
      pushedAt: new Date(Date.now() - 3000 * 24 * 60 * 60 * 1000),
      latestReleaseAt: null,
      dockerfilePresent: false,
      composePresent: false,
      readmeLength: 0,
      hasDocumentationUrl: false,
      hasScreenshots: false,
      stars: 0,
      forks: 0,
      license: null,
      nasFriendly: false,
      arm64Supported: false,
      databases: ['PostgreSQL', 'Redis'],
      starsGained30d: null,
    });
    expect(minimal.healthScore).toBeGreaterThanOrEqual(0);
  });
});
