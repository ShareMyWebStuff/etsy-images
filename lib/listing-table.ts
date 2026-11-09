import { inspectListingZipStorage, isDropboxInstructionPdfFile } from '@/lib/dropbox-bundle';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { hasRequiredPrintableDownloads } from '@/lib/printable-download-specs';
import { isListingComplete } from '@/lib/listing-completeness';
import { normalizeListingArtworkOrientation, parseCurrentListingPrintCropSettings, type ListingArtworkOrientation } from '@/lib/listing-print-crops';
import { resolveListingCategory, type ListingTemplateProducts } from '@/lib/listing-category';
import { prisma } from '@/lib/prisma';
import { hasRequiredTemplateDownloadSection } from '@/lib/template-download-section';
import { effectiveListingTemplateSettings } from '@/lib/listing-template-settings';

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
  templates: Array<{
    id: number;
    name: string;
    templateType: 'single' | 'multiple';
    itemCount: number;
  }>;
  listings: Array<{
    id: string;
    listingName: string;
    artworkOrientation: ListingArtworkOrientation | null;
    numberOfItems?: number | null;
    ourCategoryId?: number | null;
    sourceSectionName: string | null;
    templateProducts: ListingTemplateProducts | null;
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
  const [listings, templates] = await Promise.all([prisma.etsyListing.findMany({
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
      artworkOrientation: true,
      thumbnailUpdatedAt: true,
      printCropSettings: true,
      tags: { select: { id: true } },
      images: {
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: { rank: true, localFileName: true, ourCategoryImageTemplateId: true },
      },
      files: { select: { originalFileName: true, localFileName: true, filename: true, widthPixels: true, heightPixels: true, rawJson: true } },
      zippedFiles: { select: { fileName: true, sizeBytes: true } },
      productConfig: { select: { id: true, sku: true, printsFramesOverride: true, digitalDownloadOverride: true, customisePrints: true, customTop: true, customBottom: true } },
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
      ourCategoryId: true,
      includeAllItems: true,
      downloadsRevision: true,
      zippedRevision: true,
      hasEverZipped: true,
      dropboxRevision: true,
      dropboxSyncedAt: true,
      sourceSection: { select: { title: true } },
      ourCategory: {
        select: {
          templateType: true,
          itemCount: true,
          printsFrames: true,
          customisePrints: true,
          customTop: true,
          customBottom: true,
          digitalDownload: true,
          printFrameSection: { select: { title: true } },
          customisedSection: { select: { title: true } },
          downloadSection: { select: { title: true, etsyShopSectionId: true } },
          imageTemplates: { select: { id: true } },
        },
      },
      groupItems: { select: { id: true } },
    },
  }), prisma.ourCategory.findMany({
    where: { shopId: shop.id },
    select: { id: true, name: true, templateType: true, itemCount: true },
    orderBy: [{ templateType: 'asc' }, { itemCount: 'asc' }, { name: 'asc' }],
  })]);

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
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      templateType: template.templateType === 'multiple' ? 'multiple' : 'single',
      itemCount: template.templateType === 'multiple' ? template.itemCount : 1,
    })),
    listings: (await Promise.all(listings.map(async (listing) => {
      const effectiveTemplate = listing.ourCategory ? {
        ...listing.ourCategory,
        ...effectiveListingTemplateSettings(listing.ourCategory, listing.productConfig),
      } : null;
      const hasDetailsTitle = listing.title.trim().length > 0;
      const isMultiple = listing.ourCategory?.templateType === 'multiple';
      const generatedTemplateIds = new Set(listing.images.flatMap((image) => (
        image.ourCategoryImageTemplateId === null ? [] : [image.ourCategoryImageTemplateId]
      )));
      const hasRequiredImages = (listing.ourCategory?.imageTemplates.length ?? 0) > 0
        && listing.ourCategory!.imageTemplates.every((template) => generatedTemplateIds.has(template.id));
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
      const isComplete = isListingComplete({
        isMultiple,
        hasTemplate: listing.ourCategory !== null,
        hasGroupSelection: !isMultiple || listing.groupItems.length === listing.ourCategory?.itemCount,
        hasDownloadInstructions: listing.files.some(isDropboxInstructionPdfFile),
        hasListingDescription: isMultiple || (listing.listingDescription?.trim().length ?? 0) > 0,
        hasThumbnail,
        hasThumbnailSizes: isMultiple || parseCurrentListingPrintCropSettings(listing.printCropSettings, {
          fileName: listing.thumbnailFileName,
          updatedAt: listing.thumbnailUpdatedAt?.toISOString() ?? null,
        }) !== null,
        hasRequiredImages,
        hasRequiredDigitalDownloads: !isMultiple && hasRequiredPrintableDownloads(listing.files),
        hasCurrentZips,
        hasCurrentDropbox,
        hasDownloadSection: hasRequiredTemplateDownloadSection(effectiveTemplate),
        hasTags: listing.tags.length > 0,
        hasTitle: hasDetailsTitle,
        hasEtsyDescription: (listing.description?.trim().length ?? 0) > 0,
        hasQuantity: (listing.quantity ?? 0) > 0,
        hasDigitalTitle: (listing.digitalTitle?.trim().length ?? 0) > 0,
        hasDigitalDescription: (listing.digitalDescription?.trim().length ?? 0) > 0,
        hasDigitalQuantity: (listing.digitalQuantity ?? 0) > 0,
        hasPrimaryColour: (listing.primaryColour?.trim().length ?? 0) > 0,
        hasSecondaryColour: (listing.secondaryColour?.trim().length ?? 0) > 0,
        hasEtsySku: (listing.productConfig?.sku?.trim().length ?? 0) > 0,
      });
      const isPublished = listing.state === 'active' || listing.state === 'published'
        || listing.etsyDownloadState === 'active' || listing.etsyDownloadState === 'published';
      const category = resolveListingCategory(effectiveTemplate, listing.sourceSection?.title ?? null);

      return {
        id: String(listing.id),
        listingName: listing.localDirectoryName ?? listing.title,
        artworkOrientation: hasThumbnail ? normalizeListingArtworkOrientation(listing.artworkOrientation) : null,
        numberOfItems: listing.numberOfItems,
        ourCategoryId: listing.ourCategoryId,
        sourceSectionName: category.name,
        templateProducts: category.templateProducts,
        status: !isMultiple && !hasThumbnail
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
    }))).sort((first, second) => {
      const firstCategory = first.sourceSectionName ?? 'Uncategorised';
      const secondCategory = second.sourceSectionName ?? 'Uncategorised';
      return firstCategory.localeCompare(secondCategory) || first.listingName.localeCompare(second.listingName);
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
