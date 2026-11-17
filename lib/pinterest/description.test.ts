import { describe, expect, it } from 'vitest';
import { PINTEREST_DESCRIPTION_MAX_LENGTH, pinDescriptionLength, validatePinDescription } from './description';

describe('shared Pinterest description validation', () => {
  it('counts Unicode code points including supplementary-plane characters', () => {
    expect(PINTEREST_DESCRIPTION_MAX_LENGTH).toBe(500);
    expect(pinDescriptionLength('Fox 🦊 & leaves 🍃')).toBe(16);
    expect(pinDescriptionLength('🦊'.repeat(500))).toBe(500);
    expect(pinDescriptionLength('e\u0301')).toBe(2);
  });

  it('returns trimmed text without shortening or rewriting it', () => {
    expect(validatePinDescription('  A cosy woodland room.\n')).toBe('A cosy woodland room.');
    const full = '🦊'.repeat(500);
    expect(validatePinDescription(full)).toBe(full);
  });

  it.each(['', '   ', '\n\t'])('rejects empty or whitespace-only text %j', (value) => {
    expect(() => validatePinDescription(value)).toThrow('Enter a Pinterest description.');
  });

  it.each([null, undefined, 123, {}, ['description']])('rejects a non-string description %j', (value) => {
    expect(() => validatePinDescription(value)).toThrow('as text');
  });

  it.each(['a'.repeat(501), '🦊'.repeat(501), ` ${'a'.repeat(500)}`])('rejects oversized submitted text without truncation', (value) => {
    expect(() => validatePinDescription(value)).toThrow('500 characters or fewer');
  });
});
