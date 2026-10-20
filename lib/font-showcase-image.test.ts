import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  createFontShowcaseImage,
  FONT_SHOWCASE_HEIGHT,
  FONT_SHOWCASE_WIDTH,
} from '@/lib/font-showcase-image';

describe('font showcase image', () => {
  it('creates a full-size opaque PNG using the configured fonts', async () => {
    const result = await createFontShowcaseImage();
    const metadata = await sharp(result).metadata();
    const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(FONT_SHOWCASE_WIDTH);
    expect(metadata.height).toBe(FONT_SHOWCASE_HEIGHT);
    expect(result.length).toBeGreaterThan(10_000);
    expect(info.channels).toBe(3);
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect(data.some((value) => value < 250)).toBe(true);
  });
});
