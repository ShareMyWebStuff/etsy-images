import { describe, expect, it } from 'vitest';
import { getListingTodoItems, isListingComplete, type ListingCompletionState } from '@/lib/listing-completeness';

const completeState: ListingCompletionState = {
  hasListingDescription: true,
  hasThumbnail: true,
  hasRequiredImages: true,
  hasCurrentZips: true,
  hasCurrentDropbox: true,
  hasEtsyProducts: true,
  hasDownloadSection: true,
  hasTags: true,
  hasTitle: true,
  hasEtsyDescription: true,
  hasQuantity: true,
  hasDigitalTitle: true,
  hasDigitalDescription: true,
  hasDigitalQuantity: true,
  hasPrimaryColour: true,
};

describe('listing completeness', () => {
  it('requires the listing description', () => {
    const state = { ...completeState, hasListingDescription: false };
    expect(isListingComplete(state)).toBe(false);
    expect(getListingTodoItems(state)).toEqual([{ label: 'Add the listing description', tab: 'thumbnail' }]);
  });

  it('reports when fewer than 15 listing images are uploaded', () => {
    const state = { ...completeState, hasRequiredImages: false };
    expect(isListingComplete(state)).toBe(false);
    expect(getListingTodoItems(state)).toEqual([{ label: 'Upload at least 15 listing images', tab: 'images' }]);
  });

  it('requires a download section', () => {
    const state = { ...completeState, hasDownloadSection: false };
    expect(isListingComplete(state)).toBe(false);
    expect(getListingTodoItems(state)).toEqual([{ label: 'Select a download section', tab: 'etsy-products' }]);
  });

  it('requires separate Print and Digital Download details', () => {
    const state = { ...completeState, hasTitle: false, hasDigitalDescription: false, hasDigitalQuantity: false };
    expect(isListingComplete(state)).toBe(false);
    expect(getListingTodoItems(state)).toEqual([
      { label: 'Add the Print Etsy title', tab: 'details' },
      { label: 'Add the Digital Download Etsy description', tab: 'details' },
      { label: 'Set a Digital Download quantity greater than zero', tab: 'details' },
    ]);
  });

  it('reports every incomplete requirement and accepts a complete listing', () => {
    expect(getListingTodoItems({ ...completeState, hasThumbnail: false, hasTags: false })).toEqual([
      { label: 'Upload the thumbnail', tab: 'thumbnail' },
      { label: 'Add at least one tag', tab: 'tags' },
    ]);
    expect(isListingComplete(completeState)).toBe(true);
  });
});
