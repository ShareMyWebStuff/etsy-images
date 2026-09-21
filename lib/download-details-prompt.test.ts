import { describe, expect, it } from 'vitest';
import { buildDownloadDetailsPrompt, missingDownloadDetailsPromptFields } from '@/lib/download-details-prompt';

const values = {
  animalName: ' Green Sea Turtle ',
  animalDescription: 'Green Sea Turtle – soft green tones, calm, and nature-inspired',
  roomTheme: 'Sea Creatures',
  frameColour: 'Natural Oak',
  orientation: 'portrait',
  fileType: 'jpeg',
  frameColours: 'Black, White, Natural Oak',
  filesIncluded: 'Green_Sea_Turtle_2x3.jpeg, Green_Sea_Turtle_3x4.jpeg, How_to_Print_Guide.pdf',
  recommendedPaper: 'Heavyweight matte photo paper, approximately 200–250 gsm',
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
    expect(prompt).toContain('FILES_INCLUDED: Green_Sea_Turtle_2x3.jpeg, Green_Sea_Turtle_3x4.jpeg, How_to_Print_Guide.pdf');
    expect(prompt).toContain('RECOMMENDED_PAPER: Heavyweight matte photo paper, approximately 200–250 gsm');
    expect(prompt).toContain('LICENCE_TYPE: Personal use only');
    expect(prompt).toContain('green-sea-turtle_title.txt');
    expect(prompt).toContain('green-sea-turtle_info.zip');
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
