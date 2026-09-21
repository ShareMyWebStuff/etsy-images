export type EtsyListingDetailValues = {
  title: string;
  description: string | null;
  quantity: number | null;
  digitalTitle: string | null;
  digitalDescription: string | null;
  digitalQuantity: number | null;
};

export function getEtsyListingDetails(
  listingType: 'physical' | 'both' | 'download',
  listing: EtsyListingDetailValues,
) {
  return listingType === 'download'
    ? { title: listing.digitalTitle, description: listing.digitalDescription, quantity: listing.digitalQuantity, label: 'Digital Download' }
    : { title: listing.title, description: listing.description, quantity: listing.quantity, label: 'Print' };
}
