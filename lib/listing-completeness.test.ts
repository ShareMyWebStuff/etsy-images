import { describe, expect, it } from 'vitest';
import { getListingTodoItems, isListingComplete, type ListingCompletionState } from '@/lib/listing-completeness';

const completeState: ListingCompletionState = {
  hasListingDescription: true,
  hasThumbnail: true,
  hasTenImages: true,
  hasCurrentZips: true,
  hasCurrentDropbox: true,
  hasEtsyProducts: true,
  hasTags: true,
  hasTitle: true,
  hasEtsyDescription: true,
  hasQuantity: true,
  hasPrimaryColour: true,
};

describe('listing completeness', () => {
  it('requires the listing description', () => {
    const state = { ...completeState, hasListingDescription: false };
    expect(isListingComplete(state)).toBe(false);
    expect(getListingTodoItems(state)).toEqual([{ label: 'Add the listing description', tab: 'thumbnail' }]);
  });

  it('reports every incomplete requirement and accepts a complete listing', () => {
    expect(getListingTodoItems({ ...completeState, hasThumbnail: false, hasTags: false })).toEqual([
      { label: 'Upload the thumbnail', tab: 'thumbnail' },
      { label: 'Add at least one tag', tab: 'tags' },
    ]);
    expect(isListingComplete(completeState)).toBe(true);
  });
});
