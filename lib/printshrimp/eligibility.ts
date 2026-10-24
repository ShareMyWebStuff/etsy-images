export function isPrintShrimpPhysicalListing(listing: { syncVariants: readonly string[] }) {
  return listing.syncVariants.includes('print') || listing.syncVariants.includes('customised');
}
