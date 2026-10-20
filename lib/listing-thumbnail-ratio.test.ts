import { describe, expect, it } from 'vitest';
import { analyseListingThumbnailDimensions } from '@/lib/listing-thumbnail-ratio';

describe('listing thumbnail ratio validation', () => {
  it('accepts exact portrait and landscape 2:3 and 4:5 images', () => {
    expect(analyseListingThumbnailDimensions(2000, 3000)).toMatchObject({ ratio: '2x3', orientation: 'portrait', resized: false });
    expect(analyseListingThumbnailDimensions(3000, 2000)).toMatchObject({ ratio: '2x3', orientation: 'landscape', resized: false });
    expect(analyseListingThumbnailDimensions(2400, 3000)).toMatchObject({ ratio: '4x5', orientation: 'portrait', resized: false });
    expect(analyseListingThumbnailDimensions(3000, 2400)).toMatchObject({ ratio: '4x5', orientation: 'landscape', resized: false });
  });

  it('normalises a negligible pixel difference to exact integer dimensions', () => {
    expect(analyseListingThumbnailDimensions(2002, 3000)).toMatchObject({
      ratio: '2x3',
      targetWidth: 2000,
      targetHeight: 3000,
      resized: true,
    });
  });

  it('rejects images which are not approximately 2:3 or 4:5', () => {
    expect(() => analyseListingThumbnailDimensions(1000, 1000)).toThrow(/2:3 or 4:5/);
    expect(() => analyseListingThumbnailDimensions(1600, 900)).toThrow(/2:3 or 4:5/);
  });
});

