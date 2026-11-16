import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  createListingPersonalisationPreview,
  listingPersonalisationPreviewDimensions,
} from '@/lib/listing-personalisation-preview';
import { DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS } from '@/lib/personalisation-text-areas';
import { createListingPrintCropSettings, fourByFivePrintCropDraft } from '@/lib/listing-print-crops';

describe('listing personalisation previews', () => {
  it('uses the selected 4:5 thumbnail crop in View Images instead of adding old artwork margins', async () => {
    const source = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#008000' } })
      .composite([
        { input: await sharp({ create: { width: 100, height: 500, channels: 3, background: '#ff0000' } }).png().toBuffer(), left: 0, top: 0 },
        { input: await sharp({ create: { width: 100, height: 500, channels: 3, background: '#0000ff' } }).png().toBuffer(), left: 300, top: 0 },
      ]).png().toBuffer();
    const previews: Array<{ red: number; green: number; blue: number }> = [];
    for (const side of ['left', 'right'] as const) {
      const draft = fourByFivePrintCropDraft(400, 500, 'portrait');
      draft.regions['2x3'].x = side === 'left' ? 0 : 1 - draft.regions['2x3'].width;
      const settings = createListingPrintCropSettings(draft, {
        fileName: 'art.png', updatedAt: '2026-11-13T00:00:00.000Z', width: 400, height: 500,
      });
      const result = await createListingPersonalisationPreview(source, {
        sizeKey: '12x18', topText: '', bottomText: '', fontId: 'nunito-semibold',
        borderEnabled: false, borderSizePercent: 5, textAreas: DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS,
        cropRegion: settings.regions['2x3'], artworkPlacement: settings.placements['2x3'], orientation: 'portrait',
      });
      const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
      const sampleX = Math.round(info.width * 0.15);
      const offset = ((Math.floor(info.height / 2) * info.width) + sampleX) * info.channels;
      previews.push({ red: data[offset], green: data[offset + 1], blue: data[offset + 2] });
      for (const y of [0, info.height - 1]) {
        const middle = ((y * info.width) + Math.floor(info.width / 2)) * info.channels;
        expect(data[middle]).toBeLessThan(30);
        expect(data[middle + 1]).toBeGreaterThan(100);
        expect(data[middle + 2]).toBeLessThan(30);
      }
    }
    expect(previews[0].red).toBeGreaterThan(220);
    expect(previews[0].green).toBeLessThan(30);
    expect(previews[1].red).toBeLessThan(30);
    expect(previews[1].green).toBeGreaterThan(100);
  });

  it('uses the paper aspect ratio and source orientation', () => {
    expect(listingPersonalisationPreviewDimensions('8x10', false)).toEqual({ width: 1120, height: 1400, ratio: '4x5' });
    expect(listingPersonalisationPreviewDimensions('8x10', true)).toEqual({ width: 1400, height: 1120, ratio: '4x5' });
    expect(listingPersonalisationPreviewDimensions('24x36', false)).toEqual({ width: 933, height: 1400, ratio: '2x3' });
  });

  it('creates a view-sized image with optional personalised text and border', async () => {
    const source = await sharp({ create: { width: 500, height: 700, channels: 4, background: '#87A96B' } }).png().toBuffer();
    const result = await createListingPersonalisationPreview(source, {
      sizeKey: '5x7',
      topText: 'TOP',
      bottomText: 'BOTTOM',
      fontId: 'nunito-semibold',
      borderEnabled: true,
      borderSizePercent: 5,
      textAreas: DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS,
      cropRegion: { x: 0, y: 0, width: 1, height: 1 },
      artworkPlacement: { x: 0, y: 0, width: 1, height: 1 },
      orientation: 'portrait',
    });
    const metadata = await sharp(result.buffer).metadata();
    const corner = await sharp(result.buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1000);
    expect(metadata.height).toBe(1400);
    expect([...corner.subarray(0, 3)]).toEqual([255, 255, 255]);
  });

  it('creates the ISO A paper artwork even when no personalised text is supplied', async () => {
    const source = await sharp({ create: { width: 1120, height: 1400, channels: 4, background: '#008000' } }).png().toBuffer();
    const result = await createListingPersonalisationPreview(source, {
      sizeKey: 'a5',
      topText: '',
      bottomText: '',
      fontId: 'nunito-semibold',
      borderEnabled: false,
      borderSizePercent: 5,
      textAreas: DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS,
      cropRegion: { x: 0.05805826175840784, y: 0, width: 0.8838834764831843, height: 1 },
      artworkPlacement: { x: 0.04, y: 0.0934136008177352, width: 0.92, height: 0.8131727983645296 },
      orientation: 'portrait',
      backgroundColour: '#FAF8F4',
    });
    const metadata = await sharp(result.buffer).metadata();
    const corner = await sharp(result.buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    const centre = await sharp(result.buffer)
      .extract({ left: Math.floor(result.width / 2), top: Math.floor(result.height / 2), width: 1, height: 1 })
      .raw()
      .toBuffer();

    expect(metadata.width).toBe(987);
    expect(metadata.height).toBe(1400);
    expect(corner[0]).toBeGreaterThan(245);
    expect(corner[1]).toBeGreaterThan(240);
    expect(corner[2]).toBeGreaterThan(235);
    expect(centre[1]).toBeGreaterThan(100);
    expect(centre[0]).toBeLessThan(40);
    expect(centre[2]).toBeLessThan(40);
  });
});
