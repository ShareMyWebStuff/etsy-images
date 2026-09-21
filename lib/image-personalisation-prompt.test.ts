import { describe, expect, it, vi } from 'vitest';
import {
  buildCameronsImagePrompt,
  buildGuysImagePrompt,
  buildIslasImagePrompt,
  buildVickiesImagePrompt,
  PERSONALISATION_SOURCE_HEIGHT_PX,
  PERSONALISATION_SOURCE_WIDTH_PX,
  prepareImagePersonalisationPrompt,
  textForPersonalisationMode,
  type PersonalisationPromptMode,
} from '@/lib/image-personalisation-prompt';
import { getPersonalisationFont } from '@/lib/personalisation-fonts';

const regularFont = getPersonalisationFont('nunito')!;

function promptValue<T>(prompt: string, key: string): T {
  const value = prompt.match(new RegExp(`^${key} = (.+)$`, 'm'))?.[1];
  if (!value) throw new Error(`${key} is missing from the prompt.`);
  return JSON.parse(value) as T;
}

function prepare(mode: PersonalisationPromptMode, headerText = "Rory's", footerText = 'Bedroom') {
  return prepareImagePersonalisationPrompt({
    mode, headerText, footerText, font: regularFont,
    sourceWidth: PERSONALISATION_SOURCE_WIDTH_PX,
    sourceHeight: PERSONALISATION_SOURCE_HEIGHT_PX,
    loadFont: vi.fn().mockResolvedValue(undefined),
  });
}

describe('curved image personalisation prompts', () => {
  it('builds the Camerons image prompt with fixed text and transformation values', () => {
    const bold = getPersonalisationFont('fredoka-bold')!;
    const prompt = buildCameronsImagePrompt(bold);

    expect(promptValue<string>(prompt, 'HEADER_TEXT')).toBe("Cameron's");
    expect(promptValue<string>(prompt, 'FOOTER_TEXT')).toBe('Room');
    expect(promptValue<string>(prompt, 'TEXT_TRANSFORM')).toBe('NONE');
    expect(promptValue<string>(prompt, 'FONT_NAME')).toBe('Fredoka');
    expect(prompt).toContain('FONT_WEIGHT = 700');
    expect(promptValue<string>(prompt, 'FONT_FILE_NAME')).toBe('Fredoka-Bold.ttf');
    expect(prompt).toContain('SOURCE_WIDTH_PX = 1446');
    expect(prompt).toContain('SOURCE_HEIGHT_PX = 2048');
  });

  it('builds the Guys image prompt with its fixed header and uppercase transformation', () => {
    const bold = getPersonalisationFont('fredoka-bold')!;
    const prompt = buildGuysImagePrompt(bold);

    expect(promptValue<string>(prompt, 'HEADER_TEXT')).toBe("Guy's Bedroom");
    expect(promptValue<string>(prompt, 'FOOTER_TEXT')).toBe('');
    expect(promptValue<string>(prompt, 'TEXT_TRANSFORM')).toBe('UPPERCASE');
    expect(promptValue<string>(prompt, 'FONT_NAME')).toBe('Fredoka');
    expect(prompt).toContain('FONT_WEIGHT = 700');
    expect(promptValue<string>(prompt, 'FONT_FILE_NAME')).toBe('Fredoka-Bold.ttf');
    expect(prompt).toContain('SOURCE_WIDTH_PX = 1446');
    expect(prompt).toContain('SOURCE_HEIGHT_PX = 2048');
  });

  it('builds the Vickies image prompt with its fixed footer and unchanged text', () => {
    const bold = getPersonalisationFont('fredoka-bold')!;
    const prompt = buildVickiesImagePrompt(bold);

    expect(promptValue<string>(prompt, 'HEADER_TEXT')).toBe('');
    expect(promptValue<string>(prompt, 'FOOTER_TEXT')).toBe("Vickie's Playroom");
    expect(promptValue<string>(prompt, 'TEXT_TRANSFORM')).toBe('NONE');
    expect(promptValue<string>(prompt, 'FONT_NAME')).toBe('Fredoka');
    expect(prompt).toContain('FONT_WEIGHT = 700');
    expect(promptValue<string>(prompt, 'FONT_FILE_NAME')).toBe('Fredoka-Bold.ttf');
    expect(prompt).toContain('SOURCE_WIDTH_PX = 1446');
    expect(prompt).toContain('SOURCE_HEIGHT_PX = 2048');
  });

  it('builds the Islas image prompt with its fixed text and unchanged case', () => {
    const bold = getPersonalisationFont('fredoka-bold')!;
    const prompt = buildIslasImagePrompt(bold);

    expect(promptValue<string>(prompt, 'HEADER_TEXT')).toBe("Isla's bedroom");
    expect(promptValue<string>(prompt, 'FOOTER_TEXT')).toBe('Keep out');
    expect(promptValue<string>(prompt, 'TEXT_TRANSFORM')).toBe('NONE');
    expect(promptValue<string>(prompt, 'FONT_NAME')).toBe('Fredoka');
    expect(prompt).toContain('FONT_WEIGHT = 700');
    expect(promptValue<string>(prompt, 'FONT_FILE_NAME')).toBe('Fredoka-Bold.ttf');
    expect(prompt).toContain('SOURCE_WIDTH_PX = 1446');
    expect(prompt).toContain('SOURCE_HEIGHT_PX = 2048');
  });

  it('uses the header, footer or both according to the selected row', async () => {
    expect(textForPersonalisationMode('top', "Rory's", 'Bedroom')).toEqual({ headerText: "Rory's", footerText: '' });
    expect(textForPersonalisationMode('bottom', "Rory's", 'Bedroom')).toEqual({ headerText: '', footerText: 'Bedroom' });
    expect(textForPersonalisationMode('both', "Rory's", 'Bedroom')).toEqual({ headerText: "Rory's", footerText: 'Bedroom' });

    const [top, bottom, both] = await Promise.all([prepare('top'), prepare('bottom'), prepare('both')]);
    expect(promptValue<string>(top.prompt, 'HEADER_TEXT')).toBe("Rory's");
    expect(promptValue<string>(top.prompt, 'FOOTER_TEXT')).toBe('');
    expect(promptValue<string>(bottom.prompt, 'HEADER_TEXT')).toBe('');
    expect(promptValue<string>(bottom.prompt, 'FOOTER_TEXT')).toBe('Bedroom');
    expect(promptValue<string>(both.prompt, 'HEADER_TEXT')).toBe("Rory's");
    expect(promptValue<string>(both.prompt, 'FOOTER_TEXT')).toBe('Bedroom');
  });

  it('fully resolves text, font and original-image dimensions without orientation arrays', async () => {
    const headerText = `Rory's "Room" \\ ✨`;
    const result = await prepare('both', headerText, 'Bedroom');
    expect(promptValue<string>(result.prompt, 'HEADER_TEXT')).toBe(headerText);
    expect(promptValue<string>(result.prompt, 'FONT_NAME')).toBe('Nunito');
    expect(result.prompt).toContain('FONT_WEIGHT = 400');
    expect(result.prompt).toContain('FONT_WIDTH = 100');
    expect(result.prompt).toContain('FONT_FILE_NAME = "Nunito-Regular.ttf"');
    expect(result.prompt).toContain('TEXT_TRANSFORM = "UPPERCASE"');
    expect(result.prompt).toContain('TARGET_TEXT_WIDTH_PERCENT = 65');
    expect(result.prompt).toContain('MAX_FONT_SIZE_PERCENT = 18');
    expect(result.prompt).toContain('HEADER_CURVE = "ARCH_UP"');
    expect(result.prompt).toContain('FOOTER_CURVE = "ARCH_DOWN"');
    expect(result.prompt).toContain('CURVE_RISE_PERCENT_OF_LINE_WIDTH = 5');
    expect(result.prompt).toContain('SOURCE_WIDTH_PX = 1446');
    expect(result.prompt).toContain('SOURCE_HEIGHT_PX = 2048');
    expect(result.prompt).toContain('The header fits entirely between 5% and 15%');
    expect(result.prompt).toContain('The footer fits entirely between 85% and 95%');
    expect(result.prompt).toContain('Do not use individual orientation arrays');
    expect(result.prompt).not.toContain('HEADER_ORIENTATIONS =');
    expect(result.prompt).not.toContain('LETTER_ROTATION_PATTERN_DEGREES =');
    expect(result.prompt).not.toMatch(/\{\{[^}]+\}\}/);
    expect([result.sourceWidth, result.sourceHeight]).toEqual([1446, 2048]);
  });

  it('rejects empty applicable text and invalid source dimensions', async () => {
    await expect(prepare('top', ' ', 'Bedroom')).rejects.toThrow('Enter text');
    await expect(prepare('bottom', "Rory's", ' ')).rejects.toThrow('Enter text');
    await expect(prepareImagePersonalisationPrompt({
      mode: 'both', headerText: 'Rory', footerText: 'Room', font: regularFont,
      sourceWidth: 0, sourceHeight: 1492, loadFont: vi.fn(),
    })).rejects.toThrow('dimensions are invalid');
  });

  it('does not prepare a prompt when the selected font fails to load', async () => {
    await expect(prepareImagePersonalisationPrompt({
      mode: 'top', headerText: 'Rory', footerText: '', font: regularFont,
      sourceWidth: 1000, sourceHeight: 1000,
      loadFont: vi.fn().mockRejectedValue(new Error('Font failed')),
    })).rejects.toThrow('Font failed');
  });

  it('uses Fredoka Bold weight 700 and its matching downloadable file when selected', async () => {
    const bold = getPersonalisationFont('fredoka-bold')!;
    const loadFont = vi.fn().mockResolvedValue(undefined);
    const result = await prepareImagePersonalisationPrompt({
      mode: 'both', headerText: 'Rory', footerText: 'Bedroom', font: bold,
      sourceWidth: 3000, sourceHeight: 4000, loadFont,
    });
    expect(result.prompt).toContain('FONT_NAME = "Fredoka"');
    expect(result.prompt).toContain('FONT_WEIGHT = 700');
    expect(result.prompt).toContain('FONT_FILE_NAME = "Fredoka-Bold.ttf"');
    expect(result.prompt).toContain('SOURCE_WIDTH_PX = 3000');
    expect(result.prompt).toContain('SOURCE_HEIGHT_PX = 4000');
    expect(loadFont).toHaveBeenCalledWith(bold);
  });
});
