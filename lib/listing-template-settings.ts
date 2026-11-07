import { effectiveListingCustomisation, type ListingCustomisationSettings } from '@/lib/listing-customisation';

export type ListingTemplateSettings = {
  printsFrames: boolean;
  customisePrints: boolean;
  digitalDownload: boolean;
};

export type ListingTemplateOverrides = {
  printsFramesOverride?: boolean | null;
  digitalDownloadOverride?: boolean | null;
} & Partial<ListingCustomisationSettings>;

/** Listing overrides may narrow the product types allowed by the template. */
export function effectiveListingTemplateSettings(
  template: (ListingTemplateSettings & Partial<ListingCustomisationSettings>) | null | undefined,
  listing: ListingTemplateOverrides | null | undefined,
) {
  return {
    printsFrames: Boolean(template?.printsFrames) && (listing?.printsFramesOverride ?? true),
    digitalDownload: Boolean(template?.digitalDownload) && (listing?.digitalDownloadOverride ?? true),
    ...effectiveListingCustomisation(template, listing),
  };
}
