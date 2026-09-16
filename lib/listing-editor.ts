import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { ZipArchive } from 'archiver';
import { imageSize } from 'image-size';
import sharp from 'sharp';
import { inspectListingZipStorage, isDropboxInstructionPdfFile } from '@/lib/dropbox-bundle';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { getListingTodoItems, type ListingTodoItem } from '@/lib/listing-completeness';
import { ETSY_PRIMARY_COLOURS } from '@/lib/etsy-colours';
import { ETSY_PRODUCT_FRAMES, ETSY_PRODUCT_SIZES, saveListingSku } from '@/lib/listing-products';
import { prisma } from '@/lib/prisma';
import { getNextPrintSize } from '@/lib/print-sizes';
import { ETSY_MAX_DOWNLOAD_FILES, ETSY_MAX_FILE_SIZE_BYTES } from '@/lib/etsy-download-limits';
import { ETSY_MAX_LISTING_IMAGES, LISTING_EDITOR_MAX_IMAGES } from '@/lib/listing-image-limits';
import { DEFAULT_PERSONALISATION_FONT_ID, getPersonalisationFont } from '@/lib/personalisation-fonts';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from '@/lib/s3-listing-storage';
import { PRICE_OPTIONS } from '@/lib/set-prices-core';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);

export type ListingEditorContext = {
  shopId: string;
  sectionId: string;
  subSectionId: string;
  listingId: string;
};

type PendingListingChange = 'Thumbnail' | 'Etsy Products' | 'Images' | 'Details' | 'Tags' | 'Digital Downloads' | 'Dropbox';

export type ListingEditorData = {
  context: ListingEditorContext;
  shop: {
    id: string;
    shopName: string;
  };
  section: {
    id: string;
    sectionName: string;
    roomTheme: string;
  };
  subSection: {
    id: string;
    name: string;
    numberOfDownloads: number | null;
    includeAllDownloads: boolean;
  };
  listing: {
    id: string;
    etsyId: string | null;
    title: string;
    localDirectoryName: string | null;
    description: string;
    listingDescription: string;
    listingItem: string;
    listingItemInherited: boolean;
    roomTheme: string;
    roomThemeInherited: boolean;
    personalisationHeaderText: string;
    personalisationFooterText: string;
    personalisationFontId: string;
    status: string;
    quantity: number | null;
    priceAmount: number | null;
    priceDivisor: number | null;
    priceCurrencyCode: string;
    taxonomyId: number | null;
    shopSectionId: number | null;
    whoMade: string;
    whenMade: string;
    isSupply: boolean;
    shouldAutoRenew: boolean;
    isPersonalizable: boolean;
    language: string;
    primaryColour: string;
    secondaryColour: string;
    listingType: string;
    etsySku: string;
    numberOfItems: number | null;
    includeAllItems: boolean;
  };
  thumbnail: { fileName: string; originalFileName: string | null } | null;
  pendingChanges: PendingListingChange[];
  readyToUpload: boolean;
  missingUploadFields: string[];
  todoItems: ListingTodoItem[];
  tags: Array<{ id: string; value: string }>;
  materials: Array<{ id: string; value: string }>;
  styles: Array<{ id: string; value: string }>;
  images: Array<{ id: string; fileName: string; originalFileName: string | null; rank: number | null }>;
  files: Array<{
    id: string;
    fileName: string;
    originalFileName: string | null;
    rank: number | null;
    sizeBytes: number | null;
    widthPixels: number | null;
    heightPixels: number | null;
    jpegQuality: number;
    zipNumber: number | null;
  }>;
  zippedFiles: Array<{ id: string; zipNumber: number; fileName: string; sizeBytes: number }>;
  videos: Array<{ id: string; fileName: string; originalFileName: string | null; rank: number | null }>;
  translations: Array<{ id: string; language: string; title: string; description: string }>;
  inventory: Array<{ id: string; name: string; value: string; sku: string; price: number | null; quantity: number | null }>;
  personalization: Array<{ id: string; instructions: string; isRequired: boolean; charCountMax: number | null }>;
  buyerPrices: Array<{ id: string; amount: number; divisor: number; currencyCode: string; note: string }>;
  etsyProducts: {
    config: {
      listOnEtsy: boolean;
      digitalDownload: boolean;
      customTop: boolean;
      customBottom: boolean;
      returnPolicyId: string | null;
    };
    sizes: Array<{ key: string; label: string; enabled: boolean }>;
    frames: Array<{ key: string; label: string; enabled: boolean }>;
    products: Array<{
      id: string;
      key: string;
      type: string;
      sizeKey: string | null;
      sizeLabel: string | null;
      frame: string | null;
      sku: string;
      priceKey: string;
      priceAmountPence: number;
      currencyCode: string;
      etsyListingId: string | null;
      etsyProductId: string | null;
      etsyOfferingId: string | null;
    }>;
    prices: Array<{
      key: string;
      label: string;
      category: string;
      amountPence: number;
      currencyCode: string;
    }>;
  };
  dropbox: {
    bundle: { folderPath: string; sharedUrl: string | null; updatedAt: string } | null;
    current: boolean;
    canCreateZips: boolean;
    zipsCurrent: boolean;
    message: string | null;
    action: 'create' | 'update' | null;
  };
};

export type SaveListingDetailsInput = ListingEditorContext & {
  title?: string;
  description?: string;
  listingDescription?: string;
  status?: string;
  quantity?: number | null;
  priceAmount?: number | null;
  priceDivisor?: number | null;
  priceCurrencyCode?: string;
  taxonomyId?: number | null;
  shopSectionId?: number | null;
  whoMade?: string;
  whenMade?: string;
  isSupply?: boolean;
  shouldAutoRenew?: boolean;
  isPersonalizable?: boolean;
  language?: string;
  primaryColour?: string;
  secondaryColour?: string;
  etsySku?: string;
};

export type CollectionKind =
  | 'tag'
  | 'material'
  | 'style'
  | 'translation'
  | 'inventory'
  | 'personalization'
  | 'buyerPrice';

export type UploadKind = 'thumbnail' | 'image' | 'file' | 'video';

type ImageOrderItem = { id: string };

function normalize(value: string | null | undefined) {
  return value?.trim() ?? '';
}

function normalizeEtsyColour(value: string) {
  const normalized = normalize(value);
  if (!normalized) return null;
  if (!ETSY_PRIMARY_COLOURS.some((colour) => colour.value === normalized)) {
    throw new Error('Choose a valid Etsy colour.');
  }
  return normalized;
}

function toInt(value: string, label: string) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue)) {
    throw new Error(`Invalid ${label}.`);
  }

  return numericValue;
}

function toRawJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function cleanFileName(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, extension).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

  return `${baseName || 'file'}${extension}`;
}

function getMissingUploadFields(listing: {
  title: string;
  description: string | null;
  listingDescription: string | null;
  quantity: number | null;
  priceAmount: number | null;
  priceDivisor: number | null;
  taxonomyId: number | null;
  whoMade: string | null;
  whenMade: string | null;
  isSupply: boolean | null;
  thumbnailFileName: string | null;
}) {
  return [
    normalize(listing.title) ? null : 'Title',
    normalize(listing.description) ? null : 'Description',
    normalize(listing.listingDescription) ? null : 'Listing description',
    listing.quantity !== null && listing.quantity > 0 ? null : 'Quantity',
    listing.priceAmount !== null && listing.priceDivisor !== null && listing.priceDivisor > 0 ? null : 'Price',
    listing.taxonomyId !== null ? null : 'Taxonomy',
    normalize(listing.whoMade) ? null : 'Who made it',
    normalize(listing.whenMade) ? null : 'When made',
    listing.isSupply !== null ? null : 'Supply type',
    normalize(listing.thumbnailFileName) ? null : 'Thumbnail',
  ].filter((field): field is string => field !== null);
}

async function getListingForContext(context: ListingEditorContext) {
  const etsyShopId = BigInt(context.shopId);
  const sectionId = toInt(context.sectionId, 'section id');
  const subSectionId = toInt(context.subSectionId, 'sub section id');
  const listingId = toInt(context.listingId, 'listing id');

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
    throw new Error('Shop not found.');
  }

  const section = await prisma.etsyShopSection.findFirst({
    where: {
      id: sectionId,
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
      roomTheme: true,
    },
  });

  if (!section) {
    throw new Error('Section not found.');
  }

  const subSection = await prisma.etsyShopSubSection.findFirst({
    where: {
      id: subSectionId,
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
    throw new Error('Sub section not found.');
  }

  const listing = await prisma.etsyListing.findFirst({
    where: {
      id: listingId,
      subSectionId: subSection.id,
    },
    include: {
      tags: {
        orderBy: [{ position: 'asc' }, { tag: 'asc' }],
      },
      materials: {
        orderBy: [{ position: 'asc' }, { material: 'asc' }],
      },
      styles: {
        orderBy: [{ position: 'asc' }, { style: 'asc' }],
      },
      images: {
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      },
      files: {
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      },
      zippedFiles: {
        orderBy: [{ zipNumber: 'asc' }],
      },
      videos: {
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      },
      translations: {
        orderBy: [{ language: 'asc' }],
      },
      inventoryItems: {
        orderBy: [{ id: 'asc' }],
      },
      personalizations: {
        orderBy: [{ id: 'asc' }],
      },
      buyerPrices: {
        orderBy: [{ id: 'asc' }],
      },
      productConfig: true,
      sizeOptions: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      },
      frameOptions: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      },
      products: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      },
      dropboxFiles: {
        orderBy: [{ groupNumber: 'asc' }, { id: 'asc' }],
      },
      dropboxBundle: true,
    },
  });

  if (!listing) {
    throw new Error('Listing not found.');
  }

  const adminPrices = await prisma.adminProductPrice.findMany({
    select: {
      productKey: true,
      amountPence: true,
      currencyCode: true,
    },
  });

  return {
    shop,
    section,
    subSection,
    listing,
    adminPrices,
  };
}

async function mapEditorData(
  context: ListingEditorContext,
  data: Awaited<ReturnType<typeof getListingForContext>>,
): Promise<ListingEditorData> {
  const missingUploadFields = getMissingUploadFields(data.listing);
  const sizeOptions = new Map(data.listing.sizeOptions.map((option) => [option.sizeKey, option.enabled]));
  const frameOptions = new Map(data.listing.frameOptions.map((option) => [option.frameKey, option.enabled]));
  const savedPrices = new Map(data.adminPrices.map((price) => [price.productKey, price]));
  const prices = PRICE_OPTIONS.map((option) => {
    const saved = savedPrices.get(option.key);
    return {
      key: option.key,
      label: option.label,
      category: option.category,
      amountPence: saved?.amountPence ?? option.defaultAmountPence,
      currencyCode: saved?.currencyCode ?? 'GBP',
    };
  });
  const priceByKey = new Map<string, (typeof prices)[number]>(prices.map((price) => [price.key, price]));
  const sizeLabels = new Map<string, string>(ETSY_PRODUCT_SIZES.map((size) => [size.key, size.label]));
  const rawListing = data.listing.rawJson && typeof data.listing.rawJson === 'object' && !Array.isArray(data.listing.rawJson)
    ? data.listing.rawJson as Record<string, unknown>
    : null;
  const importedReturnPolicyId = typeof rawListing?.return_policy_id === 'string' || typeof rawListing?.return_policy_id === 'number'
    ? String(rawListing.return_policy_id)
    : null;
  const defaultListingSku = (data.listing.localDirectoryName ?? data.listing.title)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || `LISTING-${data.listing.id}`;
  const defaultListingItem = (data.listing.localDirectoryName ?? data.listing.title).slice(0, 100);
  const listingPath = getListingDirectoryPath(
    data.shop.shopName ?? data.shop.title ?? `Shop ${data.shop.etsyShopId}`,
    data.section.title,
    data.subSection.name,
    data.listing.localDirectoryName ?? `Listing-${data.listing.id}`,
  );
  const zipStorageStatus = await inspectListingZipStorage(data.listing, listingPath);
  const zippedFilesAreCurrent = zipStorageStatus.valid;
  const hasDigitalDownloads = data.listing.files.some((file) => !isDropboxInstructionPdfFile(file));
  const groupedDropboxNeedsPdf = data.listing.dropboxFiles.length > 0;
  const hasDropboxInstructionPdf = data.listing.files.some(isDropboxInstructionPdfFile);
  const dropboxIsCurrent = Boolean(data.listing.dropboxBundle?.sharedUrl?.trim())
    && data.listing.dropboxSyncedAt !== null
    && data.listing.dropboxRevision === data.listing.downloadsRevision
    && (!groupedDropboxNeedsPdf || hasDropboxInstructionPdf);
  const activeImages = data.listing.images.slice(0, ETSY_MAX_LISTING_IMAGES);
  const todoItems = getListingTodoItems({
    hasListingDescription: normalize(data.listing.listingDescription).length > 0,
    hasThumbnail: normalize(data.listing.thumbnailFileName).length > 0,
    hasTenImages: activeImages.length === 10 && activeImages.every((image) => normalize(image.localFileName).length > 0),
    hasCurrentZips: zippedFilesAreCurrent,
    hasCurrentDropbox: dropboxIsCurrent,
    hasEtsyProducts: data.listing.productConfig !== null && data.listing.products.length > 0,
    hasTags: data.listing.tags.length > 0,
    hasTitle: normalize(data.listing.title).length > 0,
    hasEtsyDescription: normalize(data.listing.description).length > 0,
    hasQuantity: (data.listing.quantity ?? 0) > 0,
    hasPrimaryColour: normalize(data.listing.primaryColour).length > 0,
  });
  let dropboxMessage: string | null = null;
  if (!hasDigitalDownloads) {
    dropboxMessage = 'Add at least one file to Digital Downloads before creating Dropbox.';
  } else if (groupedDropboxNeedsPdf && !hasDropboxInstructionPdf) {
    dropboxMessage = 'Create or update Dropbox to generate the Etsy download PDF.';
  } else if (data.listing.dropboxBundle && !dropboxIsCurrent) {
    dropboxMessage = 'Please update Dropbox because the digital downloads have changed.';
  }

  return {
    context,
    shop: {
      id: data.shop.etsyShopId.toString(),
      shopName: data.shop.shopName ?? data.shop.title ?? `Shop ${data.shop.etsyShopId}`,
    },
    section: {
      id: String(data.section.id),
      sectionName: data.section.title,
      roomTheme: data.section.roomTheme ?? '',
    },
    subSection: {
      id: String(data.subSection.id),
      name: data.subSection.name,
      numberOfDownloads: data.subSection.numberOfDownloads,
      includeAllDownloads: data.subSection.includeAllDownloads,
    },
    listing: {
      id: String(data.listing.id),
      etsyId: data.listing.etsyId,
      title: data.listing.title,
      localDirectoryName: data.listing.localDirectoryName,
      description: data.listing.description ?? '',
      listingDescription: data.listing.listingDescription ?? '',
      listingItem: data.listing.listingItem ?? defaultListingItem,
      listingItemInherited: data.listing.listingItem === null,
      roomTheme: data.listing.roomTheme ?? data.section.roomTheme ?? '',
      roomThemeInherited: data.listing.roomTheme === null && Boolean(data.section.roomTheme?.trim()),
      personalisationHeaderText: data.listing.personalisationHeaderText ?? "Rory's",
      personalisationFooterText: data.listing.personalisationFooterText ?? 'Bedroom',
      personalisationFontId: data.listing.personalisationFontId ?? DEFAULT_PERSONALISATION_FONT_ID,
      status: data.listing.state ?? '',
      quantity: data.listing.quantity,
      priceAmount: data.listing.priceAmount,
      priceDivisor: data.listing.priceDivisor,
      priceCurrencyCode: data.listing.priceCurrencyCode ?? 'GBP',
      taxonomyId: data.listing.taxonomyId,
      shopSectionId: data.listing.shopSectionId,
      whoMade: data.listing.whoMade ?? 'i_did',
      whenMade: data.listing.whenMade ?? '2020_2026',
      isSupply: data.listing.isSupply ?? false,
      shouldAutoRenew: data.listing.shouldAutoRenew ?? true,
      isPersonalizable: data.listing.isPersonalizable ?? false,
      language: data.listing.language ?? 'en-US',
      primaryColour: data.listing.primaryColour === 'grey' ? 'gray' : data.listing.primaryColour ?? '',
      secondaryColour: data.listing.secondaryColour === 'grey' ? 'gray' : data.listing.secondaryColour ?? '',
      listingType: data.listing.etsyProductType,
      etsySku: data.listing.productConfig?.sku ?? defaultListingSku,
      numberOfItems: data.listing.numberOfItems,
      includeAllItems: data.listing.includeAllItems,
    },
    thumbnail: data.listing.thumbnailFileName ? {
      fileName: data.listing.thumbnailFileName,
      originalFileName: data.listing.thumbnailOriginalFileName,
    } : null,
    pendingChanges: [
      data.listing.detailsChanged ? 'Details' as const : null,
      data.listing.tagsChanged ? 'Tags' as const : null,
      data.listing.imagesChanged ? 'Images' as const : null,
      data.listing.downloadsChanged ? 'Digital Downloads' as const : null,
      data.listing.productsChanged ? 'Etsy Products' as const : null,
    ].filter((area): area is Exclude<PendingListingChange, 'Thumbnail' | 'Dropbox'> => area !== null),
    readyToUpload: missingUploadFields.length === 0,
    missingUploadFields,
    todoItems,
    tags: data.listing.tags.map((tag) => ({ id: String(tag.id), value: tag.tag })),
    materials: data.listing.materials.map((material) => ({ id: String(material.id), value: material.material })),
    styles: data.listing.styles.map((style) => ({ id: String(style.id), value: style.style })),
    // Keep up to 25 local images available for preparing the listing. Etsy sync
    // continues to use only the first ten images.
    images: data.listing.images.slice(0, LISTING_EDITOR_MAX_IMAGES).map((image) => ({
      id: String(image.id),
      fileName: image.localFileName ?? image.urlFullxFull ?? image.etsyImageId ?? `Image ${image.id}`,
      originalFileName: image.originalFileName,
      rank: image.rank,
    })),
    files: data.listing.files.map((file) => ({
      id: String(file.id),
      fileName: file.localFileName ?? file.filename ?? file.etsyListingFileId ?? `File ${file.id}`,
      originalFileName: file.originalFileName,
      rank: file.rank,
      sizeBytes: file.sizeBytes,
      widthPixels: file.widthPixels,
      heightPixels: file.heightPixels,
      jpegQuality: file.jpegQuality ?? 100,
      zipNumber: file.zipNumber,
    })),
    zippedFiles: data.listing.zippedFiles.map((zip) => ({
      id: String(zip.id),
      zipNumber: zip.zipNumber,
      fileName: zip.fileName,
      sizeBytes: zip.sizeBytes,
    })),
    videos: data.listing.videos.map((video) => ({
      id: String(video.id),
      fileName: video.localFileName ?? video.etsyVideoId ?? `Video ${video.id}`,
      originalFileName: video.originalFileName,
      rank: video.rank,
    })),
    translations: data.listing.translations.map((translation) => ({
      id: String(translation.id),
      language: translation.language,
      title: translation.title ?? '',
      description: translation.description ?? '',
    })),
    inventory: data.listing.inventoryItems.map((inventory) => ({
      id: String(inventory.id),
      name: inventory.name,
      value: inventory.value ?? '',
      sku: inventory.sku ?? '',
      price: inventory.price,
      quantity: inventory.quantity,
    })),
    personalization: data.listing.personalizations.map((personalization) => ({
      id: String(personalization.id),
      instructions: personalization.instructions,
      isRequired: personalization.isRequired,
      charCountMax: personalization.charCountMax,
    })),
    buyerPrices: data.listing.buyerPrices.map((buyerPrice) => ({
      id: String(buyerPrice.id),
      amount: buyerPrice.amount,
      divisor: buyerPrice.divisor,
      currencyCode: buyerPrice.currencyCode,
      note: buyerPrice.note ?? '',
    })),
    etsyProducts: {
      config: {
        listOnEtsy: data.listing.productConfig?.listOnEtsy ?? true,
        digitalDownload: data.listing.productConfig?.digitalDownload ?? false,
        customTop: data.listing.productConfig?.customTop ?? true,
        customBottom: data.listing.productConfig?.customBottom ?? true,
        returnPolicyId: data.listing.productConfig?.returnPolicyId ?? importedReturnPolicyId,
      },
      sizes: ETSY_PRODUCT_SIZES.map((size) => ({
        key: size.key,
        label: size.label,
        enabled: sizeOptions.get(size.key) ?? true,
      })),
      frames: ETSY_PRODUCT_FRAMES.map((frame) => ({
        key: frame.key,
        label: frame.label,
        enabled: frameOptions.get(frame.key) ?? frame.defaultEnabled,
      })),
      products: data.listing.products.map((product) => {
        const price = priceByKey.get(product.priceKey);
        return {
          id: String(product.id),
          key: product.productKey,
          type: product.productType,
          sizeKey: product.sizeKey,
          sizeLabel: product.sizeKey ? sizeLabels.get(product.sizeKey) ?? product.sizeKey : null,
          frame: product.frameKey === 'no_frame' ? 'no_frame' : product.frameKey ? 'frame' : null,
          sku: product.sku,
          priceKey: product.priceKey,
          priceAmountPence: price?.amountPence ?? 0,
          currencyCode: price?.currencyCode ?? 'GBP',
          etsyListingId: product.etsyListingId,
          etsyProductId: product.etsyProductId,
          etsyOfferingId: product.etsyOfferingId,
        };
      }),
      prices,
    },
    dropbox: {
      bundle: data.listing.dropboxBundle ? {
        folderPath: data.listing.dropboxBundle.folderPath,
        sharedUrl: data.listing.dropboxBundle.sharedUrl,
        updatedAt: data.listing.dropboxBundle.updatedAt.toISOString(),
      } : null,
      current: dropboxIsCurrent,
      canCreateZips: data.listing.dropboxFiles.length > 0,
      zipsCurrent: zippedFilesAreCurrent,
      message: dropboxMessage,
      action: hasDigitalDownloads ? (data.listing.dropboxBundle ? 'update' : 'create') : null,
    },
  };
}

export async function getListingEditorData(context: ListingEditorContext) {
  try {
    return await mapEditorData(context, await getListingForContext(context));
  } catch {
    return null;
  }
}

export type AdminListingOption = {
  id: string;
  title: string;
  shopName: string;
  sectionName: string;
  subSectionName: string;
};

export async function getAdminListingOptions(): Promise<AdminListingOption[]> {
  const listings = await prisma.etsyListing.findMany({
    where: { subSectionId: { not: null } },
    orderBy: [{ title: 'asc' }],
    select: {
      id: true,
      title: true,
      shopId: true,
      subSection: {
        select: {
          name: true,
          shopSection: {
            select: {
              title: true,
              shop: { select: { shopName: true, title: true } },
            },
          },
        },
      },
    },
  });

  return listings
    .filter((listing) => listing.subSection !== null)
    .map((listing) => ({
      id: String(listing.id),
      title: listing.title,
      shopName: listing.subSection?.shopSection.shop?.shopName ?? listing.subSection?.shopSection.shop?.title ?? `Shop ${listing.shopId}`,
      sectionName: listing.subSection!.shopSection.title,
      subSectionName: listing.subSection!.name,
    }));
}

export async function getAdminListingEditorData(listingId: string) {
  const numericListingId = Number(listingId);

  if (!Number.isInteger(numericListingId)) return null;

  const listing = await prisma.etsyListing.findUnique({
    where: { id: numericListingId },
    select: {
      id: true,
      shopId: true,
      subSection: {
        select: {
          id: true,
          shopSectionId: true,
        },
      },
    },
  });

  if (!listing?.subSection) return null;

  return getListingEditorData({
    shopId: listing.shopId,
    sectionId: String(listing.subSection.shopSectionId),
    subSectionId: String(listing.subSection.id),
    listingId: String(listing.id),
  });
}

type ListingChangeArea = 'details' | 'tags' | 'images' | 'downloads';

async function refresh(context: ListingEditorContext, areas: ListingChangeArea[]) {
  await prisma.etsyListing.update({
    where: { id: toInt(context.listingId, 'listing id') },
    data: {
      lastLocalChangeAt: new Date(),
      ...(areas.includes('details') ? { detailsChanged: true } : {}),
      ...(areas.includes('tags') ? { tagsChanged: true } : {}),
      ...(areas.includes('images') ? { imagesChanged: true } : {}),
      ...(areas.includes('downloads') ? { downloadsChanged: true } : {}),
    },
  });

  const data = await getListingEditorData(context);

  if (!data) {
    throw new Error('Listing not found.');
  }

  return data;
}

export async function saveListingDetails(input: SaveListingDetailsInput) {
  const data = await getListingForContext(input);
  const supplied = (key: keyof SaveListingDetailsInput) => Object.prototype.hasOwnProperty.call(input, key);

  if (supplied('etsySku') && normalize(input.etsySku) !== data.listing.productConfig?.sku) {
    await saveListingSku(input, normalize(input.etsySku));
  }

  await prisma.etsyListing.update({
    where: {
      id: data.listing.id,
    },
    data: {
      ...(supplied('title') ? { title: normalize(input.title) } : {}),
      ...(supplied('description') ? { description: normalize(input.description) || null } : {}),
      ...(supplied('status') ? { state: normalize(input.status) || null } : {}),
      ...(supplied('quantity') ? { quantity: input.quantity } : {}),
      ...(supplied('priceAmount') ? { priceAmount: input.priceAmount } : {}),
      ...(supplied('priceDivisor') ? { priceDivisor: input.priceDivisor } : {}),
      ...(supplied('priceCurrencyCode') ? { priceCurrencyCode: normalize(input.priceCurrencyCode) || null } : {}),
      ...(supplied('taxonomyId') ? { taxonomyId: input.taxonomyId } : {}),
      ...(supplied('shopSectionId') ? { shopSectionId: input.shopSectionId } : {}),
      ...(supplied('whoMade') ? { whoMade: normalize(input.whoMade) || null } : {}),
      ...(supplied('whenMade') ? { whenMade: normalize(input.whenMade) || null } : {}),
      ...(supplied('isSupply') ? { isSupply: input.isSupply } : {}),
      ...(supplied('shouldAutoRenew') ? { shouldAutoRenew: input.shouldAutoRenew } : {}),
      ...(supplied('isPersonalizable') ? { isPersonalizable: input.isPersonalizable } : {}),
      ...(supplied('language') ? { language: normalize(input.language) || null } : {}),
      ...(supplied('primaryColour') ? { primaryColour: normalizeEtsyColour(input.primaryColour ?? '') } : {}),
      ...(supplied('secondaryColour') ? { secondaryColour: normalizeEtsyColour(input.secondaryColour ?? '') } : {}),
    },
  });

  return refresh(input, ['details']);
}

export async function saveListingDescription(context: ListingEditorContext, value: string) {
  const data = await getListingForContext(context);
  const listingDescription = value.trim();
  if (Array.from(listingDescription).length > 1000) {
    throw new Error('The listing description cannot be longer than 1,000 characters.');
  }
  await prisma.etsyListing.update({
    where: { id: data.listing.id },
    data: {
      listingDescription: listingDescription || null,
      lastLocalChangeAt: new Date(),
    },
  });
  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('Listing not found.');
  return refreshed;
}

export async function saveListingRoomTheme(context: ListingEditorContext, value: string) {
  const data = await getListingForContext(context);
  const roomTheme = value.trim();
  if (Array.from(roomTheme).length > 200) {
    throw new Error('The room theme cannot be longer than 200 characters.');
  }
  const sectionRoomTheme = data.section.roomTheme?.trim() ?? '';
  await prisma.etsyListing.update({
    where: { id: data.listing.id },
    data: {
      roomTheme: !roomTheme || roomTheme === sectionRoomTheme ? null : roomTheme,
      lastLocalChangeAt: new Date(),
    },
  });
  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('Listing not found.');
  return refreshed;
}

export async function saveListingItem(context: ListingEditorContext, value: string) {
  const data = await getListingForContext(context);
  const listingItem = value.trim();
  if (Array.from(listingItem).length > 100) {
    throw new Error('The listing item cannot be longer than 100 characters.');
  }
  const defaultListingItem = (data.listing.localDirectoryName ?? data.listing.title).slice(0, 100).trim();
  await prisma.etsyListing.update({
    where: { id: data.listing.id },
    data: {
      listingItem: !listingItem || listingItem === defaultListingItem ? null : listingItem,
      lastLocalChangeAt: new Date(),
    },
  });
  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('Listing not found.');
  return refreshed;
}

export async function savePersonalisationPromptSettings(
  context: ListingEditorContext,
  values: { headerText: string; footerText: string; fontId: string },
) {
  const data = await getListingForContext(context);
  if (Array.from(values.headerText).length > 200 || Array.from(values.footerText).length > 200) {
    throw new Error('Personalisation text cannot be longer than 200 characters.');
  }
  if (!getPersonalisationFont(values.fontId)) throw new Error('Choose a supported personalisation font.');

  await prisma.etsyListing.update({
    where: { id: data.listing.id },
    data: {
      personalisationHeaderText: values.headerText,
      personalisationFooterText: values.footerText,
      personalisationFontId: values.fontId,
      lastLocalChangeAt: new Date(),
    },
  });
  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('Listing not found.');
  return refreshed;
}

export async function addListingCollectionItem(context: ListingEditorContext, kind: CollectionKind, payload: Record<string, unknown>) {
  const data = await getListingForContext(context);

  if (kind === 'tag') {
    const value = normalize(String(payload.value ?? ''));
    if (!value) throw new Error('Enter a tag.');
    await prisma.etsyListingTag.create({ data: { listingId: data.listing.id, tag: value } });
  } else if (kind === 'material') {
    const value = normalize(String(payload.value ?? ''));
    if (!value) throw new Error('Enter a material.');
    await prisma.etsyListingMaterial.create({ data: { listingId: data.listing.id, material: value } });
  } else if (kind === 'style') {
    const value = normalize(String(payload.value ?? ''));
    if (!value) throw new Error('Enter a style.');
    await prisma.etsyListingStyle.create({ data: { listingId: data.listing.id, style: value } });
  } else if (kind === 'translation') {
    const language = normalize(String(payload.language ?? ''));
    if (!language) throw new Error('Enter a language.');
    await prisma.etsyListingTranslation.create({
      data: {
        listingId: data.listing.id,
        language,
        title: normalize(String(payload.title ?? '')) || null,
        description: normalize(String(payload.description ?? '')) || null,
      },
    });
  } else if (kind === 'inventory') {
    await prisma.etsyListingInventory.create({
      data: {
        listingId: data.listing.id,
        name: normalize(String(payload.name ?? 'Inventory')),
        value: normalize(String(payload.value ?? '')) || null,
        sku: normalize(String(payload.sku ?? '')) || null,
        price: payload.price === null || payload.price === '' || payload.price === undefined ? null : Number(payload.price),
        quantity: payload.quantity === null || payload.quantity === '' || payload.quantity === undefined ? null : Number(payload.quantity),
      },
    });
  } else if (kind === 'personalization') {
    const instructions = normalize(String(payload.instructions ?? ''));
    if (!instructions) throw new Error('Enter personalization instructions.');
    await prisma.etsyListingPersonalization.create({
      data: {
        listingId: data.listing.id,
        instructions,
        isRequired: Boolean(payload.isRequired),
        charCountMax:
          payload.charCountMax === null || payload.charCountMax === '' || payload.charCountMax === undefined
            ? null
            : Number(payload.charCountMax),
      },
    });
  } else if (kind === 'buyerPrice') {
    await prisma.etsyListingBuyerPrice.create({
      data: {
        listingId: data.listing.id,
        amount: Number(payload.amount ?? 0),
        divisor: Number(payload.divisor ?? 100),
        currencyCode: normalize(String(payload.currencyCode ?? 'GBP')) || 'GBP',
        note: normalize(String(payload.note ?? '')) || null,
      },
    });
  }

  return refresh(context, [kind === 'tag' ? 'tags' : 'details']);
}

export async function deleteListingCollectionItem(context: ListingEditorContext, kind: CollectionKind, id: string) {
  const data = await getListingForContext(context);
  const numericId = toInt(id, 'item id');
  let deletedCount = 0;

  if (kind === 'tag') deletedCount = (await prisma.etsyListingTag.deleteMany({ where: { id: numericId, listingId: data.listing.id } })).count;
  if (kind === 'material') {
    deletedCount = (await prisma.etsyListingMaterial.deleteMany({ where: { id: numericId, listingId: data.listing.id } })).count;
  }
  if (kind === 'style') deletedCount = (await prisma.etsyListingStyle.deleteMany({ where: { id: numericId, listingId: data.listing.id } })).count;
  if (kind === 'translation') {
    deletedCount = (await prisma.etsyListingTranslation.deleteMany({ where: { id: numericId, listingId: data.listing.id } })).count;
  }
  if (kind === 'inventory') {
    deletedCount = (await prisma.etsyListingInventory.deleteMany({ where: { id: numericId, listingId: data.listing.id } })).count;
  }
  if (kind === 'personalization') {
    deletedCount = (await prisma.etsyListingPersonalization.deleteMany({ where: { id: numericId, listingId: data.listing.id } })).count;
  }
  if (kind === 'buyerPrice') {
    deletedCount = (await prisma.etsyListingBuyerPrice.deleteMany({ where: { id: numericId, listingId: data.listing.id } })).count;
  }

  if (deletedCount === 0) {
    throw new Error('Item not found.');
  }

  return refresh(context, [kind === 'tag' ? 'tags' : 'details']);
}

export async function saveListingTags(context: ListingEditorContext, tags: string[]) {
  const data = await getListingForContext(context);
  const normalizedTags = tags
    .map((tag) => normalize(tag))
    .filter(Boolean)
    .filter((tag, index, values) => values.findIndex((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index);

  if (normalizedTags.length > 13) {
    throw new Error('A listing can have no more than 13 tags.');
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.etsyListingTag.deleteMany({
      where: { listingId: data.listing.id },
    });

    if (normalizedTags.length > 0) {
      await transaction.etsyListingTag.createMany({
        data: normalizedTags.map((tag, position) => ({
          listingId: data.listing.id,
          tag,
          position,
        })),
      });
    }
  });

  return refresh(context, ['tags']);
}

async function getListingAssetDirectory(context: ListingEditorContext) {
  const data = await getListingForContext(context);
  const shopName = data.shop.shopName ?? data.shop.title ?? `Shop ${data.shop.etsyShopId}`;
  const listingDirectoryName = data.listing.localDirectoryName ?? `Listing-${data.listing.id}`;
  const listingPath = getListingDirectoryPath(shopName, data.section.title, data.subSection.name, listingDirectoryName);

  await mkdir(listingPath, { recursive: true });

  return {
    data,
    listingPath,
  };
}

async function fileExists(filePath: string) {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function nextAssetName(kind: UploadKind, listingId: number, originalFileName: string, listingPath: string) {
  const extension = path.extname(cleanFileName(originalFileName)).toLowerCase() || (kind === 'image' || kind === 'thumbnail' ? '.jpg' : '');

  if ((kind === 'image' || kind === 'thumbnail') && !IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('Choose a JPG, PNG, or WEBP image.');
  }

  if (kind === 'video' && !VIDEO_EXTENSIONS.has(extension)) {
    throw new Error('Choose an MP4, MOV, or WEBM video.');
  }

  const baseName = kind === 'image' ? 'image_' : kind === 'video' ? 'video_' : 'file_';
  const normalizedExtension = extension === '.jpeg' ? '.jpg' : extension;
  const count =
    kind === 'image'
      ? await prisma.etsyListingImage.count({ where: { listingId } })
      : kind === 'video'
        ? await prisma.etsyListingVideo.count({ where: { listingId } })
        : await prisma.etsyListingFile.count({ where: { listingId } });
  let index = count + 1;
  let fileName = `${baseName}${index}${normalizedExtension}`;

  while (await fileExists(path.join(listingPath, fileName))) {
    index += 1;
    fileName = `${baseName}${index}${normalizedExtension}`;
  }

  return fileName;
}

export async function uploadListingAsset(context: ListingEditorContext, kind: UploadKind, file: File) {
  const { data, listingPath } = await getListingAssetDirectory(context);

  if (kind === 'thumbnail' && data.listing.thumbnailFileName) {
    throw new Error('Delete the current thumbnail before uploading another one.');
  }
  const thumbnailExtension = path.extname(cleanFileName(file.name)).toLowerCase();
  if (kind === 'thumbnail' && !IMAGE_EXTENSIONS.has(thumbnailExtension)) {
    throw new Error('Choose a JPG, PNG, or WEBP image.');
  }

  if (kind === 'image' && data.listing.images.length >= LISTING_EDITOR_MAX_IMAGES) {
    throw new Error(`A listing can have no more than ${LISTING_EDITOR_MAX_IMAGES} images.`);
  }

  const assetDirectory = kind === 'file'
    ? path.join(listingPath, 'downloads')
    : kind === 'thumbnail'
      ? path.join(listingPath, 'thumbnail')
      : listingPath;
  await mkdir(assetDirectory, { recursive: true });
  const extension = path.extname(cleanFileName(file.name)).toLowerCase();
  const fileName = kind === 'thumbnail'
    ? `thumbnail${extension === '.jpeg' ? '.jpg' : extension}`
    : await nextAssetName(kind, data.listing.id, file.name, assetDirectory);
  const targetPath = path.join(assetDirectory, fileName);

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  await writeFile(targetPath, fileBuffer);

  if (kind === 'thumbnail') {
    await prisma.etsyListing.update({
      where: { id: data.listing.id },
      data: { thumbnailFileName: fileName, thumbnailOriginalFileName: file.name },
    });
  } else if (kind === 'image') {
    await prisma.etsyListingImage.create({
      data: {
        listingId: data.listing.id,
        localFileName: fileName,
        originalFileName: file.name,
        rank: await prisma.etsyListingImage.count({ where: { listingId: data.listing.id } }),
      },
    });
  } else if (kind === 'file') {
    let dimensions: { width?: number; height?: number } = {};

    try {
      dimensions = imageSize(fileBuffer);
    } catch {
      // Non-image downloads do not have pixel dimensions.
    }

    await prisma.$transaction([
      prisma.etsyListingFile.create({
        data: {
          listingId: data.listing.id,
          localFileName: fileName,
          originalFileName: file.name,
          filename: fileName,
          filesize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
          sizeBytes: file.size,
          widthPixels: dimensions.width ?? null,
          heightPixels: dimensions.height ?? null,
          jpegQuality: /\.jpe?g$/i.test(file.name) ? 100 : null,
          filetype: file.type || path.extname(file.name).slice(1).toLowerCase() || null,
          rawJson: toRawJson({
            localFileName: fileName,
            originalFileName: file.name,
            sizeBytes: file.size,
            widthPixels: dimensions.width ?? null,
            heightPixels: dimensions.height ?? null,
          }),
        },
      }),
      prisma.etsyListingZip.deleteMany({ where: { listingId: data.listing.id } }),
      prisma.etsyListing.update({
        where: { id: data.listing.id },
        data: { downloadsRevision: { increment: 1 } },
      }),
    ]);
  } else {
    await prisma.etsyListingVideo.create({
      data: {
        listingId: data.listing.id,
        localFileName: fileName,
        originalFileName: file.name,
        rank: await prisma.etsyListingVideo.count({ where: { listingId: data.listing.id } }),
      },
    });
  }

  if (kind === 'file') {
    await removeListingZipFiles(listingPath, data.listing.zippedFiles);
  }

  return refresh(context, kind === 'thumbnail' ? [] : [kind === 'file' ? 'downloads' : 'images']);
}

async function renameImageFilesSafely(
  listingPath: string,
  changes: Array<{ from: string; to: string }>
) {
  const requiredChanges = changes.filter((change) => change.from !== change.to);
  if (requiredChanges.length === 0) return;

  const sourceNames = new Set(requiredChanges.map((change) => change.from.toLocaleLowerCase()));
  for (const change of requiredChanges) {
    if (!sourceNames.has(change.to.toLocaleLowerCase()) && await fileExists(path.join(listingPath, change.to))) {
      throw new Error(`Cannot reorder images because "${change.to}" already exists.`);
    }
  }

  const temporaryChanges: Array<{ from: string; temporary: string; to: string }> = [];
  try {
    for (const change of requiredChanges) {
      const temporary = `.image-reorder-${randomUUID()}${path.extname(change.from)}`;
      await rename(path.join(listingPath, change.from), path.join(listingPath, temporary));
      temporaryChanges.push({ ...change, temporary });
    }
    for (const change of temporaryChanges) {
      await rename(path.join(listingPath, change.temporary), path.join(listingPath, change.to));
    }
  } catch (error) {
    const rollbackChanges: Array<{ temporary: string; original: string }> = [];
    for (const change of temporaryChanges) {
      const temporaryPath = path.join(listingPath, change.temporary);
      const finalPath = path.join(listingPath, change.to);
      const currentPath = await fileExists(temporaryPath) ? temporaryPath : finalPath;
      if (!await fileExists(currentPath)) continue;
      const rollbackTemporary = `.image-rollback-${randomUUID()}${path.extname(change.from)}`;
      await rename(currentPath, path.join(listingPath, rollbackTemporary));
      rollbackChanges.push({ temporary: rollbackTemporary, original: change.from });
    }
    for (const rollback of rollbackChanges) {
      await rename(path.join(listingPath, rollback.temporary), path.join(listingPath, rollback.original));
    }
    throw error;
  }
}

export async function reorderListingImages(context: ListingEditorContext, order: ImageOrderItem[]) {
  const { data, listingPath } = await getListingAssetDirectory(context);
  const requestedIds = order.map((item) => toInt(item.id, 'image id'));
  const activeImages = data.listing.images.slice(0, LISTING_EDITOR_MAX_IMAGES);
  const existingIds = activeImages.map((image) => image.id);

  if (requestedIds.length !== existingIds.length || new Set(requestedIds).size !== requestedIds.length) {
    throw new Error('The image order must contain every listing image exactly once.');
  }
  if (requestedIds.some((id) => !existingIds.includes(id))) {
    throw new Error('The image order contains an image that does not belong to this listing.');
  }

  const imagesById = new Map(activeImages.map((image) => [image.id, image]));
  const updates = requestedIds.map((id, index) => {
    const image = imagesById.get(id)!;
    const extension = image.localFileName ? path.extname(image.localFileName).toLowerCase() : '';
    const isPositionFileName = image.localFileName ? /^image_\d+\.[^.]+$/i.test(image.localFileName) : false;
    return {
      id,
      rank: index + 1,
      oldFileName: image.localFileName,
      newFileName: isPositionFileName ? `image_${index + 1}${extension}` : image.localFileName,
    };
  });
  const fileChanges = updates
    .filter((update): update is typeof update & { oldFileName: string; newFileName: string } =>
      update.oldFileName !== null && update.newFileName !== null && update.oldFileName !== update.newFileName
    )
    .map((update) => ({ from: update.oldFileName, to: update.newFileName }));

  await renameImageFilesSafely(listingPath, fileChanges);
  try {
    await prisma.$transaction([
      ...updates.map((update) => prisma.etsyListingImage.update({
        where: { id: update.id },
        data: { rank: update.rank, localFileName: update.newFileName },
      })),
      prisma.etsyListing.update({
        where: { id: data.listing.id },
        data: { lastLocalChangeAt: new Date(), imagesChanged: true },
      }),
    ]);
  } catch (error) {
    await renameImageFilesSafely(
      listingPath,
      fileChanges.map((change) => ({ from: change.to, to: change.from }))
    );
    throw error;
  }

  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('Listing not found after reordering images.');
  return refreshed;
}

export async function getListingAssetFile(context: ListingEditorContext, kind: UploadKind, id: string) {
  const { data, listingPath } = await getListingAssetDirectory(context);
  let localFileName: string | null = null;

  if (kind === 'thumbnail') {
    localFileName = data.listing.thumbnailFileName;
  } else if (kind === 'image') {
    const numericId = toInt(id, 'asset id');
    localFileName = (await prisma.etsyListingImage.findFirst({
      where: { id: numericId, listingId: data.listing.id },
      select: { localFileName: true },
    }))?.localFileName ?? null;
  } else if (kind === 'file') {
    const numericId = toInt(id, 'asset id');
    localFileName = (await prisma.etsyListingFile.findFirst({
      where: { id: numericId, listingId: data.listing.id },
      select: { localFileName: true },
    }))?.localFileName ?? null;
  } else {
    const numericId = toInt(id, 'asset id');
    localFileName = (await prisma.etsyListingVideo.findFirst({
      where: { id: numericId, listingId: data.listing.id },
      select: { localFileName: true },
    }))?.localFileName ?? null;
  }

  if (!localFileName) throw new Error('Asset not found.');

  const extension = path.extname(localFileName).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };

  return {
    contents: await readFile(path.join(
      listingPath,
      ...(kind === 'file' ? ['downloads'] : kind === 'thumbnail' ? ['thumbnail'] : []),
      localFileName
    )),
    contentType: contentTypes[extension] ?? 'application/octet-stream',
  };
}

type DownloadZipAssignment = { fileId: string; zipNumber: number | null };

async function writeZipFile(targetPath: string, files: Array<{ path: string; name: string }>) {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  // A fixed entry timestamp keeps identical source sets byte-identical across
  // runs, so unchanged archives can retain their Etsy file mapping.
  const entryDate = new Date(Date.UTC(1980, 0, 1));
  for (const file of files) archive.append(await readFile(file.path), { name: file.name, date: entryDate });
  await archive.finalize();
  await completed;
  await writeFile(targetPath, Buffer.concat(chunks));
}

function listingZipBaseName(title: string) {
  const words = title.match(/[A-Za-z0-9]+/g) ?? [];
  const baseName = words.map((word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`).join('');
  return baseName || 'Listing';
}

async function removeListingZipFiles(listingPath: string, zippedFiles: Array<{ fileName: string }>) {
  const fileNames = new Set([
    ...zippedFiles.map((zip) => zip.fileName),
    ...Array.from({ length: ETSY_MAX_DOWNLOAD_FILES }, (_, index) => `zip_${index + 1}.zip`),
  ]);

  await Promise.all([...fileNames].map(async (fileName) => {
    try {
      await unlink(path.join(listingPath, 'zipped', fileName));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }));
}

const ordinaryZipLocks = new Map<number, Promise<void>>();

async function withOrdinaryZipLock<T>(listingId: number, action: () => Promise<T>) {
  const previous = ordinaryZipLocks.get(listingId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  ordinaryZipLocks.set(listingId, tail);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (ordinaryZipLocks.get(listingId) === tail) ordinaryZipLocks.delete(listingId);
  }
}

function isMissingZipStorageError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function unlinkZipIfPresent(storagePath: string) {
  try {
    await unlink(storagePath);
  } catch (error) {
    if (!isMissingZipStorageError(error)) throw error;
  }
}

async function cleanupZipStoragePaths(storagePaths: Iterable<string>) {
  const failures: unknown[] = [];
  for (const storagePath of storagePaths) {
    try {
      await unlinkZipIfPresent(storagePath);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

type OrdinaryZipBackup = {
  livePath: string;
  backupPath: string;
  sizeBytes: number;
};

async function rollbackOrdinaryZipInstall(livePaths: Set<string>, backups: OrdinaryZipBackup[]) {
  const failures = await cleanupZipStoragePaths(livePaths);
  for (const backup of backups) {
    try {
      await copyFile(backup.backupPath, backup.livePath);
      const restored = await stat(backup.livePath);
      if (!restored.isFile() || restored.size !== backup.sizeBytes) {
        throw new Error(`Failed to restore ${path.basename(backup.livePath)} to its previous size.`);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new Error('The previous listing ZIP files could not be fully restored after a failed install.', {
      cause: failures[0],
    });
  }
}

async function createListingZipFilesUnlocked(context: ListingEditorContext, assignments: DownloadZipAssignment[]) {
  const { data, listingPath } = await getListingAssetDirectory(context);
  const assignmentMap = new Map(assignments.map((assignment) => [toInt(assignment.fileId, 'file id'), assignment.zipNumber]));
  const files = data.listing.files;

  if (files.length === 0) throw new Error('Upload at least one download file first.');
  if (assignmentMap.size !== files.length || files.some((file) => !assignmentMap.has(file.id))) {
    throw new Error('Every current download file must have one ZIP number.');
  }
  if (files.some((file) => file.sizeBytes === null)) throw new Error('Every download file must have a confirmed size.');
  const usedZipNumbers = [...new Set(assignmentMap.values())].sort((first, second) => first! - second!);
  if (usedZipNumbers.some((zipNumber) => !Number.isInteger(zipNumber) || zipNumber! < 1)
    || usedZipNumbers.some((zipNumber, index) => zipNumber !== index + 1)) {
    throw new Error('ZIP numbers must start at 1 and remain consecutive.');
  }
  if (usedZipNumbers.some((zipNumber) => zipNumber! > ETSY_MAX_DOWNLOAD_FILES)) {
    throw new Error('Etsy allows no more than 5 download ZIP files.');
  }
  for (const zipNumber of usedZipNumbers as number[]) {
    const sourceTotal = files
      .filter((file) => assignmentMap.get(file.id) === zipNumber)
      .reduce((total, file) => total + file.sizeBytes!, 0);
    if (sourceTotal > ETSY_MAX_FILE_SIZE_BYTES) {
      throw new Error(`ZIP ${zipNumber} exceeds Etsy's 20 MB file limit.`);
    }
  }

  const downloadsDirectory = path.join(listingPath, 'downloads');
  const zippedDirectory = path.join(listingPath, 'zipped');
  await mkdir(zippedDirectory, { recursive: true });
  const operationId = randomUUID();
  const failureRevisionMarker = -1 - Number.parseInt(operationId.slice(0, 7), 16);
  const generated: Array<{
    zipNumber: number;
    fileName: string;
    stagingPath: string;
    targetPath: string;
    sizeBytes: number;
    storageUnchanged: boolean;
  }> = [];
  const stagingPaths = new Set<string>();
  const backups: OrdinaryZipBackup[] = [];
  const backupPaths = new Set<string>();
  const livePaths = new Set<string>();
  let liveInstallStarted = false;
  let databaseCommitted = false;
  const zipBaseName = listingZipBaseName(data.listing.localDirectoryName ?? data.listing.title);

  try {
    for (const zipNumber of usedZipNumbers as number[]) {
      const groupedFiles = files.filter((file) => assignmentMap.get(file.id) === zipNumber && file.localFileName);
      const fileName = `${zipBaseName}_${zipNumber}.zip`;
      const targetPath = path.join(zippedDirectory, fileName);
      const stagingPath = path.join(zippedDirectory, `.${operationId}.${zipNumber}.staged`);
      stagingPaths.add(stagingPath);

      await writeZipFile(
        stagingPath,
        groupedFiles.map((file) => ({
          path: path.join(downloadsDirectory, file.localFileName!),
          name: file.originalFileName ?? file.localFileName!,
        })),
      );
      const zipStats = await stat(stagingPath);
      if (!zipStats.isFile() || zipStats.size <= 0) throw new Error(`Generated ZIP ${zipNumber} is empty or invalid.`);
      if (zipStats.size > ETSY_MAX_FILE_SIZE_BYTES) {
        throw new Error(`Generated ZIP ${zipNumber} exceeds Etsy's 20 MB file limit.`);
      }
      const stagedContents = await readFile(stagingPath);
      let storageUnchanged = false;
      try {
        const liveContents = await readFile(targetPath);
        storageUnchanged = liveContents.equals(stagedContents);
      } catch (error) {
        if (!isMissingZipStorageError(error)) throw error;
      }
      generated.push({
        zipNumber,
        fileName,
        stagingPath,
        targetPath,
        sizeBytes: zipStats.size,
        storageUnchanged,
      });
    }

    const currentListing = await prisma.etsyListing.findUnique({
      where: { id: data.listing.id },
      select: { downloadsRevision: true, zippedRevision: true },
    });
    if (currentListing?.downloadsRevision !== data.listing.downloadsRevision
      || currentListing.zippedRevision !== data.listing.zippedRevision) {
      throw new Error('The downloads or ZIP state changed while the archives were being prepared. Please try again.');
    }

    const existingZipNames = (await readdir(zippedDirectory))
      .filter((fileName) => fileName.toLocaleLowerCase().endsWith('.zip'));
    const unchangedStoragePaths = new Set(generated
      .filter((zip) => zip.storageUnchanged)
      .map((zip) => zip.targetPath.toLocaleLowerCase()));
    for (let index = 0; index < existingZipNames.length; index += 1) {
      const fileName = existingZipNames[index];
      const livePath = path.join(zippedDirectory, fileName);
      if (unchangedStoragePaths.has(livePath.toLocaleLowerCase())) continue;
      const liveStats = await stat(livePath);
      if (!liveStats.isFile()) continue;
      const backupPath = path.join(zippedDirectory, `.${operationId}.${index + 1}.backup`);
      backupPaths.add(backupPath);
      await copyFile(livePath, backupPath);
      const backupStats = await stat(backupPath);
      if (!backupStats.isFile() || backupStats.size !== liveStats.size) {
        throw new Error(`Unable to stage a rollback copy of ${fileName}.`);
      }
      backups.push({ livePath, backupPath, sizeBytes: liveStats.size });
      livePaths.add(livePath);
    }

    for (const zip of generated) {
      if (!zip.storageUnchanged) livePaths.add(zip.targetPath);
    }
    liveInstallStarted = livePaths.size > 0;
    for (const zip of generated) {
      if (!zip.storageUnchanged) await rename(zip.stagingPath, zip.targetPath);
    }

    const generatedFileNames = new Set(generated.map((zip) => zip.fileName.toLocaleLowerCase()));
    for (const existingName of existingZipNames) {
      if (!generatedFileNames.has(existingName.toLocaleLowerCase())) {
        await unlinkZipIfPresent(path.join(zippedDirectory, existingName));
      }
    }

    for (const zip of generated) {
      const installedStats = await stat(zip.targetPath);
      if (!installedStats.isFile() || installedStats.size !== zip.sizeBytes) {
        throw new Error(`Installed ZIP ${zip.zipNumber} did not match its staged archive.`);
      }
    }

    const existingZipByNumber = new Map(data.listing.zippedFiles.map((zip) => [zip.zipNumber, zip]));
    const generatedZipNumbers = new Set(generated.map((zip) => zip.zipNumber));
    const removedZipIds = data.listing.zippedFiles
      .filter((zip) => !generatedZipNumbers.has(zip.zipNumber))
      .map((zip) => zip.id);
    const zipSetChanged = removedZipIds.length > 0 || generated.some((zip) => {
      const existingZip = existingZipByNumber.get(zip.zipNumber);
      return !existingZip || existingZip.fileName !== zip.fileName || !zip.storageUnchanged;
    });

    await prisma.$transaction(async (tx) => {
      const revisionGuard = await tx.etsyListing.updateMany({
        where: {
          id: data.listing.id,
          downloadsRevision: data.listing.downloadsRevision,
          zippedRevision: data.listing.zippedRevision,
        },
        data: {
          hasEverZipped: true,
          zippedRevision: data.listing.downloadsRevision,
          ...(zipSetChanged ? { downloadsChanged: true, lastLocalChangeAt: new Date() } : {}),
        },
      });
      if (revisionGuard.count !== 1) {
        throw new Error('The downloads or ZIP state changed while the archives were being installed. Please try again.');
      }
      await Promise.all(files.map((file) => tx.etsyListingFile.update({
        where: { id: file.id },
        data: { zipNumber: assignmentMap.get(file.id)! },
      })));
      if (removedZipIds.length > 0) {
        await tx.etsyListingZip.deleteMany({ where: { id: { in: removedZipIds } } });
      }
      for (const zip of generated) {
        const existingZip = existingZipByNumber.get(zip.zipNumber);
        if (existingZip) {
          const preserveEtsyFileId = existingZip.fileName === zip.fileName && zip.storageUnchanged;
          await tx.etsyListingZip.update({
            where: { id: existingZip.id },
            data: {
              fileName: zip.fileName,
              sizeBytes: zip.sizeBytes,
              ...(!preserveEtsyFileId ? { etsyListingFileId: null } : {}),
            },
          });
        } else {
          await tx.etsyListingZip.create({
            data: {
              listingId: data.listing.id,
              zipNumber: zip.zipNumber,
              fileName: zip.fileName,
              sizeBytes: zip.sizeBytes,
            },
          });
        }
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    databaseCommitted = true;

    const cleanupFailures = await cleanupZipStoragePaths([...stagingPaths, ...backupPaths]);
    if (cleanupFailures.length > 0) {
      console.warn('Listing ZIPs were installed, but one or more temporary rollback copies could not be removed.');
    }
  } catch (error) {
    let rollbackError: unknown = null;
    if (liveInstallStarted && !databaseCommitted) {
      try {
        await rollbackOrdinaryZipInstall(livePaths, backups);
      } catch (caughtRollbackError) {
        rollbackError = caughtRollbackError;
      }
    }
    await cleanupZipStoragePaths(stagingPaths);
    if (!rollbackError) await cleanupZipStoragePaths(backupPaths);
    if (rollbackError) {
      try {
        await prisma.etsyListing.updateMany({
          where: {
            id: data.listing.id,
            downloadsRevision: data.listing.downloadsRevision,
            zippedRevision: data.listing.downloadsRevision,
          },
          data: { zippedRevision: failureRevisionMarker },
        });
      } catch {
        // Preserve rollback copies when both storage recovery and invalidation fail.
      }
      throw new Error('ZIP creation failed and the previous ZIP files could not be fully restored.', {
        cause: rollbackError,
      });
    }
    throw error;
  }

  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('The ZIP files were created, but the refreshed listing could not be loaded.');
  return refreshed;
}

export async function createListingZipFiles(context: ListingEditorContext, assignments: DownloadZipAssignment[]) {
  const listingId = toInt(context.listingId, 'listing id');
  return withOrdinaryZipLock(listingId, () => createListingZipFilesUnlocked(context, assignments));
}

type InstalledDownloadReplacement = {
  targetPath: string;
  backupPath: string;
  previousContents: Buffer;
};

async function installDownloadReplacement(
  targetPath: string,
  previousContents: Buffer,
  replacementContents: Buffer,
): Promise<InstalledDownloadReplacement> {
  const directoryPath = path.dirname(targetPath);
  const operationId = randomUUID();
  const stagingPath = path.join(directoryPath, `.${operationId}.download-edit.staged`);
  const backupPath = path.join(directoryPath, `.${operationId}.download-edit.backup`);
  let installStarted = false;

  try {
    await writeFile(stagingPath, replacementContents);
    const stagedContents = await readFile(stagingPath);
    if (!stagedContents.equals(replacementContents) || stagedContents.length === 0) {
      throw new Error('The edited download could not be staged safely.');
    }

    await copyFile(targetPath, backupPath);
    const backupContents = await readFile(backupPath);
    if (!backupContents.equals(previousContents)) {
      throw new Error('The existing download could not be backed up safely.');
    }

    installStarted = true;
    await rename(stagingPath, targetPath);
    const installedContents = await readFile(targetPath);
    if (!installedContents.equals(replacementContents)) {
      throw new Error('The edited download did not persist correctly.');
    }

    return { targetPath, backupPath, previousContents };
  } catch (error) {
    let rollbackError: unknown = null;
    if (installStarted) {
      try {
        await unlinkZipIfPresent(targetPath);
        await copyFile(backupPath, targetPath);
        const restoredContents = await readFile(targetPath);
        if (!restoredContents.equals(previousContents)) {
          throw new Error('The previous download bytes could not be restored.');
        }
      } catch (caughtRollbackError) {
        rollbackError = caughtRollbackError;
      }
    }
    await cleanupZipStoragePaths([stagingPath]);
    if (!rollbackError) await cleanupZipStoragePaths([backupPath]);
    if (rollbackError) {
      throw new Error('The download edit failed and the previous file could not be restored.', {
        cause: rollbackError,
      });
    }
    throw error;
  }
}

async function commitDownloadReplacement(
  targetPath: string,
  previousContents: Buffer,
  replacementContents: Buffer,
  commitDatabaseChanges: () => Promise<unknown>,
) {
  const installed = await installDownloadReplacement(targetPath, previousContents, replacementContents);
  try {
    await commitDatabaseChanges();
  } catch (error) {
    try {
      await unlinkZipIfPresent(installed.targetPath);
      await copyFile(installed.backupPath, installed.targetPath);
      const restoredContents = await readFile(installed.targetPath);
      if (!restoredContents.equals(installed.previousContents)) {
        throw new Error('The previous download bytes could not be restored.');
      }
      await cleanupZipStoragePaths([installed.backupPath]);
    } catch (rollbackError) {
      throw new Error('The database rejected the download edit and the previous file could not be restored.', {
        cause: rollbackError,
      });
    }
    throw error;
  }

  const cleanupFailures = await cleanupZipStoragePaths([installed.backupPath]);
  if (cleanupFailures.length > 0) {
    console.warn('The download was updated, but its temporary rollback copy could not be removed.');
  }
}

export async function reduceListingDownload(context: ListingEditorContext, fileId: string) {
  const { data, listingPath } = await getListingAssetDirectory(context);
  const numericFileId = toInt(fileId, 'file id');
  const file = data.listing.files.find((item) => item.id === numericFileId);

  if (!file?.localFileName) throw new Error('Download file not found.');

  const target = getNextPrintSize(file.widthPixels, file.heightPixels);
  if (!target) throw new Error('This file is already at its smallest supported size or does not match a supported print size.');

  const filePath = path.join(listingPath, 'downloads', file.localFileName);
  const sourceBuffer = await readFile(filePath);
  const resizedBuffer = await sharp(sourceBuffer)
    .resize(target.width, target.height, { fit: 'inside', withoutEnlargement: true })
    .withMetadata({ density: 300 })
    .toBuffer();

  const metadata = await sharp(resizedBuffer).metadata();
  await commitDownloadReplacement(filePath, sourceBuffer, resizedBuffer, () => prisma.$transaction([
      prisma.etsyListingFile.update({
        where: { id: file.id },
        data: {
          etsyListingFileId: null,
          widthPixels: metadata.width ?? target.width,
          heightPixels: metadata.height ?? target.height,
          sizeBytes: resizedBuffer.length,
          filesize: `${(resizedBuffer.length / (1024 * 1024)).toFixed(2)} MB`,
          rawJson: toRawJson({
            localFileName: file.localFileName,
            originalFileName: file.originalFileName,
            sizeBytes: resizedBuffer.length,
            widthPixels: metadata.width ?? target.width,
            heightPixels: metadata.height ?? target.height,
            density: 300,
          }),
        },
      }),
      prisma.etsyListingZip.deleteMany({ where: { listingId: data.listing.id } }),
      prisma.etsyListing.update({
        where: { id: data.listing.id },
        data: {
          downloadsRevision: { increment: 1 },
          downloadsChanged: true,
          lastLocalChangeAt: new Date(),
        },
      }),
    ]));

  await removeListingZipFiles(listingPath, data.listing.zippedFiles);

  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('The download was resized, but the refreshed listing could not be loaded.');
  return refreshed;
}

export async function reduceListingDownloadQuality(context: ListingEditorContext, fileId: string) {
  const { data, listingPath } = await getListingAssetDirectory(context);
  const numericFileId = toInt(fileId, 'file id');
  const file = data.listing.files.find((item) => item.id === numericFileId);

  if (!file?.localFileName) throw new Error('Download file not found.');
  const extension = path.extname(file.originalFileName ?? file.localFileName).toLocaleLowerCase();
  if (extension !== '.jpg' && extension !== '.jpeg') throw new Error('The quality action is only available for JPEG files.');
  const currentQuality = file.jpegQuality ?? 100;
  const nextQuality = currentQuality - 10;
  if (nextQuality < 10) throw new Error('JPEG quality cannot be reduced below 10%.');

  const filePath = path.join(listingPath, 'downloads', file.localFileName);
  const sourceBuffer = await readFile(filePath);
  const sourceMetadata = await sharp(sourceBuffer).metadata();
  const recompressedBuffer = await sharp(sourceBuffer)
    .withMetadata({ density: 300 })
    .jpeg({ quality: nextQuality })
    .toBuffer();

  const metadata = await sharp(recompressedBuffer).metadata();
  await commitDownloadReplacement(filePath, sourceBuffer, recompressedBuffer, () => prisma.$transaction([
      prisma.etsyListingFile.update({
        where: { id: file.id },
        data: {
          etsyListingFileId: null,
          widthPixels: metadata.width ?? sourceMetadata.width ?? file.widthPixels,
          heightPixels: metadata.height ?? sourceMetadata.height ?? file.heightPixels,
          jpegQuality: nextQuality,
          sizeBytes: recompressedBuffer.length,
          filesize: `${(recompressedBuffer.length / (1024 * 1024)).toFixed(2)} MB`,
          rawJson: toRawJson({
            localFileName: file.localFileName,
            originalFileName: file.originalFileName,
            sizeBytes: recompressedBuffer.length,
            widthPixels: metadata.width ?? sourceMetadata.width ?? file.widthPixels,
            heightPixels: metadata.height ?? sourceMetadata.height ?? file.heightPixels,
            density: 300,
            jpegQuality: nextQuality,
          }),
        },
      }),
      prisma.etsyListingZip.deleteMany({ where: { listingId: data.listing.id } }),
      prisma.etsyListing.update({
        where: { id: data.listing.id },
        data: {
          downloadsRevision: { increment: 1 },
          downloadsChanged: true,
          lastLocalChangeAt: new Date(),
        },
      }),
    ]));

  await removeListingZipFiles(listingPath, data.listing.zippedFiles);

  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('The download was recompressed, but the refreshed listing could not be loaded.');
  return refreshed;
}

export async function deleteListingAsset(context: ListingEditorContext, kind: UploadKind, id: string) {
  const { data, listingPath } = await getListingAssetDirectory(context);
  let localFileName: string | null = null;

  if (kind === 'thumbnail') {
    localFileName = data.listing.thumbnailFileName;
    if (!localFileName) throw new Error('Thumbnail not found.');
    await prisma.etsyListing.update({
      where: { id: data.listing.id },
      data: { thumbnailFileName: null, thumbnailOriginalFileName: null },
    });
  } else if (kind === 'image') {
    const numericId = toInt(id, 'asset id');
    const image = await prisma.etsyListingImage.findFirst({ where: { id: numericId, listingId: data.listing.id } });
    if (!image) throw new Error('Asset not found.');
    await prisma.etsyListingImage.delete({ where: { id: numericId } });
    localFileName = image.localFileName;
  } else if (kind === 'file') {
    const numericId = toInt(id, 'asset id');
    const file = await prisma.etsyListingFile.findFirst({ where: { id: numericId, listingId: data.listing.id } });
    if (!file) throw new Error('Asset not found.');
    await prisma.$transaction([
      prisma.etsyListingFile.delete({ where: { id: numericId } }),
      prisma.etsyListingZip.deleteMany({ where: { listingId: data.listing.id } }),
      prisma.etsyListing.update({
        where: { id: data.listing.id },
        data: { downloadsRevision: { increment: 1 } },
      }),
    ]);
    localFileName = file.localFileName;
  } else {
    const numericId = toInt(id, 'asset id');
    const video = await prisma.etsyListingVideo.findFirst({ where: { id: numericId, listingId: data.listing.id } });
    if (!video) throw new Error('Asset not found.');
    await prisma.etsyListingVideo.delete({ where: { id: numericId } });
    localFileName = video.localFileName;
  }

  if (localFileName) {
    try {
      await unlink(path.join(
        listingPath,
        ...(kind === 'file' ? ['downloads'] : kind === 'thumbnail' ? ['thumbnail'] : []),
        localFileName
      ));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }

  if (kind === 'file') {
    await removeListingZipFiles(listingPath, data.listing.zippedFiles);
  }

  return refresh(context, kind === 'thumbnail' ? [] : [kind === 'file' ? 'downloads' : 'images']);
}

export async function deleteAllListingDownloads(context: ListingEditorContext) {
  const { data, listingPath } = await getListingAssetDirectory(context);

  await prisma.$transaction([
    prisma.etsyListingZip.deleteMany({ where: { listingId: data.listing.id } }),
    prisma.etsyListingFile.deleteMany({ where: { listingId: data.listing.id } }),
    prisma.etsyListing.update({
      where: { id: data.listing.id },
      data: { downloadsRevision: { increment: 1 } },
    }),
  ]);

  await Promise.all([
    rm(path.join(listingPath, 'downloads'), { recursive: true, force: true }),
    rm(path.join(listingPath, 'zipped'), { recursive: true, force: true }),
  ]);

  return refresh(context, ['downloads']);
}
