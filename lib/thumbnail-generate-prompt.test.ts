import { describe, expect, it } from 'vitest';
import {
  animalTypeForThumbnailPrompt,
  buildThumbnailGeneratePrompt,
  buildThumbnailIllustrationPrompt,
  buildThumbnailPrintMasterPrompt,
  missingThumbnailGeneratePromptFields,
  missingThumbnailIllustrationPromptFields,
  thumbnailIllustrationPromptValues,
} from '@/lib/thumbnail-generate-prompt';

const ant = {
  numberOfAnimals: 1,
  animals: 'Ant — tiny, hardworking, clever, and adventurous',
  collectionTheme: 'Bugs',
  sectionName: 'Bugs Wall Art',
};

describe('Thumbnail / Generate image prompt', () => {
  it('fills the Ant listing fields and keeps the delivery requirements', () => {
    const prompt = buildThumbnailGeneratePrompt(ant);
    expect(prompt).toContain('NO_OF_ANIMALS: 1');
    expect(prompt).toContain(`ANIMALS:\n${ant.animals}`);
    expect(prompt).toContain('COLLECTION_THEME: soft bugs-inspired nursery wall art');
    expect(prompt).toContain('ANIMAL_TYPE: insect');
    expect(prompt).toContain('FINAL_WIDTH_PX: 7016');
    expect(prompt).toContain('FINAL_HEIGHT_PX: 9933');
    expect(prompt).toContain('BACKGROUND: TRANSPARENT');
    expect(prompt).toContain('MANDATORY MINIMUM BORDERS:');
    expect(prompt).toContain('351 fully transparent columns on the left.');
    expect(prompt).toContain('1490 fully transparent rows at the bottom.');
    expect(prompt).toContain('left_margin_px = ceil(0.05 × FINAL_WIDTH_PX)');
    expect(prompt).toContain('Every pixel in the mandatory border strips has alpha = 0.');
    expect(prompt).toContain('Opposite margins are balanced to within one pixel.');
    expect(prompt).toContain('Deliver only the verified final master PNG files.');
  });

  it('requires item count, listing description and effective room theme', () => {
    const missing = missingThumbnailGeneratePromptFields({
      ...ant, numberOfAnimals: null, animals: '  ', collectionTheme: '',
    });
    expect(missing).toEqual(['Number of items', 'Listing description', 'Room theme']);
    expect(() => buildThumbnailGeneratePrompt({ ...ant, animals: '' })).toThrow('Listing description');
    expect(() => buildThumbnailGeneratePrompt({ ...ant, numberOfAnimals: 0 })).toThrow('Number of items');
    expect(() => buildThumbnailGeneratePrompt({ ...ant, collectionTheme: ' ' })).toThrow('Room theme');
  });

  it('adapts the animal type to other section themes without changing animal wording', () => {
    const prompt = buildThumbnailGeneratePrompt({
      numberOfAnimals: 3,
      animals: 'T. rex\nTriceratops\nStegosaurus',
      collectionTheme: 'Dinosaurs',
      sectionName: 'Sets of 3',
    });
    expect(prompt).toContain('NO_OF_ANIMALS: 3');
    expect(prompt).toContain('ANIMAL_TYPE: dinosaur');
    expect(prompt).toContain('T. rex\nTriceratops\nStegosaurus');
    expect(animalTypeForThumbnailPrompt('Sea Creatures Wall Art', 'Sea Creatures')).toBe('sea creature');
    expect(animalTypeForThumbnailPrompt('Woodland Wall Art', 'Woodland')).toBe('woodland animal');
  });

  it('builds Thumbnail prompt 1 from the listing item, description and room theme', () => {
    const input = {
      animal: 'Green Sea Turtle',
      listingDescription: 'Green sea turtle – soft green tones, calm, and nature-inspired',
      collectionTheme: 'Sea Creatures',
      sectionName: 'Sea Creatures Wall Art',
    };
    const prompt = buildThumbnailIllustrationPrompt(input);

    expect(thumbnailIllustrationPromptValues(input)).toEqual({
      animal: 'Green sea turtle',
      animalDescription: 'Soft green tones, calm, and nature-inspired',
      collectionTheme: 'Soft sea creatures-inspired nursery wall art',
      animalType: 'Sea creature',
    });
    expect(prompt).toContain('ANIMAL = "Green sea turtle"');
    expect(prompt).toContain('ANIMAL_DESCRIPTION = "Soft green tones, calm, and nature-inspired"');
    expect(prompt).toContain('COLLECTION_THEME = "Soft sea creatures-inspired nursery wall art"');
    expect(prompt).toContain('ANIMAL_TYPE = "Sea creature"');
    expect(prompt).toContain('Generate a PNG with genuine transparency.');
    expect(prompt).toContain('Final print preparation will happen in a separate step.');
  });

  it('requires the fields used by Thumbnail prompt 1', () => {
    const missing = missingThumbnailIllustrationPromptFields({
      animal: '',
      listingDescription: '',
      collectionTheme: '',
      sectionName: '',
    });
    expect(missing).toEqual(['Listing item', 'Listing description', 'Room theme']);
  });

  it('builds Thumbnail prompt 2 with deterministic print-master checks', () => {
    const prompt = buildThumbnailPrintMasterPrompt();

    expect(prompt).toContain('FINAL_WIDTH_PX = 7016');
    expect(prompt).toContain('FINAL_HEIGHT_PX = 9933');
    expect(prompt).toContain('SIDE_MARGIN_MINIMUM_PERCENT = 7.5');
    expect(prompt).toContain('Minimum left margin: 527 pixels');
    expect(prompt).toContain('Maximum illustration box: 5962 × 6953 pixels');
    expect(prompt).toContain('abs(left_margin - right_margin) ≤ 1 pixel');
    expect(prompt).toContain('Return the verified final PNG as a downloadable file.');
  });
});
