import { describe, expect, it } from 'vitest';

import { buildDigitalDownloadGenerateSixPrompt } from '@/lib/digital-download-generate-six-prompt';

describe('Digital Downloads Generate 6 prompt', () => {
  it('populates every listing variable and retains the six-ratio bundle requirements', () => {
    const prompt = buildDigitalDownloadGenerateSixPrompt({
      animalName: 'Green Sea Turtle',
      animalDescription: 'soft green tones, calm, and nature-inspired',
      roomTheme: 'Sea Creatures',
      frameColour: 'Natural Oak',
      orientation: 'Portrait',
      fileType: 'jpeg',
      referenceImage: 'the thumbnail image attached to this prompt',
    });

    expect(prompt).toContain('ANIMAL: Green Sea Turtle – soft green tones, calm, and nature-inspired');
    expect(prompt).toContain('ROOM_THEME: Sea Creatures');
    expect(prompt).toContain('FRAME_COLOUR: Natural Oak');
    expect(prompt).toContain('ORIENTATION: Portrait');
    expect(prompt).toContain('FILE_TYPE: jpeg');
    expect(prompt).toContain('REFERENCE_IMAGE: the thumbnail image attached to this prompt');
    expect(prompt).toContain('SOURCE_IMAGE_FILE: the thumbnail image attached to this prompt');
    expect(prompt).toContain('The listing thumbnail image must be attached to the same ChatGPT message when this prompt is run.');
    expect(prompt).toContain('ERROR: The source artwork image must be attached when this prompt is run.');
    expect(prompt).toContain('1. ISO A-series — A1 master');
    expect(prompt).toContain('Portrait: 7016 × 9933 pixels');
    expect(prompt).toContain('Covers A1, A2, A3, A4 and A5');
    expect(prompt).not.toContain('ISO_A2');
    expect(prompt).toContain('6. 5:7 ratio — 20×28-inch master');
    expect(prompt).toContain('Confirm exactly seven unique root entries');
    expect(prompt).not.toContain('{{');
  });
});
