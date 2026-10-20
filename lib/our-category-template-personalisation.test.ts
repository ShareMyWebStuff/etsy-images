import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  prepareOurCategoryTemplateArtwork,
  validateOurCategoryTemplatePersonalisation,
} from '@/lib/our-category-template-personalisation';

describe('Our Category template personalisation', () => {
  it('keeps the uploaded artwork unchanged when both text fields are empty', async () => {
    const source = await sharp({
      create: { width: 300, height: 400, channels: 4, background: '#dcebd8' },
    }).png().toBuffer();
    const personalisation = validateOurCategoryTemplatePersonalisation('', '', 'nunito-semibold');

    const result = await prepareOurCategoryTemplateArtwork(source, personalisation);

    expect(result).toBe(source);
  });

  it('renders saved text onto the complete artwork using the selected PrintShrimp font', async () => {
    const source = await sharp({
      create: { width: 300, height: 400, channels: 4, background: '#dcebd8' },
    }).png().toBuffer();
    const personalisation = validateOurCategoryTemplatePersonalisation('Oliver', 'The Fox', 'fredoka-bold');

    const result = await prepareOurCategoryTemplateArtwork(source, personalisation);
    const [before, after] = await Promise.all([
      sharp(source).ensureAlpha().raw().toBuffer(),
      sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);

    expect(after.info).toMatchObject({ width: 300, height: 400 });
    expect(after.data.equals(before)).toBe(false);
  });

  it('enforces the 40-character limit', () => {
    expect(() => validateOurCategoryTemplatePersonalisation('x'.repeat(41), '', 'nunito-semibold'))
      .toThrow('Top Text must be 40 characters or fewer.');
  });

  it('honours listing visibility settings before rendering template text', async () => {
    const source = await sharp({
      create: { width: 300, height: 400, channels: 4, background: '#dcebd8' },
    }).png().toBuffer();
    const personalisation = validateOurCategoryTemplatePersonalisation('Hidden top text', '', 'nunito-semibold');

    const result = await prepareOurCategoryTemplateArtwork(source, personalisation, {
      showTop: false,
      showBottom: true,
    });

    expect(result).toBe(source);
  });
});
