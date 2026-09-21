import { inspectListingZipStorage, isDropboxInstructionPdfFile } from '@/lib/dropbox-bundle';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { hasRequiredListingImages } from '@/lib/listing-image-limits';
import { isListingComplete } from '@/lib/listing-completeness';
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
      etsyDownloadId: true,
      etsyDownloadState: true,
      title: true,
      localDirectoryName: true,
      state: true,
      description: true,
      digitalTitle: true,
      digitalDescription: true,
      digitalQuantity: true,
      listingDescription: true,
      primaryColour: true,
      secondaryColour: true,
      priceAmount: true,
      priceDivisor: true,
      priceCurrencyCode: true,
      quantity: true,
      thumbnailFileName: true,
      tags: { select: { id: true } },
      images: {
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: { rank: true, localFileName: true },
      },
      files: { select: { rawJson: true } },
      zippedFiles: { select: { fileName: true, sizeBytes: true } },
      productConfig: { select: { id: true, downloadSectionId: true } },
      products: { select: { id: true } },
      dropboxBundle: { select: { id: true, sharedUrl: true } },
      dropboxFiles: {
        select: {
          groupNumber: true,
          sourceListingId: true,
          sourceDirectoryName: true,
          localFileName: true,
        },
      },
      numberOfItems: true,
      includeAllItems: true,
      downloadsRevision: true,
      zippedRevision: true,
      hasEverZipped: true,
      dropboxRevision: true,
      dropboxSyncedAt: true,
      sourceSection: { select: { title: true } },
    },
  });

  const shopName = shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`;
  return {
    shop: {
      id: shop.etsyShopId.toString(),
      shopName,
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
    listings: await Promise.all(listings.map(async (listing) => {
      const hasDetailsTitle = listing.title.trim().length > 0;
      const hasRequiredImages = hasRequiredListingImages(listing.images);
      const hasThumbnail = (listing.thumbnailFileName?.trim().length ?? 0) > 0;
      const listingPath = getListingDirectoryPath(
        shopName,
        section.title,
        subSection.name,
        listing.localDirectoryName ?? `Listing-${listing.id}`,
      );
      const zipStorageStatus = await inspectListingZipStorage(listing, listingPath);
      const hasCurrentZips = zipStorageStatus.valid;
      const hasCurrentDropbox = Boolean(listing.dropboxBundle?.sharedUrl?.trim())
        && listing.dropboxSyncedAt !== null
        && listing.dropboxRevision === listing.downloadsRevision
        && (listing.dropboxFiles.length === 0 || listing.files.some(isDropboxInstructionPdfFile));
      const hasEtsyProducts = listing.productConfig !== null && listing.products.length > 0;
      const isComplete = isListingComplete({
        hasListingDescription: (listing.listingDescription?.trim().length ?? 0) > 0,
        hasThumbnail,
        hasRequiredImages,
        hasCurrentZips,
        hasCurrentDropbox,
        hasEtsyProducts,
        hasDownloadSection: listing.productConfig?.downloadSectionId != null,
        hasTags: listing.tags.length > 0,
        hasTitle: hasDetailsTitle,
        hasEtsyDescription: (listing.description?.trim().length ?? 0) > 0,
        hasQuantity: (listing.quantity ?? 0) > 0,
        hasDigitalTitle: (listing.digitalTitle?.trim().length ?? 0) > 0,
        hasDigitalDescription: (listing.digitalDescription?.trim().length ?? 0) > 0,
        hasDigitalQuantity: (listing.digitalQuantity ?? 0) > 0,
        hasPrimaryColour: (listing.primaryColour?.trim().length ?? 0) > 0,
      });
      const isPublished = listing.state === 'active' || listing.state === 'published'
        || listing.etsyDownloadState === 'active' || listing.etsyDownloadState === 'published';

      return {
        id: String(listing.id),
        listingName: listing.localDirectoryName ?? listing.title,
        sourceSectionName: listing.sourceSection?.title ?? null,
        status: !hasThumbnail
          ? 'incomplete'
          : isPublished
            ? (listing.state === 'active' || listing.state === 'published' ? listing.state : listing.etsyDownloadState!)
            : isComplete ? 'complete' : 'incomplete',
        isComplete,
        price: formatPrice(listing.priceAmount, listing.priceDivisor, listing.priceCurrencyCode),
        hasPrice: listing.priceAmount !== null && listing.priceDivisor !== null && listing.priceDivisor > 0,
        quantity: listing.quantity,
        hasEtsyListingId: listing.etsyId !== null || listing.etsyDownloadId !== null,
      };
    })),
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
