import { describe, expect, it } from 'vitest';

import {
  constrainMockupPlacement,
  containArtwork,
  displayPointToImagePoint,
  mockupExportDimensions,
  mockupFrameGeometry,
  mockupHeightForWidth,
  scaleMockupPlacementForExport,
} from './listing-mockup-tester';

describe('listing mockup tester geometry', () => {
  it('uses the requested nearest-pixel ISO A relationships', () => {
    expect(mockupHeightForWidth(1000, 'iso-a', 'portrait')).toBe(Math.round(1000 * Math.SQRT2));
    expect(mockupHeightForWidth(1000, 'iso-a', 'landscape')).toBe(Math.round(1000 / Math.SQRT2));
  });

  it('converts scaled preview coordinates to intrinsic background coordinates', () => {
    expect(displayPointToImagePoint(260, 220, { left: 10, top: 20, width: 500, height: 400 }, 2000, 1600))
      .toEqual({ x: 1000, y: 800 });
  });

  it('keeps frame and shadow safety inside the background', () => {
    const placement = constrainMockupPlacement(
      { x: -100, y: -100, width: 900 },
      1000,
      1000,
      '4x5',
      'portrait',
      'oak',
      8,
      12,
      5,
    );
    const frame = mockupFrameGeometry(placement, 'oak', 8, 12, 5);
    expect(placement.x).toBeGreaterThan(0);
    expect(placement.y).toBeGreaterThan(0);
    expect(placement.x + placement.width).toBeLessThan(1000);
    expect(placement.y + placement.height).toBeLessThan(1000);
    expect(frame.backOuter.x + frame.backOuter.width + frame.shadowOffsetX + frame.shadowBlur).toBeLessThanOrEqual(1000);
    expect(frame.backOuter.y + frame.backOuter.height + frame.shadowOffsetY + frame.shadowBlur).toBeLessThanOrEqual(1000);
    expect(placement.height).toBe(Math.round(placement.width * 5 / 4));
  });

  it('adds frame depth outside the opening without changing the opening', () => {
    const opening = { x: 100, y: 80, width: 600, height: 800 };
    const frame = mockupFrameGeometry(opening, 'oak', 5, 0, 4);
    expect(opening).toEqual({ x: 100, y: 80, width: 600, height: 800 });
    expect(frame.outer).toEqual({ x: 70, y: 50, width: 660, height: 860 });
    expect(frame.frameDepth).toBe(24);
    expect(frame.backOuter.x).toBeGreaterThan(frame.outer.x);
    expect(frame.backOuter.y).toBeGreaterThan(frame.outer.y);
    expect(frame.depthX).toBeLessThan(frame.depthY);
    expect(frame.depthY).toBeLessThan(frame.frameDepth);
    expect(frame.shadowBlur).toBe(0);
    expect(frame.shadowOffsetX).toBe(0);
    expect(frame.shadowOffsetY).toBe(0);
  });

  it('exports square backgrounds at 3000 square and otherwise preserves aspect ratio', () => {
    expect(mockupExportDimensions(1200, 1200)).toEqual({ width: 3000, height: 3000 });
    expect(mockupExportDimensions(1600, 1200)).toEqual({ width: 3000, height: 2250 });
    expect(mockupExportDimensions(1000, 1500)).toEqual({ width: 2000, height: 3000 });
  });

  it('recomputes ISO A rounding at export resolution', () => {
    const source = constrainMockupPlacement({ x: 300, y: 200, width: 321 }, 2000, 1600, 'iso-a', 'portrait', 'black', 5, 8);
    const output = scaleMockupPlacementForExport(source, 2000, 1600, 3000, 2400, 'iso-a', 'portrait', 'black', 5, 8);
    expect(output.height).toBe(Math.round(output.width * Math.SQRT2));
  });

  it('contains complete artwork without stretching or cropping it', () => {
    expect(containArtwork(1000, 1000, { x: 100, y: 50, width: 800, height: 1200 }))
      .toEqual({ x: 100, y: 250, width: 800, height: 800 });
  });
});
