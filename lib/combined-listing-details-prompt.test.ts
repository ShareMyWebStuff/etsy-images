import { describe, expect, it } from 'vitest';

import {
  buildCombinedListingDetailsPrompt,
  buildSetDetailsClipboardPrompt,
  parseGeneratedListingDetails,
  parseSetDetailsOutput,
  type CombinedListingDetailsPromptValues,
} from '@/lib/combined-listing-details-prompt';

const values: CombinedListingDetailsPromptValues = {
  sectionName: 'Sea Creatures Wall Art',
  listingName: 'Green Sea Turtle',
  animalName: 'Green Sea Turtle',
  animalDescription: 'Soft green tones, calm, and nature-inspired',
  roomTheme: 'Sea Creatures',
  digitalDownload: true,
  paperDetails: 'Heavyweight matte art paper, at least 200gsm',
  printSizes: 'A4, A3, A2, 5 × 7',
  frameColours: 'Black, White, Natural Oak',
  personalisationDetails: 'Optional top and bottom text personalisation is available.',
  giftMessageEnabled: false,
  digitalFilesIncluded: 'ISO A1, 2 x 3, 3 x 4, 4 x 5, 11 x 14, 5 x 7',
  orientation: 'portrait',
  fileType: 'jpeg',
  recommendedPaper: 'Heavyweight matte photo paper',
  licenceType: 'Personal use only',
};

describe('combined listing details prompt', () => {
  it('puts resolved listing variables first and contains both rule sets', () => {
    const prompt = buildCombinedListingDetailsPrompt(values);
    expect(prompt.indexOf('SECTION_NAME = "Sea Creatures Wall Art"')).toBeLessThan(prompt.indexOf('PHYSICAL PRINT RULES'));
    expect(prompt).toContain('PRINT_SIZES = "A4, A3, A2, 5 × 7"');
    expect(prompt).toContain('FRAME_COLOURS = "Black, White, Natural Oak"');
    expect(prompt).not.toContain('FRAME_COLOURS = "No Frame');
    expect(prompt).toContain('DIGITAL DOWNLOAD RULES');
    expect(prompt).toContain('<ETSY_LISTING_DATA>');
  });

  it('parses the structured response used by the automation', () => {
    const result = parseGeneratedListingDetails(`<ETSY_LISTING_DATA>
{"printTitle":"Turtle print","printDescription":"Print description","digitalTitle":"Turtle printable","digitalDescription":"Digital description","tags":["turtle nursery","sea creature art"]}
</ETSY_LISTING_DATA>`);
    expect(result.printTitle).toBe('Turtle print');
    expect(result.digitalDescription).toBe('Digital description');
    expect(result.tags).toEqual(['turtle nursery', 'sea creature art']);
  });

  it('builds the Start tab clipboard prompt from the current listing variables', () => {
    const prompt = buildSetDetailsClipboardPrompt(values);
    expect(prompt).toContain('SECTION_NAME = "Sea Creatures Wall Art"');
    expect(prompt).toContain('ANIMAL_NAME = "Green Sea Turtle"');
    expect(prompt).toContain('ANIMAL_DESCRIPTION = "Soft green tones, calm, and nature-inspired"');
    expect(prompt).toContain('PRINT_SIZES = "A4, A3, A2, 5 × 7"');
    expect(prompt).toContain('FRAME_COLOURS = "Black, White, Natural Oak"');
    expect(prompt).toContain('Print Title');
    expect(prompt).toContain('Digital Description');
    expect(prompt).toContain('six high-resolution JPEG artwork files');
    expect(prompt).toContain('How_To_Print_Guide.pdf');
    expect(prompt).toContain('Return exactly 13 distinct Etsy tags');
    expect(prompt).toContain('Do not describe it as seven JPEG files');
    expect(prompt).not.toContain('🎁 GIFT MESSAGES 🎁');
  });

  it('mentions every enabled Etsy Product size and does not invent a disabled size', () => {
    const enabledSizes = 'A5, A4, A3, A2, A1, 5 × 7, 6 × 8, 8 × 10, 11 × 14, 12 × 16, 12 × 18, 16 × 20, 16 × 24, 18 × 24, 20 × 28, 20 × 30, 24 × 36, 30 × 40 cm';
    const prompt = buildSetDetailsClipboardPrompt({ ...values, printSizes: enabledSizes });
    expect(prompt).toContain(`PRINT_SIZES = "${enabledSizes}"`);
    expect(prompt).toContain('Use PRINT_SIZES exactly for the physical listing. Do not add sizes that are not enabled.');
    expect(prompt).not.toContain('PRINT_SIZES = "50 × 70 cm"');
  });

  it('includes the exact physical gift-message copy only when it is enabled', () => {
    const prompt = buildSetDetailsClipboardPrompt({ ...values, giftMessageEnabled: true });
    expect(prompt).toContain('GIFT_MESSAGE_ENABLED = "Y"');
    expect(prompt).toContain('🎁 GIFT MESSAGES 🎁');
    expect(prompt).toContain('Please keep it within 500 characters, including spaces, punctuation and the sender’s name.');
    expect(prompt.indexOf('🎁 GIFT MESSAGES 🎁')).toBeLessThan(prompt.indexOf('DELIVERY AND ORDER HELP'));
  });

  it('parses the five titled sections from pasted Set Details output', () => {
    const result = parseSetDetailsOutput(`Print Title

Green Sea Turtle Nursery Wall Art

Print Description

First print paragraph.

Second print paragraph.

Digital Title

Green Sea Turtle Printable Wall Art

Digital Description

First digital paragraph.

Second digital paragraph.

Tags

green sea turtle, turtle nursery art, sea creature print`);

    expect(result).toEqual({
      printTitle: 'Green Sea Turtle Nursery Wall Art',
      printDescription: 'First print paragraph.\n\nSecond print paragraph.',
      digitalTitle: 'Green Sea Turtle Printable Wall Art',
      digitalDescription: 'First digital paragraph.\n\nSecond digital paragraph.',
      tags: ['green sea turtle', 'turtle nursery art', 'sea creature print'],
    });
  });

  it('rejects pasted output with a missing section', () => {
    expect(() => parseSetDetailsOutput(`Print Title

Print title

Print Description

Print description

Digital Title

Digital title

Tags

turtle art`)).toThrow('five sections');
  });
});
