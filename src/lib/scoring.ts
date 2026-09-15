// Composite health score. Weights match the spec:
//   Recent activity 25%, Recent releases 20%, Docker install 15%, Documentation 15%,
//   Community 10%, License 5%, NAS compatibility 10%
// Every sub-score is 0..1 before weighting, 0..100 after.
//
// The community component DOES incorporate stars and forks — the comment that used to
// say "popularity isn't part of the weighted health score at all" was misleading: it
// only meant raw stars aren't the only signal, not that popularity is excluded. Stars
// and forks contribute to the health composite through the community sub-score, while
// popularityScore and growthScore are tracked as separate axes (used for the "popular"
// and "trending" sorts, not the default one).

// Bumping this version invalidates old breakdowns: the UI shows "breakdown not yet
// available" until the next snapshot run re-computes. Kept in lockstep with the migration
// that adds the breakdown column.
export const SCORING_ALGORITHM_VERSION = 'health-v1';

export interface ScoringInput {
  pushedAt: Date;
  latestReleaseAt: Date | null;
  dockerfilePresent: boolean;
  composePresent: boolean;
  readmeLength: number;
  hasDocumentationUrl: boolean;
  hasScreenshots: boolean;
  stars: number;
  forks: number;
  license: string | null;
  nasFriendly: boolean;
  arm64Supported: boolean | null;
  databases: string[]; // fewer/lighter deps (e.g. only SQLite) = easier NAS install
  starsGained30d: number | null; // from MetricSnapshot deltas, null if not enough history yet
}

export interface ScoringOutput {
  healthScore: number;
  activityScore: number;
  documentationScore: number;
  installEaseScore: number;
  nasCompatibilityScore: number;
  dockerScore: number;
  popularityScore: number;
  growthScore: number;
  breakdown: ScoreBreakdown;
  algorithmVersion: string;
}

// Persisted alongside the composite score. The UI uses it to explain how the total was
// reached without re-deriving the calculation from raw inputs (which would drift as the
// algorithm evolves).
export interface ScoreBreakdown {
  components: Array<{
    name: ScoreComponent;
    weight: number;       // 0..1
    raw: number;          // sub-score 0..1 before weighting
    weighted: number;     // raw * weight * 100, contribution to healthScore
  }>;
}

export type ScoreComponent =
  | 'activity' | 'releases' | 'docker' | 'documentation'
  | 'community' | 'license' | 'nas';

const WEIGHTS: Record<ScoreComponent, number> = {
  activity: 0.25,
  releases: 0.2,
  docker: 0.15,
  documentation: 0.15,
  community: 0.1,
  license: 0.05,
  nas: 0.1,
};

const PERMISSIVE_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'MPL-2.0']);
const COPYLEFT_LICENSES = new Set(['GPL-3.0', 'GPL-2.0', 'AGPL-3.0', 'LGPL-3.0', 'LGPL-2.1']);

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function scoreFromRecency(days: number, fullScoreWithin: number, zeroAfter: number): number {
  if (days <= fullScoreWithin) return 1;
  if (days >= zeroAfter) return 0;
  return 1 - (days - fullScoreWithin) / (zeroAfter - fullScoreWithin);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeScores(input: ScoringInput): ScoringOutput {
  // Activity: pushes within last 30 days = full score, decays to 0 by 12 months.
  const activityRaw = scoreFromRecency(daysSince(input.pushedAt), 30, 365);

  // Releases: a release in the last 90 days = full score, decays to 0 by 18 months.
  // No releases at all (rolling-release projects) gets a neutral 0.5 rather than 0.
  const releasesRaw = input.latestReleaseAt
    ? scoreFromRecency(daysSince(input.latestReleaseAt), 90, 540)
    : 0.5;

  // Docker: Compose is the gold standard for one-command NAS install; bare Dockerfile
  // still counts for something; neither means manual/source install only.
  const dockerRaw = input.composePresent ? 1 : input.dockerfilePresent ? 0.6 : 0;

  // Documentation: README length + presence of a dedicated docs site + screenshots.
  let docRaw = 0;
  if (input.readmeLength > 200) docRaw += 0.4;
  if (input.readmeLength > 1500) docRaw += 0.2;
  if (input.hasDocumentationUrl) docRaw += 0.25;
  if (input.hasScreenshots) docRaw += 0.15;
  docRaw = clamp01(docRaw);

  // Community: log-scaled stars+forks so a 50k-star project doesn't dominate a 500-star one
  // by orders of magnitude in a linear scale.
  const communityRaw = clamp01(Math.log10(input.stars + input.forks * 2 + 1) / 4.5);

  // License: permissive > copyleft > present-but-unrecognized > none.
  let licenseRaw = 0.3;
  if (input.license && PERMISSIVE_LICENSES.has(input.license)) licenseRaw = 1;
  else if (input.license && COPYLEFT_LICENSES.has(input.license)) licenseRaw = 0.8;
  else if (input.license) licenseRaw = 0.5;

  // NAS compatibility: Compose install, explicit ARM64 support, and lightweight
  // DB signal (SQLite-only; an empty list means unknown) all make self-hosting on a NAS easier.
  let nasRaw = 0;
  if (input.composePresent) nasRaw += 0.4;
  if (input.arm64Supported === true) nasRaw += 0.3;
  else if (input.arm64Supported === null) nasRaw += 0.1; // unknown, not penalized as hard as "no"
  if (input.databases.length === 1 && input.databases[0] === 'SQLite') {
    nasRaw += 0.2;
  }
  if (input.nasFriendly) nasRaw += 0.1;
  nasRaw = clamp01(nasRaw);

  const healthScore =
    100 *
    (activityRaw * WEIGHTS.activity +
      releasesRaw * WEIGHTS.releases +
      dockerRaw * WEIGHTS.docker +
      docRaw * WEIGHTS.documentation +
      communityRaw * WEIGHTS.community +
      licenseRaw * WEIGHTS.license +
      nasRaw * WEIGHTS.nas);

  // Popularity: raw log-scaled stars, shown separately, not part of healthScore weighting.
  const popularityScore = clamp01(Math.log10(input.stars + 1) / 5) * 100;

  // Growth: percentage of current stars gained in the last 30 days, capped and scaled.
  // Null when there's not enough snapshot history yet — UI must distinguish this from
  // an actual 0% growth so it doesn't promote the app in a "trending" sort.
  const growthScore =
    input.starsGained30d != null && input.stars > 0
      ? clamp01((input.starsGained30d / Math.max(input.stars, 1)) * 5) * 100
      : 0;

  const raw: Record<ScoreComponent, number> = {
    activity: activityRaw, releases: releasesRaw, docker: dockerRaw,
    documentation: docRaw, community: communityRaw, license: licenseRaw, nas: nasRaw,
  };

  // Build the breakdown: per-component weight, raw sub-score, and weighted contribution
  // to the composite (in points, not percent). The UI renders these as a table; it does
  // not recompute them, so changing the algorithm requires a SCORING_ALGORITHM_VERSION
  // bump to surface stale rows.
  const components = (Object.keys(WEIGHTS) as ScoreComponent[]).map((name) => ({
    name,
    weight: WEIGHTS[name],
    raw: raw[name],
    weighted: Number((raw[name] * WEIGHTS[name] * 100).toFixed(2)),
  }));

  return {
    healthScore: Number(healthScore.toFixed(1)),
    activityScore: Number((activityRaw * 100).toFixed(1)),
    documentationScore: Number((docRaw * 100).toFixed(1)),
    installEaseScore: Number((dockerRaw * 100).toFixed(1)),
    nasCompatibilityScore: Number((nasRaw * 100).toFixed(1)),
    dockerScore: Number((dockerRaw * 100).toFixed(1)),
    popularityScore: Number(popularityScore.toFixed(1)),
    growthScore: Number(growthScore.toFixed(1)),
    breakdown: { components },
    algorithmVersion: SCORING_ALGORITHM_VERSION,
  };
}
