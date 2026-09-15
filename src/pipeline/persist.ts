// Shared upsert logic used by both `discover` and `refresh`. Extracted so the override
// protection, field-source bookkeeping, and Application/Repository upsert stay in one
// place: when two pipelines can both write to the same row, the only way to keep them
// from diverging is to make them literally call the same function.
//
// Network calls stay in the caller; this module only builds Prisma payloads.

import { Prisma } from '@prisma/client';
import type { ClassificationOutput } from '@/lib/classification';
import { classificationFields } from '@/lib/classification';
import { computeScores } from '@/lib/scoring';
import { resolveVerificationStatus } from '@/lib/verification';
import { slugify } from '@/lib/slug';
import type { AnalysisOutcome } from './analyze';
import type { GhRepoSearchItem } from '@/lib/github';

export interface RepoItem {
  id: string;
  githubId: bigint;
  name: string;
  fullName: string;
  description: string | null;
  repositoryUrl: string;
  homepageUrl: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  license: string | null;
  primaryLanguage: string | null;
  topics: string[];
  createdAt: Date;
  pushedAt: Date;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
}

export function repoItemFromSearch(item: GhRepoSearchItem, id: string): RepoItem {
  return {
    id,
    githubId: BigInt(item.id),
    name: item.name,
    fullName: item.full_name,
    description: item.description,
    repositoryUrl: item.html_url,
    homepageUrl: item.homepage || null,
    stars: item.stargazers_count,
    forks: item.forks_count,
    watchers: item.watchers_count,
    openIssues: item.open_issues_count,
    license: item.license?.spdx_id ?? null,
    primaryLanguage: item.language,
    topics: item.topics,
    createdAt: new Date(item.created_at),
    pushedAt: new Date(item.pushed_at),
    archived: item.archived,
    fork: item.fork,
    defaultBranch: item.default_branch,
  };
}

// Maps a ScoringOutput (the in-memory shape returned by computeScores) onto the
// persisted Application column names. Centralised so discovery, refresh, and snapshot
// can't drift apart on what gets written where.
export const SCORE_FIELDS = [
  'healthScore', 'activityScore', 'documentationScore', 'installEaseScore',
  'nasCompatibilityScore', 'dockerScore', 'popularityScore', 'growthScore',
  'scoreBreakdown', 'scoreAlgorithmVersion', 'scoreComputedAt', 'growthScoreSource',
] as const;

export function scoreUpdate(scores: ReturnType<typeof computeScores>, starsGained: number | null, now = new Date()): Record<string, unknown> {
  const { breakdown, algorithmVersion, ...scalars } = scores;
  // Renames: ScoringOutput's `breakdown`/`algorithmVersion` map to the DB columns
  // `scoreBreakdown`/`scoreAlgorithmVersion`. Done here so callers don't sprinkle the
  // mapping in three pipelines.
  return {
    ...scalars,
    scoreBreakdown: breakdown,
    scoreAlgorithmVersion: algorithmVersion,
    scoreComputedAt: now,
    growthScoreSource: starsGained === null ? 'insufficient-history' : 'computed',
  };
}

export function buildScores(args: {
  repo: RepoItem;
  analysis: AnalysisOutcome;
  classification: ClassificationOutput;
  starsGained30d: number | null;
}) {
  return computeScores({
    pushedAt: args.repo.pushedAt,
    latestReleaseAt: args.analysis.result.latestReleaseAt,
    dockerfilePresent: args.analysis.result.dockerfilePresent,
    composePresent: args.analysis.result.composePresent,
    readmeLength: args.analysis.result.readmeFull?.length ?? 0,
    hasDocumentationUrl: Boolean(args.analysis.result.documentationUrl),
    hasScreenshots: args.analysis.result.screenshotUrls.length > 0,
    stars: args.repo.stars,
    forks: args.repo.forks,
    license: args.repo.license,
    nasFriendly: args.classification.nasFriendly,
    arm64Supported: args.analysis.result.arm64Supported,
    databases: args.analysis.result.databases,
    starsGained30d: args.starsGained30d,
  });
}

export function buildFieldSources(existing: Record<string, string> | null | undefined): Record<string, string> {
  return {
    ...(existing ?? {}),
    category: 'keyword-rules', subcategory: 'keyword-rules', alternativesTo: 'keyword-rules',
    dockerSupported: 'repository-files', composeSupported: 'repository-files',
    arm64Supported: 'readme-mention', amd64Supported: 'readme-mention',
    databases: 'readme-mention', ports: 'readme-scan', isNasFriendly: 'keyword-rules',
  };
}

export function applyManualOverrides(
  proposed: Record<string, unknown>,
  existingApp: { manualOverrides: unknown } | null
): Record<string, unknown> {
  const overrides = (existingApp?.manualOverrides as Record<string, boolean> | null) ?? {};
  const protectedKeys = Object.keys(overrides).filter((k) => overrides[k]);
  const fieldSources = proposed.fieldSources as Record<string, string> | undefined;
  for (const key of protectedKeys) {
    delete proposed[key];
    if (fieldSources) fieldSources[key] = 'manual';
  }
  return proposed;
}

export function buildApplicationUpdate(args: {
  repo: RepoItem;
  analysis: AnalysisOutcome;
  classification: ClassificationOutput;
  existingApplication: {
    manualOverrides: unknown; fieldSources: unknown;
    verificationStatus: string;
  } | null;
}): Record<string, unknown> {
  const { repo, analysis, classification, existingApplication } = args;
  const dockerSupported = analysis.result.dockerfilePresent || analysis.result.composePresent;
  const proposed: Record<string, unknown> = {
    ...classificationFields(classification),
    name: repo.name,
    shortDescription: repo.description,
    isSelfHosted: classification.isSelfHostedApp,
    dockerSupported,
    composeSupported: analysis.result.composePresent,
    composePath: analysis.result.composePath,
    fieldSources: buildFieldSources(existingApplication?.fieldSources as Record<string, string> | null),
    arm64Supported: analysis.result.arm64Supported,
    amd64Supported: analysis.result.amd64Supported,
    databases: analysis.result.databases,
    installMethods: analysis.result.installMethods,
    envVars: analysis.result.envVars,
    ports: analysis.result.ports,
    containerImage: analysis.result.containerImage,
    documentationUrl: analysis.result.documentationUrl,
    demoUrl: analysis.result.demoUrl,
    screenshotUrls: analysis.result.screenshotUrls,
    verificationStatus: resolveVerificationStatus({
      currentStatus: (existingApplication?.verificationStatus as 'UNVERIFIED' | 'AUTO_VERIFIED' | 'MANUALLY_VERIFIED' | undefined) ?? 'UNVERIFIED',
      classificationConfidence: classification.confidence,
      reviewReasons: classification.reviewReasons,
      category: classification.category,
      license: repo.license,
      dockerSupported,
      composeSupported: analysis.result.composePresent,
      hasReadme: Boolean(analysis.result.readmeFull && analysis.result.readmeFull.length > 100),
      pushedAt: repo.pushedAt,
      archived: repo.archived,
      unreachable: false,
    }),
  };
  return applyManualOverrides(proposed, existingApplication);
}

export async function uniqueSlug(prisma: Prisma.TransactionClient, name: string): Promise<string> {
  const base = slugify(name) || 'app';
  let slug = base;
  let n = 1;
  while (await prisma.application.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

export function repositoryData(repo: RepoItem, analysis: AnalysisOutcome): Prisma.RepositoryUpdateManyMutationInput {
  return {
    owner: repo.fullName.split('/')[0], name: repo.name, fullName: repo.fullName,
    repositoryUrl: repo.repositoryUrl, description: repo.description, homepageUrl: repo.homepageUrl,
    stars: repo.stars, forks: repo.forks, watchers: repo.watchers, openIssues: repo.openIssues,
    license: repo.license, primaryLanguage: repo.primaryLanguage, topics: repo.topics,
    pushedAt: repo.pushedAt, archived: repo.archived, fork: repo.fork, defaultBranch: repo.defaultBranch,
    readmeExcerpt: analysis.result.readmeExcerpt, languages: analysis.result.languages ?? Prisma.DbNull,
    latestReleaseAt: analysis.result.latestReleaseAt, latestReleaseTag: analysis.result.latestReleaseTag,
    unreachable: false, lastVerifiedAt: new Date(), lastScannedAt: new Date(), lastScanAttemptAt: new Date(), lastScanError: null,
  };
}
