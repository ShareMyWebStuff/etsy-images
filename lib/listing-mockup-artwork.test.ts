import { describe, expect, it, vi } from 'vitest';

import { drawMockupArtwork } from '@/lib/listing-mockup-artwork';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';

function drawing(width: number, height: number) {
  const image = { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
  const context = { save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(), restore: vi.fn() };
  return { image, context, canvasContext: context as unknown as CanvasRenderingContext2D };
}

function cropSettings(width: number, height: number, orientation: 'portrait' | 'landscape' = 'portrait') {
  return createListingPrintCropSettings(defaultNativeListingPrintCropDraft(width, height, orientation), {
    fileName: 'thumbnail.png', updatedAt: '2026-11-13T12:00:00.000Z', width, height,
  }, orientation);
}

describe('mockup saved artwork crops', () => {
  it('clips a right-aligned portrait selection to the paper rather than containing the complete thumbnail', () => {
    const { image, context, canvasContext } = drawing(4000, 5000);
    const settings = cropSettings(4000, 5000);
    settings.regions['2x3'].x = 1 / 6;
    drawMockupArtwork(canvasContext, image, { x: 100, y: 50, width: 600, height: 900 }, '2x3', settings);
    expect(context.rect).toHaveBeenCalledWith(100, 50, 600, 900);
    expect(context.clip).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalledWith(image, expect.closeTo(-20), 50, 720, 900);
    expect(context.restore).toHaveBeenCalledOnce();
  });

  it('preserves landscape side margins from a crop extending beyond the source', () => {
    const { image, context, canvasContext } = drawing(5000, 4000);
    const settings = cropSettings(5000, 4000, 'landscape');
    settings.regions['2x3'].x = -0.2;
    drawMockupArtwork(canvasContext, image, { x: 100, y: 50, width: 900, height: 600 }, '2x3', settings);
    expect(context.rect).toHaveBeenCalledWith(100, 50, 900, 600);
    expect(context.drawImage).toHaveBeenCalledWith(image, expect.closeTo(250), 50, 750, 600);
  });

  it('contains an upright portrait crop in a landscape opening without stretching it', () => {
    const { image, context, canvasContext } = drawing(4000, 5000);
    const settings = cropSettings(4000, 5000);
    settings.regions['2x3'].x = 1 / 6;
    drawMockupArtwork(canvasContext, image, { x: 100, y: 50, width: 900, height: 600 }, '2x3', settings);
    expect(context.rect).toHaveBeenCalledWith(350, 50, 400, 600);
    expect(context.drawImage).toHaveBeenCalledWith(image, 270, 50, 480, 600);
  });

  it('maps the ISO A tester option to its saved print crop', () => {
    const { image, context, canvasContext } = drawing(4000, 5000);
    const settings = cropSettings(4000, 5000);
    settings.regions['iso-a1'].x = 0;
    drawMockupArtwork(canvasContext, image, { x: 0, y: 0, width: 600, height: 600 * Math.SQRT2 }, 'iso-a', settings);
    expect(context.clip).toHaveBeenCalledOnce();
    const [, x, y, width, height] = context.drawImage.mock.calls[0];
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(width).toBeCloseTo(600 * 4 * Math.SQRT2 / 5);
    expect(height).toBeCloseTo(600 * Math.SQRT2);
  });

  it('keeps complete-artwork containment for generated files and existing 2:3 artwork', () => {
    const { image, context, canvasContext } = drawing(2000, 3000);
    const opening = { x: 100, y: 50, width: 600, height: 900 };
    drawMockupArtwork(canvasContext, image, opening, '2x3');
    drawMockupArtwork(canvasContext, image, opening, '2x3', cropSettings(2000, 3000));
    expect(context.drawImage).toHaveBeenNthCalledWith(1, image, 100, 50, 600, 900);
    expect(context.drawImage).toHaveBeenNthCalledWith(2, image, 100, 50, 600, 900);
    expect(context.clip).not.toHaveBeenCalled();
  });
});
