import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createPersonalisedPrintMaster } from '@/lib/thumbnail-personalisation';

describe('createPersonalisedPrintMaster', () => {
  it('renders curved header and footer lettering without moving the artwork', async () => {
    const source = await sharp({
      create: {
        width: 1000,
        height: 1400,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{
        input: {
          create: {
            width: 300,
            height: 500,
            channels: 4,
            background: { r: 130, g: 175, b: 110, alpha: 1 },
          },
        },
        left: 350,
        top: 450,
      }])
      .png()
      .withMetadata({ density: 300 })
      .toBuffer();
    const font = await readFile(path.join(process.cwd(), 'public', 'fonts', 'nunito', 'Nunito-Regular.ttf'));
    const result = await createPersonalisedPrintMaster(
      source,
      font,
      { headerText: "Isla's bedroom", footerText: 'Keep out', textTransform: 'NONE' },
      { width: 1000, height: 1400, density: 300 },
    );
    const metadata = await sharp(result.buffer).metadata();
    const { data, info } = await sharp(result.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[((y * info.width) + x) * info.channels + info.channels - 1];
    const bandHasText = (startY: number, endY: number) => {
      for (let y = startY; y < endY; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          if (alphaAt(x, y) > 0) return true;
        }
      }
      return false;
    };

    expect(metadata.width).toBe(1000);
    expect(metadata.height).toBe(1400);
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.density).toBe(300);
    expect(result.fontSize).toBeGreaterThan(0);
    expect(result.textColour).toMatch(/^#[0-9a-f]{6}$/);
    expect(bandHasText(70, 210)).toBe(true);
    expect(bandHasText(1190, 1330)).toBe(true);
    expect([data[((700 * info.width) + 500) * info.channels], data[((700 * info.width) + 500) * info.channels + 1], data[((700 * info.width) + 500) * info.channels + 2]])
      .toEqual([130, 175, 110]);
  });

  it('applies uppercase transformation without changing punctuation', async () => {
    const source = await sharp({
      create: {
        width: 1000,
        height: 1400,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).png().toBuffer();
    const font = await readFile(path.join(process.cwd(), 'public', 'fonts', 'nunito', 'Nunito-Regular.ttf'));
    const result = await createPersonalisedPrintMaster(
      source,
      font,
      { headerText: "Guy's Bedroom", footerText: '', textTransform: 'UPPERCASE' },
      { width: 1000, height: 1400 },
    );

    expect(result.headerText).toBe("GUY'S BEDROOM");
    expect(result.footerText).toBe('');
  });

  it('automatically shrinks long bold text to fit the reserved header area', async () => {
    const source = await sharp({
      create: {
        width: 600,
        height: 840,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).png().toBuffer();
    const font = await readFile(path.join(process.cwd(), 'public', 'fonts', 'fredoka', 'Fredoka-Bold.ttf'));

    const result = await createPersonalisedPrintMaster(
      source,
      font,
      { headerText: "WELCOME TO CAMERON'S WONDERFUL PLAYROOM", footerText: '', textTransform: 'NONE' },
      { width: 600, height: 840, fontFamily: 'Fredoka', fontWeight: 700 },
    );

    expect(result.fontSize).toBeGreaterThan(0);
    expect(result.fontSize).toBeLessThan(Math.floor(600 * 0.18));
    expect(await sharp(result.buffer).metadata()).toMatchObject({ width: 600, height: 840, hasAlpha: true });
  });
});
