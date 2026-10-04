import { describe, expect, it } from 'vitest';
import {
  buildListingDetailActionPrompt,
  buildListingDetailPromptSteps,
  CUSTOMISED_SHELVE_INDIVIDUAL_ACTIONS,
  isListingDetailImageStale,
} from '@/lib/listing-detail-workflow';

describe('customised listing detail workflow', () => {
  it('only marks an image stale when the thumbnail has a known newer timestamp', () => {
    expect(isListingDetailImageStale('2026-10-01T08:40:48.630Z', null)).toBe(false);
    expect(isListingDetailImageStale('2026-10-01T08:40:48.630Z', '2026-10-01T08:39:00.000Z')).toBe(false);
    expect(isListingDetailImageStale('2026-10-01T08:40:48.630Z', '2026-10-01T08:41:00.000Z')).toBe(true);
  });

  it('exposes the four customised shelf stages as individual actions in order', () => {
    expect(CUSTOMISED_SHELVE_INDIVIDUAL_ACTIONS.map((action) => action.label)).toEqual([
      '1. Generate artwork',
      '2. Download and name print master',
      '3. Generate image with letters',
      '4. Generate customised shelve image',
    ]);
  });

  const input = {
    roomTheme: 'Sea Creatures',
    listingItem: 'Hermit Crab',
    listingDescription: 'Hermit Crab - gentle, curious and playful',
    sectionName: 'Sea Creatures Wall Art',
    sourceWidth: 1086,
    sourceHeight: 1448,
  };

  it.each([
    ['customised-shelve-image', { headerText: "Isla's bedroom", footerText: 'Keep out', textTransform: 'NONE' }],
    ['customised-bedroom-door-image', { headerText: "Cameron's", footerText: 'Room', textTransform: 'NONE' }],
    ['customised-beside-bed-image', { headerText: "Guy's Bedroom", footerText: '', textTransform: 'UPPERCASE' }],
    ['customised-playroom-image', { headerText: '', footerText: "Vickie's Playroom", textTransform: 'NONE' }],
  ] as const)('uses the saved thumbnail, local upscale and existing lettering for %s', (key, expectedText) => {
    const steps = buildListingDetailPromptSteps(key, input);

    expect(steps).toHaveLength(3);
    expect(steps[0].processor).toBe('local_print_master');
    expect(steps[0].includeFont).toBe(false);
    expect(steps[0].outputKind).toBe('download_file');
    expect(steps[0].prompt).toContain('FINAL_WIDTH_PX = 7016');
    expect(steps[0].prompt).toContain('FINAL_HEIGHT_PX = 9933');
    expect(steps[1].includeFont).toBe(true);
    expect(steps[1].outputKind).toBe('download_file');
    expect(steps[1].processor).toBe('local_personalisation');
    expect(steps[1].localPersonalisation).toEqual(expectedText);
    expect(steps[1].prompt).toContain('SOURCE_WIDTH_PX = 7016');
    expect(steps[1].prompt).toContain('SOURCE_HEIGHT_PX = 9933');
    expect(steps[1].prompt).toContain('FONT_FILE_NAME = "Nunito-Regular.ttf"');
    expect(steps[2].processor).toBeUndefined();
    expect(steps[2].outputKind).toBeUndefined();
    expect(steps[2].prompt).toContain('ROOM_THEME = "Sea Creatures"');
    expect(steps[2].prompt).toContain('ANIMAL = "Hermit Crab"');
  });

  it('keeps the initial ChatGPT artwork generation in the four-button individual workflow', () => {
    const steps = buildListingDetailPromptSteps('customised-shelve-image', input, {
      includeThumbnailGeneration: true,
    });

    expect(steps).toHaveLength(4);
    expect(steps[0].includeFont).toBe(false);
    expect(steps[0].processor).toBeUndefined();
    expect(steps[0].prompt).toContain('ANIMAL = "Hermit Crab"');
    expect(steps[1].processor).toBe('local_print_master');
    expect(steps[2].processor).toBe('local_personalisation');
    expect(steps[3].processor).toBeUndefined();
  });

  it('uses the existing shelf text when personalising the individual print master', () => {
    const steps = buildListingDetailPromptSteps('customised-shelve-image', {
      roomTheme: 'Sea Creatures',
      listingItem: 'Hermit Crab',
      listingDescription: 'Hermit Crab - gentle, curious and playful',
      sectionName: 'Sea Creatures Wall Art',
      sourceWidth: 1086,
      sourceHeight: 1448,
    }, { includeThumbnailGeneration: true });

    expect(steps).toHaveLength(4);
    expect(steps[2].includeFont).toBe(true);
    expect(steps[2].outputKind).toBe('download_file');
    expect(steps[2].processor).toBe('local_personalisation');
    expect(steps[2].localPersonalisation).toEqual({
      headerText: "Isla's bedroom",
      footerText: 'Keep out',
      textTransform: 'NONE',
    });
    expect(steps[2].prompt).toContain('SOURCE_WIDTH_PX = 7016');
    expect(steps[2].prompt).toContain('SOURCE_HEIGHT_PX = 9933');
    expect(steps[2].prompt).toContain('FONT_FILE_NAME = "Nunito-Regular.ttf"');
  });

  it('copies only the final ChatGPT prompt after a customised source is prepared locally', () => {
    const prompt = buildListingDetailActionPrompt('customised-shelve-image', input);
    expect(prompt).toContain('ROOM_THEME = "Sea Creatures"');
    expect(prompt).toContain('ANIMAL = "Hermit Crab"');
    expect(prompt).not.toContain('FINAL_WIDTH_PX = 7016');
    expect(prompt).not.toContain('FONT_FILE_NAME = "Nunito-Regular.ttf"');
  });
});
