import { prisma } from '@/lib/prisma';

export type SubSectionListingsPageData = {
  shop: {
    id: string;
    shopName: string;
  };
  section: {
    id: string;
    sectionName: string;
  };
  subSection: {
    id: string;
    name: string;
    numberOfDownloads: number | null;
    includeAllDownloads: boolean;
  };
  listings: Array<{
    id: string;
    listingName: string;
    sourceSectionName: string | null;
    status: string;
    isComplete: boolean;
    price: string;
    hasPrice: boolean;
    quantity: number | null;
    hasEtsyListingId: boolean;
  }>;
};

function formatPrice(amount: number | null, divisor: number | null, currencyCode: string | null) {
  if (amount === null || divisor === null || divisor === 0) {
    return 'No price';
  }

  const value = amount / divisor;

  return currencyCode ? `${currencyCode} ${value.toFixed(2)}` : value.toFixed(2);
}

export async function getSubSectionListingsPageData(
  shopId: string,
  sectionId: string,
  subSectionId: string
): Promise<SubSectionListingsPageData | null> {
  let etsyShopId: bigint;
  const numericSectionId = Number(sectionId);
  const numericSubSectionId = Number(subSectionId);

  try {
    etsyShopId = BigInt(shopId);
  } catch {
    return null;
  }

  if (!Number.isInteger(numericSectionId) || !Number.isInteger(numericSubSectionId)) {
    return null;
  }

  const shop = await prisma.etsyShop.findUnique({
    where: {
      etsyShopId,
    },
    select: {
      id: true,
      etsyShopId: true,
      shopName: true,
      title: true,
    },
  });

  if (!shop) {
    return null;
  }

  const section = await prisma.etsyShopSection.findFirst({
    where: {
      id: numericSectionId,
      OR: [
        {
          shopId: shop.id,
        },
        {
          etsyShopId: shop.etsyShopId,
        },
      ],
    },
    select: {
      id: true,
      title: true,
      etsyShopSectionId: true,
    },
  });

  if (!section) {
    return null;
  }

  const subSection = await prisma.etsyShopSubSection.findFirst({
    where: {
      id: numericSubSectionId,
      shopSectionId: section.id,
    },
    select: {
      id: true,
      name: true,
      numberOfDownloads: true,
      includeAllDownloads: true,
    },
  });

  if (!subSection) {
    return null;
  }

  const sectionEtsyId = section.etsyShopSectionId === null ? null : Number(section.etsyShopSectionId);
  const listings = await prisma.etsyListing.findMany({
    where: {
      shopId: shop.etsyShopId.toString(),
      OR: [
        { subSectionId: subSection.id },
        ...(sectionEtsyId === null ? [] : [{ subSectionId: null, shopSectionId: sectionEtsyId }]),
      ],
    },
    orderBy: [{ sourceSection: { title: 'asc' } }, { title: 'asc' }],
    select: {
      id: true,
      etsyId: true,
      title: true,
      localDirectoryName: true,
      state: true,
      description: true,
      primaryColour: true,
      priceAmount: true,
      priceDivisor: true,
      priceCurrencyCode: true,
      quantity: true,
      thumbnailFileName: true,
      tags: { select: { id: true } },
      images: { select: { localFileName: true } },
      zippedFiles: { select: { id: true } },
      sourceSection: { select: { title: true } },
    },
  });

  return {
    shop: {
      id: shop.etsyShopId.toString(),
      shopName: shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`,
    },
    section: {
      id: String(section.id),
      sectionName: section.title,
    },
    subSection: {
      id: String(subSection.id),
      name: subSection.name,
      numberOfDownloads: subSection.numberOfDownloads,
      includeAllDownloads: subSection.includeAllDownloads,
    },
    listings: listings.map((listing) => {
      const hasDetailsTitle = listing.title.trim().length > 0
        && listing.title.trim() !== listing.localDirectoryName?.trim();
      const uploadedImageCount = listing.images.filter((image) => (image.localFileName?.trim().length ?? 0) > 0).length;
      const hasThumbnail = (listing.thumbnailFileName?.trim().length ?? 0) > 0;
      const isComplete = hasThumbnail
        && uploadedImageCount === 10
        && listing.zippedFiles.length > 0
        && listing.tags.length > 0
        && hasDetailsTitle
        && (listing.description?.trim().length ?? 0) > 0
        && (listing.primaryColour?.trim().length ?? 0) > 0;
      const isPublished = listing.state === 'active' || listing.state === 'published';

      return {
        id: String(listing.id),
        listingName: listing.localDirectoryName ?? listing.title,
        sourceSectionName: listing.sourceSection?.title ?? null,
        status: !hasThumbnail ? 'incomplete' : isPublished ? listing.state! : isComplete ? 'complete' : 'incomplete',
        isComplete,
        price: formatPrice(listing.priceAmount, listing.priceDivisor, listing.priceCurrencyCode),
        hasPrice: listing.priceAmount !== null && listing.priceDivisor !== null && listing.priceDivisor > 0,
        quantity: listing.quantity,
        hasEtsyListingId: listing.etsyId !== null,
      };
    }),
  };
}

export async function getSectionListingsPageData(shopId: string, sectionId: string) {
  const numericSectionId = Number(sectionId);
  if (!Number.isInteger(numericSectionId)) return null;
  const subSection = await prisma.etsyShopSubSection.findFirst({
    where: { shopSectionId: numericSectionId },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return subSection ? getSubSectionListingsPageData(shopId, sectionId, String(subSection.id)) : null;
}
