export const ARTWORK_BACKGROUND_COLOUR_OPTIONS = [
  { value: '#FFFFFF', label: 'Pure white' },
  { value: '#FAF8F4', label: 'Warm white · my pick' },
  { value: '#F5F0E8', label: 'Soft ivory' },
] as const;

export type ArtworkBackgroundColour = `#${string}`;

export const DEFAULT_ARTWORK_BACKGROUND_COLOUR: ArtworkBackgroundColour = '#F5F0E8';

export function isArtworkBackgroundColour(value: unknown): value is ArtworkBackgroundColour {
  return typeof value === 'string' && /^#[0-9A-F]{6}$/i.test(value.trim());
}

export function normalizeArtworkBackgroundColour(value: unknown): ArtworkBackgroundColour {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return isArtworkBackgroundColour(normalized)
    ? normalized
    : DEFAULT_ARTWORK_BACKGROUND_COLOUR;
}

export function validateArtworkBackgroundColour(value: unknown): ArtworkBackgroundColour {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!isArtworkBackgroundColour(normalized)) {
    throw new Error('Enter the Background Colour as a six-digit hex colour, for example #F5F0E8.');
  }
  return normalized;
}
