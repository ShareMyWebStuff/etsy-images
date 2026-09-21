import { describe, expect, it } from 'vitest';
import { selectEtsySyncImages } from './etsy-sync-images';

const images = Array.from({ length: 15 }, (_, index) => ({ rank: index + 1 }));
const slots = (items: typeof images) => items.map(({ rank }) => rank);
const settings = {
  customTop: true,
  customBottom: true,
  customisePrints: true,
  customiseDigitalDownloads: false,
};

describe('selectEtsySyncImages', () => {
  it('keeps common images and print customisations on a print listing', () => {
    expect(slots(selectEtsySyncImages(images, 'print', settings))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('keeps common and download-only images without disabled customisations', () => {
    expect(slots(selectEtsySyncImages(images, 'download', settings))).toEqual([1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15]);
  });

  it('uses the enabled text positions for each variant', () => {
    expect(slots(selectEtsySyncImages(images, 'print', { ...settings, customTop: false }))).toEqual([1, 2, 3, 4, 5, 6, 7, 11]);
    expect(slots(selectEtsySyncImages(images, 'download', { ...settings, customiseDigitalDownloads: true, customBottom: false }))).toEqual([1, 2, 3, 4, 5, 6, 7, 10, 12, 13, 14, 15]);
  });

  it('does not reclassify later slots when an earlier image is missing', () => {
    expect(slots(selectEtsySyncImages(images.filter(({ rank }) => rank !== 8), 'print', settings))).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 11]);
  });
});
