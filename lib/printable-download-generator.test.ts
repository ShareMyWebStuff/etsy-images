import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createHowToPrintGuide, createPrintableDownload } from '@/lib/printable-download-generator';
import { createListingPrintCropSettings, fourByFivePrintCropDraft, PRINT_CROP_RATIOS } from '@/lib/listing-print-crops';

async function horizontalColourBands(width: number, height: number) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      data[offset] = Math.round(x * 255 / (width - 1));
      data[offset + 1] = 60;
      data[offset + 2] = 30;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe('printable download generator', () => {
  it.each(PRINT_CROP_RATIOS)('uses the horizontally selected full-height $label region of a portrait 4:5 thumbnail', async (ratio) => {
    const source = { fileName: 'art.png', updatedAt: '2026-11-13T00:00:00.000Z', width: 400, height: 500 };
    const artwork = await horizontalColourBands(source.width, source.height);
    const results = [];
    for (const side of ['left', 'right'] as const) {
      const draft = fourByFivePrintCropDraft(source.width, source.height, 'portrait');
      const region = draft.regions[ratio.key];
      region.x = side === 'left' ? 0 : 1 - region.width;
      const settings = createListingPrintCropSettings(draft, source);
      const dimensions = { width: Math.round(300 * ratio.width / ratio.height), height: 300 };
      const generated = await createPrintableDownload(artwork, ratio.key, 'selected region', dimensions,
        settings.regions[ratio.key], settings.placements[ratio.key]);
      const decoded = await sharp(generated.buffer).raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => [...decoded.data.subarray((y * decoded.info.width + x) * decoded.info.channels, (y * decoded.info.width + x) * decoded.info.channels + 3)];
      const sampleX = Math.floor(dimensions.width / 4);
      const actual = pixel(sampleX, 150);
      const expectedSourceX = (region.x + region.width * (sampleX + 0.5) / dimensions.width) * source.width;
      expect(actual[0]).toBeCloseTo(Math.round(expectedSourceX * 255 / (source.width - 1)), -1);
      for (const [x, y] of [[0, 0], [dimensions.width - 1, 0], [0, 299], [dimensions.width - 1, 299]]) {
        // The selected area fills the paper to its top and bottom; no old scaled-artwork margins remain.
        expect(pixel(x, y)[1]).toBeLessThan(90);
      }
      expect(generated.orientation).toBe('portrait');
      results.push(actual[0]);
    }
    if (ratio.key === '4x5') expect(results[0]).toBe(results[1]);
    else expect(results[1]).toBeGreaterThan(results[0]);
  });

  it.each(PRINT_CROP_RATIOS)('keeps the source height while horizontally positioning a landscape 5:4 image on $label paper', async (ratio) => {
    const source = { fileName: 'art.png', updatedAt: '2026-11-13T00:00:00.000Z', width: 500, height: 400 };
    const artwork = await horizontalColourBands(source.width, source.height);
    const dimensions = { width: Math.round(200 * ratio.height / ratio.width), height: 200 };
    const edgeColours: Array<{ left: number; right: number }> = [];
    for (const side of ['left', 'right'] as const) {
      const draft = fourByFivePrintCropDraft(source.width, source.height, 'landscape');
      const region = draft.regions[ratio.key];
      region.x = side === 'left' ? 0 : 1 - region.width;
      const settings = createListingPrintCropSettings(draft, source, 'landscape');
      const generated = await createPrintableDownload(artwork, ratio.key, 'landscape selected region', dimensions,
        settings.regions[ratio.key], settings.placements[ratio.key]);
      const decoded = await sharp(generated.buffer).raw().toBuffer({ resolveWithObject: true });
      const green = (x: number, y: number) => decoded.data[(y * decoded.info.width + x) * decoded.info.channels + 1];
      expect(generated.orientation).toBe('landscape');
      expect(green(Math.floor(dimensions.width / 2), 0)).toBeLessThan(90);
      expect(green(Math.floor(dimensions.width / 2), dimensions.height - 1)).toBeLessThan(90);
      const edgeInset = Math.max(0, Math.floor((dimensions.width - 250) / 2));
      edgeColours.push({ left: green(edgeInset, 100), right: green(dimensions.width - edgeInset - 1, 100) });
    }
    if (ratio.key === '4x5') {
      expect(edgeColours[0].left).toBeLessThan(90);
      expect(edgeColours[1].right).toBeLessThan(90);
    } else {
      expect(edgeColours[0].left).toBeLessThan(90);
      expect(edgeColours[0].right).toBeGreaterThan(150);
      expect(edgeColours[1].left).toBeGreaterThan(150);
      expect(edgeColours[1].right).toBeLessThan(90);
    }
  });

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

  it('preserves landscape side padding and its position for extended crops without explicit placements', async () => {
    const source = await horizontalColourBands(500, 400);
    for (const [x, rightHasPadding] of [[-0.1, true], [-0.2, false]] as const) {
      const generated = await createPrintableDownload(source, '2x3', 'extended crop',
        { width: 300, height: 200 }, { x, y: 0, width: 1.2, height: 1 });
      const { data, info } = await sharp(generated.buffer).raw().toBuffer({ resolveWithObject: true });
      const green = (pixelX: number, pixelY: number) => data[(pixelY * info.width + pixelX) * info.channels + 1];
      expect(generated.orientation).toBe('landscape');
      expect(green(5, 100)).toBeGreaterThan(230);
      if (rightHasPadding) expect(green(294, 100)).toBeGreaterThan(230);
      else expect(green(294, 100)).toBeLessThan(90);
      expect(green(150, 0)).toBeLessThan(90);
      expect(green(150, 199)).toBeLessThan(90);
    }
  });

  it('continues to prefer an explicit artwork placement over an extended crop frame', async () => {
    const source = await horizontalColourBands(500, 400);
    const generated = await createPrintableDownload(source, '2x3', 'explicit placement',
      { width: 300, height: 200 }, { x: -0.1, y: 0, width: 1.2, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 });
    const { data, info } = await sharp(generated.buffer).raw().toBuffer({ resolveWithObject: true });
    for (const x of [0, info.width - 1]) {
      expect(data[(100 * info.width + x) * info.channels + 1]).toBeLessThan(90);
    }
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
