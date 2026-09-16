import { describe, expect, it, vi } from 'vitest';
import {
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
    sourceWidth: 1024, sourceHeight: 1536,
    loadFont: vi.fn().mockResolvedValue(undefined),
  });
}

describe('curved image personalisation prompts', () => {
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
    expect(result.prompt).toContain('SOURCE_WIDTH_PX = 1024');
    expect(result.prompt).toContain('SOURCE_HEIGHT_PX = 1536');
    expect(result.prompt).toContain('The header fits entirely between 5% and 15%');
    expect(result.prompt).toContain('The footer fits entirely between 85% and 95%');
    expect(result.prompt).toContain('Do not use individual orientation arrays');
    expect(result.prompt).not.toContain('HEADER_ORIENTATIONS =');
    expect(result.prompt).not.toContain('LETTER_ROTATION_PATTERN_DEGREES =');
    expect(result.prompt).not.toMatch(/\{\{[^}]+\}\}/);
    expect([result.sourceWidth, result.sourceHeight]).toEqual([1024, 1536]);
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
