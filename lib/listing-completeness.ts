import { LISTING_COMPLETE_MIN_IMAGES } from '@/lib/listing-image-limits';

export type ListingCompletionTab = 'thumbnail' | 'etsy-products' | 'images' | 'details' | 'tags' | 'downloads' | 'dropbox';

export type ListingCompletionState = {
  hasListingDescription: boolean;
  hasThumbnail: boolean;
  hasRequiredImages: boolean;
  hasCurrentZips: boolean;
  hasCurrentDropbox: boolean;
  hasEtsyProducts: boolean;
  hasDownloadSection: boolean;
  hasTags: boolean;
  hasTitle: boolean;
  hasEtsyDescription: boolean;
  hasQuantity: boolean;
  hasDigitalTitle: boolean;
  hasDigitalDescription: boolean;
  hasDigitalQuantity: boolean;
  hasPrimaryColour: boolean;
};

export type ListingTodoItem = {
  label: string;
  tab: ListingCompletionTab;
};

export function getListingTodoItems(state: ListingCompletionState): ListingTodoItem[] {
  return [
    state.hasListingDescription ? null : { label: 'Add the listing description', tab: 'thumbnail' as const },
    state.hasThumbnail ? null : { label: 'Upload the thumbnail', tab: 'thumbnail' as const },
    state.hasRequiredImages ? null : { label: `Upload at least ${LISTING_COMPLETE_MIN_IMAGES} listing images`, tab: 'images' as const },
    state.hasCurrentZips ? null : { label: 'Create the current ZIP files', tab: 'downloads' as const },
    state.hasCurrentDropbox ? null : { label: 'Create or update Dropbox', tab: 'dropbox' as const },
    state.hasEtsyProducts ? null : { label: 'Configure the Etsy products', tab: 'etsy-products' as const },
    state.hasDownloadSection ? null : { label: 'Select a download section', tab: 'etsy-products' as const },
    state.hasTags ? null : { label: 'Add at least one tag', tab: 'tags' as const },
    state.hasTitle ? null : { label: 'Add the Print Etsy title', tab: 'details' as const },
    state.hasEtsyDescription ? null : { label: 'Add the Print Etsy description', tab: 'details' as const },
    state.hasQuantity ? null : { label: 'Set a Print quantity greater than zero', tab: 'details' as const },
    state.hasDigitalTitle ? null : { label: 'Add the Digital Download Etsy title', tab: 'details' as const },
    state.hasDigitalDescription ? null : { label: 'Add the Digital Download Etsy description', tab: 'details' as const },
    state.hasDigitalQuantity ? null : { label: 'Set a Digital Download quantity greater than zero', tab: 'details' as const },
    state.hasPrimaryColour ? null : { label: 'Select a primary colour', tab: 'details' as const },
  ].filter((item): item is ListingTodoItem => item !== null);
}

export function isListingComplete(state: ListingCompletionState) {
  return getListingTodoItems(state).length === 0;
}
