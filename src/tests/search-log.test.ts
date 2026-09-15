import { describe, it, expect } from 'vitest';
import {
  looksSensitive, validateFilterValue, filterSignature, isEnabled,
} from '@/lib/search-log';

describe('looksSensitive', () => {
  it('rejects empty strings', () => {
    expect(looksSensitive('')).toBe(true);
    expect(looksSensitive('   ')).toBe(true);
  });

  it('rejects strings longer than 100 chars', () => {
    expect(looksSensitive('a'.repeat(101))).toBe(true);
  });

  it('accepts ordinary short queries', () => {
    expect(looksSensitive('alarms')).toBe(false);
    expect(looksSensitive('self hosted notes')).toBe(false);
  });

  it('rejects emails anywhere in the text, not only at the start', () => {
    expect(looksSensitive('foo@example.com')).toBe(true);
    expect(looksSensitive('a.b+tag@sub.example.org')).toBe(true);
    expect(looksSensitive('contact me at foo@bar.com please')).toBe(true);
  });

  it('rejects URLs anywhere in the text, not only at the start', () => {
    expect(looksSensitive('https://example.com/foo')).toBe(true);
    expect(looksSensitive('http://localhost')).toBe(true);
    expect(looksSensitive('see https://docs.example.com/api for details')).toBe(true);
  });

  it('rejects deep paths anywhere in the text', () => {
    expect(looksSensitive('/var/log/app/foo/bar')).toBe(true);
    expect(looksSensitive('my config is at /etc/myapp/config.json')).toBe(true);
  });

  it('rejects secret-looking tokens even with a leading word', () => {
    expect(looksSensitive('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
    expect(looksSensitive('sk-1234567890abcdefghij')).toBe(true);
    expect(looksSensitive('xoxb-1234567890-12345')).toBe(true);
    // The "here is my token ghp_..." shape used to slip past the anchored regex.
    expect(looksSensitive('here is my token ghp_abcdefghijklmnopqrstuvwxyz0123456789 for safekeeping')).toBe(true);
  });
});

describe('validateFilterValue', () => {
  it('accepts documented categories', () => {
    expect(validateFilterValue('category', 'Media')).toBe(true);
    expect(validateFilterValue('category', 'AI & LLM')).toBe(true);
  });

  it('rejects unknown categories', () => {
    expect(validateFilterValue('category', 'Hacking')).toBe(false);
    expect(validateFilterValue('category', 'all')).toBe(false);
  });

  it('accepts only "1" for boolean-ish flags', () => {
    expect(validateFilterValue('docker', '1')).toBe(true);
    expect(validateFilterValue('docker', '0')).toBe(false);
    expect(validateFilterValue('docker', 'true')).toBe(false);
  });

  it('rejects unknown filter keys', () => {
    expect(validateFilterValue('sort', 'trending')).toBe(true);
    expect(validateFilterValue('q', 'self hosted')).toBe(false);
  });

  it('accepts numeric ranges only as bounded integers', () => {
    expect(validateFilterValue('minStars', '0')).toBe(true);
    expect(validateFilterValue('minStars', '999999999')).toBe(true);
    expect(validateFilterValue('minStars', '10000000000')).toBe(false);
    expect(validateFilterValue('updated', '30')).toBe(true);
    expect(validateFilterValue('updated', '100000')).toBe(false);
  });
});

describe('filterSignature', () => {
  it('returns an empty string when no filters are present', () => {
    expect(filterSignature({})).toBe('');
  });

  it('produces a stable signature regardless of param order', () => {
    const a = filterSignature({ category: 'Media', docker: '1' });
    const b = filterSignature({ docker: '1', category: 'Media' });
    expect(a).toBe(b);
    expect(a).toContain('category=Media');
    expect(a).toContain('docker=1');
  });

  it('drops invalid filter values silently', () => {
    const signature = filterSignature({ category: 'NotARealCategory', docker: '1' });
    expect(signature).toBe('docker=1');
  });

  it('ignores non-allowlisted keys', () => {
    const signature = filterSignature({ sort: 'health', q: 'foo', category: 'Media' });
    expect(signature).toBe('category=Media');
  });
});

describe('isEnabled', () => {
  it('defaults to disabled when SEARCH_LOG_ENABLED is not set', () => {
    const prev = process.env.SEARCH_LOG_ENABLED;
    delete process.env.SEARCH_LOG_ENABLED;
    expect(isEnabled()).toBe(false);
    if (prev !== undefined) process.env.SEARCH_LOG_ENABLED = prev;
  });

  it('turns on only with the exact value "true"', () => {
    const prev = process.env.SEARCH_LOG_ENABLED;
    process.env.SEARCH_LOG_ENABLED = '1';
    expect(isEnabled()).toBe(false);
    process.env.SEARCH_LOG_ENABLED = 'yes';
    expect(isEnabled()).toBe(false);
    process.env.SEARCH_LOG_ENABLED = 'true';
    expect(isEnabled()).toBe(true);
    if (prev !== undefined) process.env.SEARCH_LOG_ENABLED = prev;
    else delete process.env.SEARCH_LOG_ENABLED;
  });
});
