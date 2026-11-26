import { prisma } from '@/lib/prisma';
import { effectiveListingTemplateSettings } from '@/lib/listing-template-settings';
import type { ListingEditorContext } from '@/lib/listing-editor';

export class ListingDigitalDownloadDeliveryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'ListingDigitalDownloadDeliveryError';
  }
}

/** Check current persisted sales settings before a listing editor creates remote delivery assets. */
export async function assertListingDigitalDownloadDelivery(context: ListingEditorContext) {
  if (!/^\d+$/.test(context.shopId) || BigInt(context.shopId) < 1n
    || [context.sectionId, context.subSectionId, context.listingId].some(value => !/^\d+$/.test(value)
      || !Number.isSafeInteger(Number(value)) || Number(value) < 1)) {
    throw new ListingDigitalDownloadDeliveryError('Invalid listing context.');
  }
  const listing = await prisma.etsyListing.findFirst({
    where: {
      id: Number(context.listingId), shopId: BigInt(context.shopId).toString(), subSectionId: Number(context.subSectionId),
      subSection: { is: { shopSectionId: Number(context.sectionId) } },
    },
    select: {
      ourCategory: { select: { printsFrames: true, customisePrints: true, digitalDownload: true } },
      productConfig: { select: { digitalDownloadOverride: true } },
    },
  });
  if (!listing) throw new ListingDigitalDownloadDeliveryError('Listing not found in this shop and section.', 404);
  if (!effectiveListingTemplateSettings(listing.ourCategory, listing.productConfig).digitalDownload) {
    throw new ListingDigitalDownloadDeliveryError('Dropbox and download instructions are only available for listings sold as digital downloads.');
  }
}
