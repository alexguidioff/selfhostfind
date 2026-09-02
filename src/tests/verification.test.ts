import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveVerificationStatus, type VerificationEvidence } from '@/lib/verification';

const goodEvidence: VerificationEvidence = {
  currentStatus: 'UNVERIFIED',
  classificationConfidence: 0.9,
  category: 'Finance',
  license: 'AGPL-3.0',
  dockerSupported: true,
  composeSupported: true,
  hasReadme: true,
  pushedAt: new Date(),
};

describe('resolveVerificationStatus', () => {
  afterEach(() => {
    delete process.env.AUTO_VERIFY_CONFIDENCE_THRESHOLD;
  });

  it('promotes an unverified app with strong, concrete evidence to auto-verified', () => {
    expect(resolveVerificationStatus(goodEvidence)).toBe('AUTO_VERIFIED');
  });

  it('never touches a manually-verified app, even with weak evidence', () => {
    const result = resolveVerificationStatus({
      ...goodEvidence,
      currentStatus: 'MANUALLY_VERIFIED',
      classificationConfidence: 0.1,
      license: null,
      dockerSupported: false,
      composeSupported: false,
    });
    expect(result).toBe('MANUALLY_VERIFIED');
  });

  it('does not promote on confidence alone, without a license', () => {
    expect(resolveVerificationStatus({ ...goodEvidence, license: null })).toBe('UNVERIFIED');
  });

  it('does not promote without Docker or Compose evidence', () => {
    const result = resolveVerificationStatus({
      ...goodEvidence,
      dockerSupported: false,
      composeSupported: false,
    });
    expect(result).toBe('UNVERIFIED');
  });

  it('does not promote without a resolved category', () => {
    expect(resolveVerificationStatus({ ...goodEvidence, category: null })).toBe('UNVERIFIED');
  });

  it('does not promote a stale/abandoned project even with a high confidence score', () => {
    const stale = new Date();
    stale.setFullYear(stale.getFullYear() - 2);
    expect(resolveVerificationStatus({ ...goodEvidence, pushedAt: stale })).toBe('UNVERIFIED');
  });

  it('does not promote below the confidence threshold', () => {
    expect(resolveVerificationStatus({ ...goodEvidence, classificationConfidence: 0.5 })).toBe('UNVERIFIED');
  });

  it('demotes a previously auto-verified app that has since gone stale', () => {
    const stale = new Date();
    stale.setFullYear(stale.getFullYear() - 2);
    const result = resolveVerificationStatus({
      ...goodEvidence,
      currentStatus: 'AUTO_VERIFIED',
      pushedAt: stale,
    });
    expect(result).toBe('UNVERIFIED');
  });

  it('respects a custom AUTO_VERIFY_CONFIDENCE_THRESHOLD', () => {
    process.env.AUTO_VERIFY_CONFIDENCE_THRESHOLD = '0.95';
    expect(resolveVerificationStatus({ ...goodEvidence, classificationConfidence: 0.9 })).toBe('UNVERIFIED');
  });

  it('does not promote an archived repository even with otherwise-perfect evidence', () => {
    expect(resolveVerificationStatus({ ...goodEvidence, archived: true })).toBe('UNVERIFIED');
  });

  it('demotes a previously auto-verified app whose repository becomes archived upstream', () => {
    const result = resolveVerificationStatus({ ...goodEvidence, currentStatus: 'AUTO_VERIFIED', archived: true });
    expect(result).toBe('UNVERIFIED');
  });

  it('does not promote an unreachable (deleted/transferred) repository', () => {
    expect(resolveVerificationStatus({ ...goodEvidence, unreachable: true })).toBe('UNVERIFIED');
  });
});
