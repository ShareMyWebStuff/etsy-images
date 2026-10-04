import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createHowToPrintGuide, createPrintableDownload } from '@/lib/printable-download-generator';

describe('printable download generator', () => {
  it('creates and verifies a flattened 300 DPI JPEG from transparent artwork', async () => {
    const artwork = await sharp({
      create: { width: 100, height: 140, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: await sharp({
          create: { width: 50, height: 70, channels: 4, background: { r: 80, g: 140, b: 95, alpha: 1 } },
        }).png().toBuffer(),
        left: 25,
        top: 35,
      }])
      .png()
      .toBuffer();

    const result = await createPrintableDownload(artwork, 'iso-a1', 'green sea turtle', { width: 200, height: 280 });
    const metadata = await sharp(result.buffer).metadata();
    expect(result.originalFileName).toBe('Green_Sea_Turtle_ISO_A1_200x280_300DPI.jpeg');
    expect(metadata).toMatchObject({ format: 'jpeg', width: 200, height: 280, density: 300, hasAlpha: false });
  });

  it('builds a branded PDF printing guide', async () => {
    const guide = await createHowToPrintGuide('green sea turtle', 'portrait');
    expect(guide.originalFileName).toBe('How_To_Print_Guide.pdf');
    expect(guide.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(guide.buffer.length).toBeGreaterThan(10_000);
  });
});
