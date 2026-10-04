import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { detectDominantEtsyColours } from '@/lib/etsy-image-colours';

function testArtwork(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number, number]) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const colour = pixel(x, y);
      data.set(colour, offset);
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe('Etsy thumbnail colour analysis', () => {
  it('returns the two most common matching Etsy colours', async () => {
    const image = await testArtwork(100, 100, (x) => (
      x < 65 ? [70, 130, 80, 255] : [210, 180, 140, 255]
    ));
    const colours = await detectDominantEtsyColours(image);
    expect(colours.map((colour) => colour.value)).toEqual(['green', 'beige']);
    expect(colours[0].percentage).toBe(65);
    expect(colours[1].percentage).toBe(35);
  });

  it('ignores transparency and connected near-white canvas around the artwork', async () => {
    const image = await testArtwork(100, 100, (x, y) => {
      if (x < 5) return [255, 255, 255, 0];
      if (x < 20 || x >= 80 || y < 20 || y >= 80) return [255, 255, 255, 255];
      return x < 60 ? [70, 130, 80, 255] : [210, 180, 140, 255];
    });
    const colours = await detectDominantEtsyColours(image);
    expect(colours.map((colour) => colour.value)).toEqual(['green', 'beige']);
    expect(colours.some((colour) => colour.value === 'white')).toBe(false);
  });
});
