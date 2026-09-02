// "AUTO_VERIFIED" is a promise that the system found *sufficient concrete evidence*, not
// just a decent classifier confidence score. Confidence alone is a guess about intent
// ("is this even a self-hosted app"); the checks below are all things we can point to
// directly (a real license string, a detected Dockerfile/Compose file, a non-empty README,
// a resolved category, a repo that isn't stale) so an unattended catalog can show a
// meaningfully different trust signal without a human ever clicking "approve".
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

function confidenceThreshold(): number {
  const raw = Number(process.env.AUTO_VERIFY_CONFIDENCE_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_CONFIDENCE_THRESHOLD;
}

const ABANDONED_CUTOFF_MONTHS = 12;

function isRecentlyActive(pushedAt: Date): boolean {
  const monthsAgo = (Date.now() - pushedAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
  return monthsAgo <= ABANDONED_CUTOFF_MONTHS;
}

export type VerificationStatusValue = 'UNVERIFIED' | 'AUTO_VERIFIED' | 'MANUALLY_VERIFIED';

export interface VerificationEvidence {
  currentStatus: VerificationStatusValue;
  classificationConfidence: number;
  category: string | null;
  license: string | null;
  dockerSupported: boolean;
  composeSupported: boolean;
  hasReadme: boolean;
  pushedAt: Date;
  archived?: boolean; // defaults to false for call sites that don't track it (yet)
  unreachable?: boolean; // repo deleted/inaccessible per the `reconcile` job
}

// A human's decision is final: the pipeline never promotes or demotes a manually-verified
// (or, implicitly, manually-corrected-to-unverified) application. Everything else is
// re-evaluated on every run, in both directions — a project that later goes stale or loses
// its Docker support should lose its auto-verified badge without anyone having to notice.
export function resolveVerificationStatus(evidence: VerificationEvidence): VerificationStatusValue {
  if (evidence.currentStatus === 'MANUALLY_VERIFIED') return 'MANUALLY_VERIFIED';

  const sufficientEvidence =
    !evidence.archived &&
    !evidence.unreachable &&
    evidence.classificationConfidence >= confidenceThreshold() &&
    evidence.category !== null &&
    evidence.license !== null &&
    (evidence.dockerSupported || evidence.composeSupported) &&
    evidence.hasReadme &&
    isRecentlyActive(evidence.pushedAt);

  return sufficientEvidence ? 'AUTO_VERIFIED' : 'UNVERIFIED';
}
