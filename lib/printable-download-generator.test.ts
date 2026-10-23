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

  it('exports exactly the saved region without adding margins or using the rest of the source', async () => {
    const source = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#ff0000' },
    })
      .composite([{
        input: await sharp({ create: { width: 200, height: 300, channels: 3, background: '#008000' } }).png().toBuffer(),
        left: 50,
        top: 0,
      }])
      .png()
      .toBuffer();

    const result = await createPrintableDownload(
      source,
      '2x3',
      'crop test',
      { width: 200, height: 300 },
      { x: 50 / 300, y: 0, width: 200 / 300, height: 1 },
    );
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 200, height: 300, channels: 3 });
    for (const [x, y] of [[0, 0], [199, 0], [0, 299], [199, 299]]) {
      const offset = ((y * info.width) + x) * info.channels;
      expect(data[offset]).toBeLessThan(20);
      expect(data[offset + 1]).toBeGreaterThan(110);
      expect(data[offset + 2]).toBeLessThan(20);
    }
  });

  it('uses landscape output dimensions for a landscape saved crop', async () => {
    const source = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#008000' } }).png().toBuffer();
    const result = await createPrintableDownload(
      source,
      '2x3',
      'landscape crop',
      { width: 300, height: 200 },
      { x: 0, y: 0, width: 1, height: 1 },
    );
    expect(result.orientation).toBe('landscape');
    expect(await sharp(result.buffer).metadata()).toMatchObject({ width: 300, height: 200 });
  });

  it('places the complete 4:5 artwork within taller portrait paper at its saved vertical offset', async () => {
    const source = await sharp({
      create: { width: 80, height: 100, channels: 3, background: '#008000' },
    }).png().toBuffer();
    const result = await createPrintableDownload(
      source,
      '2x3',
      'paper placement',
      { width: 120, height: 180 },
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0, y: 1 / 6, width: 1, height: 5 / 6 },
      '#FAF8F4',
    );
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    const top = 10 * info.channels;
    const middle = ((90 * info.width) + 10) * info.channels;
    expect(data[top]).toBeGreaterThanOrEqual(245);
    expect(data[top + 1]).toBeGreaterThanOrEqual(243);
    expect(data[top + 2]).toBeGreaterThanOrEqual(238);
    expect(data[middle]).toBeLessThan(20);
    expect(data[middle + 1]).toBeGreaterThan(110);
    expect(data[middle + 2]).toBeLessThan(20);
  });

  it('builds a branded PDF printing guide', async () => {
    const guide = await createHowToPrintGuide('green sea turtle', 'portrait');
    expect(guide.originalFileName).toBe('How_To_Print_Guide.pdf');
    expect(guide.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(guide.buffer.length).toBeGreaterThan(10_000);
  });
});
