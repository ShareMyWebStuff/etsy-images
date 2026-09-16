export type ListingCompletionTab = 'thumbnail' | 'etsy-products' | 'images' | 'details' | 'tags' | 'downloads' | 'dropbox';

export type ListingCompletionState = {
  hasListingDescription: boolean;
  hasThumbnail: boolean;
  hasTenImages: boolean;
  hasCurrentZips: boolean;
  hasCurrentDropbox: boolean;
  hasEtsyProducts: boolean;
  hasTags: boolean;
  hasTitle: boolean;
  hasEtsyDescription: boolean;
  hasQuantity: boolean;
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
    state.hasTenImages ? null : { label: 'Upload all 10 Etsy images', tab: 'images' as const },
    state.hasCurrentZips ? null : { label: 'Create the current ZIP files', tab: 'downloads' as const },
    state.hasCurrentDropbox ? null : { label: 'Create or update Dropbox', tab: 'dropbox' as const },
    state.hasEtsyProducts ? null : { label: 'Configure the Etsy products', tab: 'etsy-products' as const },
    state.hasTags ? null : { label: 'Add at least one tag', tab: 'tags' as const },
    state.hasTitle ? null : { label: 'Add the Etsy title', tab: 'details' as const },
    state.hasEtsyDescription ? null : { label: 'Add the Etsy description', tab: 'details' as const },
    state.hasQuantity ? null : { label: 'Set a quantity greater than zero', tab: 'details' as const },
    state.hasPrimaryColour ? null : { label: 'Select a primary colour', tab: 'details' as const },
  ].filter((item): item is ListingTodoItem => item !== null);
}

export function isListingComplete(state: ListingCompletionState) {
  return getListingTodoItems(state).length === 0;
}
