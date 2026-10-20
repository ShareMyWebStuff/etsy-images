import { describe, expect, it } from 'vitest';
import { getListingTodoItems, isListingComplete, type ListingCompletionState } from '@/lib/listing-completeness';

const completeState: ListingCompletionState = {
  hasListingDescription: true,
  hasThumbnail: true,
  hasThumbnailSizes: true,
  hasRequiredImages: true,
  hasRequiredDigitalDownloads: true,
  hasCurrentZips: true,
  hasCurrentDropbox: true,
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
    expect(getListingTodoItems(state)).toEqual([{ label: 'Add the listing description', tab: 'overview' }]);
  });

  it('reports when fewer than 15 listing images are uploaded', () => {
    const state = { ...completeState, hasRequiredImages: false };
    expect(isListingComplete(state)).toBe(false);
    expect(getListingTodoItems(state)).toEqual([{ label: 'Generate every template image', tab: 'overview' }]);
  });

  it('requires the thumbnail sizes to be set', () => {
    const state = { ...completeState, hasThumbnailSizes: false };
    expect(isListingComplete(state)).toBe(false);
    expect(getListingTodoItems(state)).toEqual([{ label: 'Set the thumbnail sizes', tab: 'overview' }]);
  });

  it('requires text areas only when listing customisation is enabled', () => {
    const state = { ...completeState, requiresTextAreas: true, hasTextAreas: false };
    expect(getListingTodoItems(state)).toContainEqual({ label: 'Set the personalisation text areas', tab: 'overview' });
    expect(isListingComplete({ ...completeState, requiresTextAreas: false, hasTextAreas: false })).toBe(true);
  });

  it('requires a download section', () => {
    const state = { ...completeState, hasDownloadSection: false };
    expect(isListingComplete(state)).toBe(false);
    expect(getListingTodoItems(state)).toEqual([{ label: 'Select a download section on the template', tab: 'overview' }]);
  });

  it('requires all six printable downloads and the How to Print guide', () => {
    const state = { ...completeState, hasRequiredDigitalDownloads: false };
    expect(isListingComplete(state)).toBe(false);
    expect(getListingTodoItems(state)).toEqual([
      { label: 'Create all printable downloads and the How to Print guide', tab: 'downloads' },
    ]);
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
      { label: 'Upload the thumbnail', tab: 'overview' },
      { label: 'Add at least one tag', tab: 'tags' },
    ]);
    expect(isListingComplete(completeState)).toBe(true);
  });
});
