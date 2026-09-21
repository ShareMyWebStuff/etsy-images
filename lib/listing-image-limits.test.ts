import { describe, expect, it } from 'vitest';
import { hasRequiredListingImages, LISTING_COMPLETE_MIN_IMAGES, LISTING_IMAGE_GUIDE } from '@/lib/listing-image-limits';

describe('listing image limits', () => {
  it('requires at least 15 uploaded images for listing completeness', () => {
    const images = Array.from({ length: LISTING_COMPLETE_MIN_IMAGES }, (_, index) => ({
      localFileName: `image_${index + 1}.jpg`,
    }));

    expect(LISTING_COMPLETE_MIN_IMAGES).toBe(15);
    expect(LISTING_COMPLETE_MIN_IMAGES).toBe(LISTING_IMAGE_GUIDE.length);
    expect(LISTING_IMAGE_GUIDE[6]).toBe('Aspect ratios');
    expect(LISTING_IMAGE_GUIDE.slice(7, 11)).toEqual([
      'Customised shelve - both normal case',
      'Customised bedroom door - both',
      'Customised beside bed - top normal case',
      'Customised playroom - bottom text',
    ]);
    expect(LISTING_IMAGE_GUIDE.slice(11)).toEqual([
      'No Frames Included',
      'Digital Download',
      'How to print',
      'Personal Use Only',
    ]);
    expect(hasRequiredListingImages(images.slice(0, 14))).toBe(false);
    expect(hasRequiredListingImages(images)).toBe(true);
    expect(hasRequiredListingImages([...images, { localFileName: 'image_16.jpg' }])).toBe(true);
    expect(hasRequiredListingImages([...images.slice(0, 14), { localFileName: ' ' }])).toBe(false);
  });
});
