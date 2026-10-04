import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createThumbnailPrintMaster } from '@/lib/thumbnail-print-master';

describe('createThumbnailPrintMaster', () => {
  it('crops transparent padding, scales proportionally and centres within the safe margins', async () => {
    const artwork = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{
        input: {
          create: {
            width: 50,
            height: 80,
            channels: 4,
            background: { r: 120, g: 180, b: 90, alpha: 1 },
          },
        },
        left: 25,
        top: 10,
      }])
      .png()
      .toBuffer();

    const result = await createThumbnailPrintMaster(artwork, {
      width: 200,
      height: 300,
      density: 300,
      sideMarginPercent: 7.5,
      topMarginPercent: 15,
      bottomMarginPercent: 15,
    });
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(300);
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.density).toBe(300);
    expect(result.artworkWidth / result.artworkHeight).toBeCloseTo(50 / 80, 2);
    expect(result.margins.left).toBeGreaterThanOrEqual(15);
    expect(result.margins.right).toBeGreaterThanOrEqual(15);
    expect(result.margins.top).toBeGreaterThanOrEqual(45);
    expect(result.margins.bottom).toBeGreaterThanOrEqual(45);
    expect(Math.abs(result.margins.left - result.margins.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.margins.top - result.margins.bottom)).toBeLessThanOrEqual(1);
    expect(result.upscaled).toBe(true);
  });

  it('rejects a flattened image without transparency', async () => {
    const flattened = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    }).png().toBuffer();

    await expect(createThumbnailPrintMaster(flattened, { width: 200, height: 300 }))
      .rejects.toThrow('genuinely transparent PNG');
  });
});
