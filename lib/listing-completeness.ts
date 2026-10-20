export type ListingCompletionTab = 'overview' | 'images' | 'details' | 'tags' | 'downloads' | 'dropbox';

export type ListingCompletionState = {
  hasListingDescription: boolean;
  hasThumbnail: boolean;
  hasThumbnailSizes: boolean;
  requiresTextAreas?: boolean;
  hasTextAreas?: boolean;
  hasRequiredImages: boolean;
  hasRequiredDigitalDownloads: boolean;
  hasCurrentZips: boolean;
  hasCurrentDropbox: boolean;
  hasDownloadSection: boolean;
  hasTags: boolean;
  hasTitle: boolean;
  hasEtsyDescription: boolean;
  hasQuantity: boolean;
  hasDigitalTitle: boolean;
  hasDigitalDescription: boolean;
  hasDigitalQuantity: boolean;
  hasPrimaryColour: boolean;
  isMultiple?: boolean;
  hasTemplate?: boolean;
  hasGroupSelection?: boolean;
  hasDownloadInstructions?: boolean;
  hasEtsySku?: boolean;
  hasSecondaryColour?: boolean;
};

export type ListingTodoItem = {
  label: string;
  tab: ListingCompletionTab;
};

export function getListingTodoItems(state: ListingCompletionState): ListingTodoItem[] {
  const items: Array<ListingTodoItem | null> = [
    state.hasTemplate === false ? { label: 'Choose a template', tab: 'overview' as const } : null,
    state.hasListingDescription ? null : { label: 'Add the listing description', tab: 'overview' as const },
    state.isMultiple
      ? state.hasGroupSelection ? null : { label: 'Select and order all grouped listings', tab: 'overview' as const }
      : state.hasThumbnail ? null : { label: 'Upload the thumbnail', tab: 'overview' as const },
    !state.isMultiple && !state.hasThumbnailSizes
      ? { label: 'Set the thumbnail sizes', tab: 'overview' as const }
      : null,
    !state.isMultiple && state.requiresTextAreas && !state.hasTextAreas
      ? { label: 'Set the personalisation text areas', tab: 'overview' as const }
      : null,
    state.hasRequiredImages ? null : { label: 'Generate every template image', tab: 'overview' as const },
    state.isMultiple
      ? state.hasDownloadInstructions ? null : { label: 'Create the grouped download instructions PDF', tab: 'downloads' as const }
      : state.hasRequiredDigitalDownloads ? null : { label: 'Create all printable downloads and the How to Print guide', tab: 'downloads' as const },
    !state.isMultiple && !state.hasCurrentDropbox ? { label: 'Create or update Dropbox', tab: 'dropbox' as const } : null,
    state.hasDownloadSection ? null : { label: 'Select a download section on the template', tab: 'overview' as const },
    state.hasTags ? null : { label: 'Add at least one tag', tab: 'tags' as const },
    state.hasTitle ? null : { label: 'Add the Print Etsy title', tab: 'details' as const },
    state.hasEtsyDescription ? null : { label: 'Add the Print Etsy description', tab: 'details' as const },
    state.hasQuantity ? null : { label: 'Set a Print quantity greater than zero', tab: 'details' as const },
    state.hasDigitalTitle ? null : { label: 'Add the Digital Download Etsy title', tab: 'details' as const },
    state.hasDigitalDescription ? null : { label: 'Add the Digital Download Etsy description', tab: 'details' as const },
    state.hasDigitalQuantity ? null : { label: 'Set a Digital Download quantity greater than zero', tab: 'details' as const },
    state.hasPrimaryColour ? null : { label: 'Select a primary colour', tab: 'details' as const },
    state.hasEtsySku === false ? { label: 'Create the Etsy SKU', tab: 'details' as const } : null,
    state.hasSecondaryColour === false ? { label: 'Select a secondary colour', tab: 'details' as const } : null,
  ];
  return items.filter((item): item is ListingTodoItem => item !== null);
}

export function isListingComplete(state: ListingCompletionState) {
  return getListingTodoItems(state).length === 0;
}
