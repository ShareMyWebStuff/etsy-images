import { describe, expect, it } from 'vitest';

import {
  buildMultipleListingDetailsPrompt,
  parseGeneratedMultipleListingDetails,
  type MultipleListingDetailsPromptValues,
} from '@/lib/multiple-listing-details-prompt';

const values: MultipleListingDetailsPromptValues = {
  sectionName: 'Kids & Nursery Prints',
  listingName: 'Dinosaur set of 3',
  listingDescription: 'A coordinated group of friendly dinosaurs.',
  templateName: 'Dinosaurs Kids - Sets of 3',
  roomTheme: 'Dinosaur nursery',
  itemCount: 3,
  items: [
    {
      position: 1,
      listingName: 'Allosaurus',
      itemName: 'Allosaurus',
      description: 'Moss green with a brave expression.',
      roomTheme: 'Dinosaur nursery',
      orientation: 'portrait',
      primaryColour: 'green',
      secondaryColour: 'beige',
    },
    {
      position: 2,
      listingName: 'Eoraptor',
      itemName: 'Eoraptor',
      description: 'Golden orange with a curious pose.',
      roomTheme: 'Dinosaur nursery',
      orientation: 'portrait',
      primaryColour: 'orange',
      secondaryColour: 'green',
    },
    {
      position: 3,
      listingName: 'Gallimimus',
      itemName: 'Gallimimus',
      description: 'Pale tan with an energetic running pose.',
      roomTheme: 'Dinosaur nursery',
      orientation: 'portrait',
      primaryColour: 'beige',
      secondaryColour: 'green',
    },
  ],
  printSizes: 'A5 — 14.8 × 21 cm',
  frameColours: 'Black, White, Natural Oak',
  personalisationDetails: '',
  giftMessageEnabled: true,
  digitalDownloadEnabled: true,
  digitalFileGuides: 'PORTRAIT ARTWORK FILES\nA-SERIES FILE\nA5 — 14.8 × 21 cm',
  recommendedPaper: 'Good-quality matte photo or art paper around 200–250 gsm',
  licenceType: 'Personal use only.',
};

describe('multiple listing details prompt', () => {
  it('supplies every grouped artwork and asks for grouped descriptions, 13 tags and two Etsy colours', () => {
    const prompt = buildMultipleListingDetailsPrompt(values);

    expect(prompt).toContain('NUMBER_OF_ARTWORKS = 3');
    expect(prompt).toContain('Allosaurus');
    expect(prompt).toContain('Eoraptor');
    expect(prompt).toContain('Gallimimus');
    expect(prompt).toContain('one clearly labelled Dropbox download link for each of the 3 artworks');
    expect(prompt).toContain('Return exactly 13 distinct tags');
    expect(prompt).toContain('"primaryColour":"allowed value"');
    expect(prompt).toContain('"secondaryColour":"different allowed value"');
  });

  it('parses and validates all generated listing fields', () => {
    const tags = Array.from({ length: 13 }, (_, index) => `dinosaur tag ${index + 1}`);
    const result = parseGeneratedMultipleListingDetails(`<ETSY_MULTIPLE_LISTING_DATA>
${JSON.stringify({
  printTitle: 'Set of Three Dinosaur Nursery Prints',
  printDescription: 'Physical description',
  digitalTitle: 'Set of Three Dinosaur Digital Downloads',
  digitalDescription: 'Digital description',
  tags,
  primaryColour: 'Green',
  secondaryColour: 'Beige',
})}
</ETSY_MULTIPLE_LISTING_DATA>`);

    expect(result.tags).toHaveLength(13);
    expect(result.primaryColour).toBe('green');
    expect(result.secondaryColour).toBe('beige');
  });

  it('rejects an invalid colour or fewer than 13 distinct tags', () => {
    expect(() => parseGeneratedMultipleListingDetails(`<ETSY_MULTIPLE_LISTING_DATA>
${JSON.stringify({
  printTitle: 'Print title',
  printDescription: 'Print description',
  digitalTitle: 'Digital title',
  digitalDescription: 'Digital description',
  tags: ['dinosaur print'],
  primaryColour: 'chartreuse',
  secondaryColour: 'green',
})}
</ETSY_MULTIPLE_LISTING_DATA>`)).toThrow(/exactly 13 distinct Etsy tags/);
  });
});
