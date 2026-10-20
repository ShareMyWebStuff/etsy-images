import { describe, expect, it } from 'vitest';
import { planEtsyImageCleanup, selectEtsySyncImages } from './etsy-sync-images';

const images = Array.from({ length: 15 }, (_, index) => ({ rank: index + 1 }));
const slots = (items: typeof images) => items.map(({ rank }) => rank);
const settings = {
  printsFrames: true,
  customisePrints: true,
};

describe('selectEtsySyncImages', () => {
  it('keeps common images and print customisations on a print listing', () => {
    expect(slots(selectEtsySyncImages(images, 'print', settings))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('keeps common and download-only images without disabled customisations', () => {
    expect(slots(selectEtsySyncImages(images, 'download', settings))).toEqual([1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15]);
  });

  it('uses the legacy numbered slots only when an image has no template association', () => {
    expect(slots(selectEtsySyncImages(images, 'print', { ...settings, customisePrints: false }))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(slots(selectEtsySyncImages(images, 'download', settings))).toEqual([1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15]);
  });

  it('does not reclassify later slots when an earlier image is missing', () => {
    expect(slots(selectEtsySyncImages(images.filter(({ rank }) => rank !== 8), 'print', settings))).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 11]);
  });

  it('selects template-linked images from their explicit product flags', () => {
    const templateImages = [
      { rank: 1, name: 'All uses', ourCategoryImageTemplate: { useOnPrints: true, useOnCustomised: true, useOnDigital: true } },
      { rank: 2, name: 'Print only', ourCategoryImageTemplate: { useOnPrints: true, useOnCustomised: false, useOnDigital: false } },
      { rank: 3, name: 'Customised only', ourCategoryImageTemplate: { useOnPrints: false, useOnCustomised: true, useOnDigital: false } },
      { rank: 4, name: 'Digital only', ourCategoryImageTemplate: { useOnPrints: false, useOnCustomised: false, useOnDigital: true } },
      { rank: 5, name: 'Disabled', ourCategoryImageTemplate: { useOnPrints: false, useOnCustomised: false, useOnDigital: false } },
    ];
    const names = (items: typeof templateImages) => items.map(({ name }) => name);

    expect(names(selectEtsySyncImages(templateImages, 'download', settings))).toEqual(['All uses', 'Digital only']);
    expect(names(selectEtsySyncImages(templateImages, 'print', settings))).toEqual(['All uses', 'Print only', 'Customised only']);
    expect(names(selectEtsySyncImages(templateImages, 'customised', settings))).toEqual(['All uses', 'Customised only']);
    expect(names(selectEtsySyncImages(templateImages, 'print', { printsFrames: true, customisePrints: false }))).toEqual(['All uses', 'Print only']);
    expect(names(selectEtsySyncImages(templateImages, 'print', { printsFrames: false, customisePrints: true }))).toEqual(['All uses', 'Customised only']);
  });
});

describe('planEtsyImageCleanup', () => {
  it('deletes every stale image before upload when a selected remote image can remain', () => {
    expect(planEtsyImageCleanup(
      ['old-1', 'selected-1', 'old-2'],
      ['selected-1', null],
    )).toEqual({
      preUploadDeleteIds: ['old-1', 'old-2'],
      afterFirstUploadDeleteIds: [],
    });
  });

  it('keeps one old image until the first replacement upload succeeds', () => {
    expect(planEtsyImageCleanup(
      ['old-1', 'old-2', 'old-3'],
      [null, null],
    )).toEqual({
      preUploadDeleteIds: ['old-2', 'old-3'],
      afterFirstUploadDeleteIds: ['old-1'],
    });
  });

  it('does not schedule cleanup when Etsy has no images yet', () => {
    expect(planEtsyImageCleanup([], [null])).toEqual({
      preUploadDeleteIds: [],
      afterFirstUploadDeleteIds: [],
    });
  });
});
