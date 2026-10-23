import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ARTWORK_BACKGROUND_COLOUR,
  normalizeArtworkBackgroundColour,
  validateArtworkBackgroundColour,
} from '@/lib/artwork-background-colours';

describe('artwork background colours', () => {
  it('uses Soft ivory for missing legacy values', () => {
    expect(DEFAULT_ARTWORK_BACKGROUND_COLOUR).toBe('#F5F0E8');
    expect(normalizeArtworkBackgroundColour(null)).toBe('#F5F0E8');
  });

  it('normalizes and validates six-digit hex colours', () => {
    expect(validateArtworkBackgroundColour('#faf8f4')).toBe('#FAF8F4');
    expect(validateArtworkBackgroundColour('#123456')).toBe('#123456');
    expect(normalizeArtworkBackgroundColour('#abcdef')).toBe('#ABCDEF');
    expect(() => validateArtworkBackgroundColour('#12345')).toThrow(/six-digit hex colour/);
    expect(() => validateArtworkBackgroundColour('red')).toThrow(/six-digit hex colour/);
  });
});
