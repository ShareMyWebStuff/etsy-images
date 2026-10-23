import { describe, expect, it } from 'vitest';
import { buildDownloadDetailsPrompt, missingDownloadDetailsPromptFields } from '@/lib/download-details-prompt';
import { printableDownloadDescriptionGuide } from '@/lib/printable-download-specs';

const values = {
  animalName: ' Green Sea Turtle ',
  animalDescription: 'Green Sea Turtle – soft green tones, calm, and nature-inspired',
  roomTheme: 'Sea Creatures',
  frameColour: 'Natural Oak',
  orientation: 'portrait',
  fileType: 'jpeg',
  frameColours: 'Black, White, Natural Oak',
  filesIncluded: printableDownloadDescriptionGuide('portrait'),
  recommendedPaper: 'Good-quality matte photo or art paper around 200–250 gsm',
  licenceType: 'Personal use only',
};

describe('Download info prompt', () => {
  it('populates the attached prompt from listing and download values', () => {
    const prompt = buildDownloadDetailsPrompt(values);

    expect(prompt).toContain('ANIMAL: Green Sea Turtle – soft green tones, calm, and nature-inspired');
    expect(prompt).toContain('ROOM_THEME: Sea Creatures');
    expect(prompt).toContain('FRAME_COLOUR: Natural Oak');
    expect(prompt).toContain('ORIENTATION: portrait');
    expect(prompt).toContain('FILE_TYPE: jpeg');
    expect(prompt).toContain('FRAME_COLOURS: Black, White, Natural Oak');
    expect(prompt).toContain('A-SERIES FILE');
    expect(prompt).toContain('A5 — 14.8 × 21 cm');
    expect(prompt).toContain('2:3 RATIO FILE');
    expect(prompt).toContain('File dimensions: 7200 × 10800 px');
    expect(prompt).toContain('Maximum listed print size: 24 × 36 in');
    expect(prompt).toContain('RECOMMENDED_PAPER: Good-quality matte photo or art paper around 200–250 gsm');
    expect(prompt).toContain('LICENCE_TYPE: Personal use only');
    expect(prompt).toContain('DIGITAL DOWNLOAD ONLY — NO PHYSICAL ITEM WILL BE SENT');
    expect(prompt).toContain('A THOUGHTFUL GIFT TO PRINT AND FRAME');
    expect(prompt).toContain('HOW TO DOWNLOAD AND PRINT');
    expect(prompt).toContain('PERSONAL USE LICENCE');
    expect(prompt).toContain('an Etsy PDF containing a link to the JPEG files');
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('does not duplicate the animal name when the description already includes it', () => {
    expect(buildDownloadDetailsPrompt(values)).not.toContain('Green Sea Turtle – Green Sea Turtle');
  });

  it('reports listing fields needed before copying', () => {
    expect(missingDownloadDetailsPromptFields({
      ...values,
      animalDescription: '',
      filesIncluded: ' ',
    })).toEqual(['Listing description', 'Digital Downloads files']);
  });
});
