import { describe, expect, it } from 'vitest';
import {
  animalTypeForThumbnailPrompt,
  buildThumbnailGeneratePrompt,
  missingThumbnailGeneratePromptFields,
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
    expect(prompt).toContain('The top 15% and bottom 15% must contain no illustrated content.');
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
    expect(animalTypeForThumbnailPrompt('See Creatures Wall Art', 'Sea Creatures')).toBe('sea creature');
    expect(animalTypeForThumbnailPrompt('Woodland Wall Art', 'Woodland')).toBe('woodland animal');
  });
});
