import { prisma } from '@/lib/prisma';

export type ListingGalleryItem = {
  id: string;
  listingName: string;
  hasThumbnail: boolean;
  thumbnailUpdatedAt: string | null;
  subSectionId: string | null;
  canDelete: boolean;
  deleteDisabledReason: string | null;
};

export class ListingGalleryError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ListingGalleryError'; }
}

/** Lightweight section-wide metadata. Image bytes remain on the thumbnail endpoint. */
export async function getListingGallery(shopId: string, sectionId: string): Promise<{ sectionName: string; listings: ListingGalleryItem[] }> {
  if (typeof shopId !== 'string' || !/^\d+$/.test(shopId) || BigInt(shopId) < 1n || BigInt(shopId) > 9_223_372_036_854_775_807n
    || typeof sectionId !== 'string' || !/^\d+$/.test(sectionId) || !Number.isSafeInteger(Number(sectionId))
    || Number(sectionId) < 1 || Number(sectionId) > 2_147_483_647) {
    throw new ListingGalleryError('Missing or invalid shop and section context.', 400);
  }
  const shop = await prisma.etsyShop.findUnique({ where: { etsyShopId: BigInt(shopId) }, select: { id: true, etsyShopId: true } });
  if (!shop) throw new ListingGalleryError('Shop not found.', 404);
  const section = await prisma.etsyShopSection.findFirst({
    where: { id: Number(sectionId), OR: [{ shopId: shop.id }, { etsyShopId: shop.etsyShopId }] },
    select: { id: true, title: true, etsyShopSectionId: true },
  });
  if (!section) throw new ListingGalleryError('Section not found for this shop.', 404);
  const sectionEtsyId = section.etsyShopSectionId === null ? null : Number(section.etsyShopSectionId);
  const [subSections, listings] = await Promise.all([
    prisma.etsyShopSubSection.findMany({ where: { shopSectionId: section.id }, select: { id: true }, orderBy: { id: 'asc' } }),
    prisma.etsyListing.findMany({
      where: { shopId: shop.etsyShopId.toString(), OR: [
        { subSection: { is: { shopSectionId: section.id } } },
        ...(sectionEtsyId === null ? [] : [{ subSectionId: null, shopSectionId: sectionEtsyId }]),
      ] },
      select: { id: true, title: true, localDirectoryName: true, thumbnailFileName: true, thumbnailUpdatedAt: true, subSectionId: true,
        state: true, etsyId: true, etsyCustomisedId: true, etsyCustomisedState: true, etsyDownloadId: true, etsyDownloadState: true },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const fallbackSubSection = subSections[0]?.id ?? null;
  return { sectionName: section.title, listings: listings.map((listing) => {
    const existsOnEtsy = listing.etsyId !== null || listing.etsyCustomisedId !== null || listing.etsyDownloadId !== null;
    const isPublished = [listing.state, listing.etsyCustomisedState, listing.etsyDownloadState]
      .some((state) => state === 'active' || state === 'published');
    const deleteDisabledReason = existsOnEtsy ? 'Listings on Etsy cannot be deleted here.'
      : isPublished ? 'Published listings cannot be deleted here.'
      // The fallback subsection is valid for previews; DELETE requires an assigned subsection.
      : listing.subSectionId === null ? 'This listing has no assigned subsection and cannot be deleted here.'
      : null;
    return {
      id: String(listing.id), listingName: listing.localDirectoryName ?? listing.title,
      hasThumbnail: Boolean(listing.thumbnailFileName?.trim()), thumbnailUpdatedAt: listing.thumbnailUpdatedAt?.toISOString() ?? null,
      subSectionId: listing.subSectionId !== null ? String(listing.subSectionId) : fallbackSubSection === null ? null : String(fallbackSubSection),
      canDelete: deleteDisabledReason === null, deleteDisabledReason,
    };
  }) };
}
