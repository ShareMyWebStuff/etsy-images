import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { ZipArchive } from 'archiver';
import { imageSize } from 'image-size';
import sharp from 'sharp';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { ETSY_PRIMARY_COLOURS } from '@/lib/etsy-colours';
import { prisma } from '@/lib/prisma';
import { getNextPrintSize } from '@/lib/print-sizes';
import { ETSY_MAX_DOWNLOAD_FILES, ETSY_MAX_FILE_SIZE_BYTES } from '@/lib/etsy-download-limits';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);

type ListingEditorContext = {
  shopId: string;
  sectionId: string;
  subSectionId: string;
  listingId: string;
};

export type ListingEditorData = {
  context: ListingEditorContext;
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
  listing: {
    id: string;
    etsyId: string | null;
    title: string;
    localDirectoryName: string | null;
    description: string;
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
  };
  readyToUpload: boolean;
  missingUploadFields: string[];
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
};

export type SaveListingDetailsInput = ListingEditorContext & {
  title: string;
  description: string;
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
};

export type CollectionKind =
  | 'tag'
  | 'material'
  | 'style'
  | 'translation'
  | 'inventory'
  | 'personalization'
  | 'buyerPrice';

export type UploadKind = 'image' | 'file' | 'video';

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
  quantity: number | null;
  priceAmount: number | null;
  priceDivisor: number | null;
  taxonomyId: number | null;
  whoMade: string | null;
  whenMade: string | null;
  isSupply: boolean | null;
}) {
  return [
    normalize(listing.title) ? null : 'Title',
    normalize(listing.description) ? null : 'Description',
    listing.quantity !== null && listing.quantity > 0 ? null : 'Quantity',
    listing.priceAmount !== null && listing.priceDivisor !== null && listing.priceDivisor > 0 ? null : 'Price',
    listing.taxonomyId !== null ? null : 'Taxonomy',
    normalize(listing.whoMade) ? null : 'Who made it',
    normalize(listing.whenMade) ? null : 'When made',
    listing.isSupply !== null ? null : 'Supply type',
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
    },
  });

  if (!listing) {
    throw new Error('Listing not found.');
  }

  return {
    shop,
    section,
    subSection,
    listing,
  };
}

function mapEditorData(context: ListingEditorContext, data: Awaited<ReturnType<typeof getListingForContext>>): ListingEditorData {
  const missingUploadFields = getMissingUploadFields(data.listing);

  return {
    context,
    shop: {
      id: data.shop.etsyShopId.toString(),
      shopName: data.shop.shopName ?? data.shop.title ?? `Shop ${data.shop.etsyShopId}`,
    },
    section: {
      id: String(data.section.id),
      sectionName: data.section.title,
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
      listingType: 'download',
    },
    readyToUpload: missingUploadFields.length === 0,
    missingUploadFields,
    tags: data.listing.tags.map((tag) => ({ id: String(tag.id), value: tag.tag })),
    materials: data.listing.materials.map((material) => ({ id: String(material.id), value: material.material })),
    styles: data.listing.styles.map((style) => ({ id: String(style.id), value: style.style })),
    images: data.listing.images.map((image) => ({
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
  };
}

export async function getListingEditorData(context: ListingEditorContext) {
  try {
    return mapEditorData(context, await getListingForContext(context));
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

async function refresh(context: ListingEditorContext) {
  await prisma.etsyListing.update({
    where: { id: toInt(context.listingId, 'listing id') },
    data: { lastLocalChangeAt: new Date() },
  });

  const data = await getListingEditorData(context);

  if (!data) {
    throw new Error('Listing not found.');
  }

  return data;
}

export async function saveListingDetails(input: SaveListingDetailsInput) {
  const data = await getListingForContext(input);

  await prisma.etsyListing.update({
    where: {
      id: data.listing.id,
    },
    data: {
      title: normalize(input.title),
      description: normalize(input.description) || null,
      state: normalize(input.status) || null,
      quantity: input.quantity,
      priceAmount: input.priceAmount,
      priceDivisor: input.priceDivisor,
      priceCurrencyCode: normalize(input.priceCurrencyCode) || null,
      taxonomyId: input.taxonomyId,
      shopSectionId: input.shopSectionId,
      whoMade: normalize(input.whoMade) || null,
      whenMade: normalize(input.whenMade) || null,
      isSupply: input.isSupply,
      shouldAutoRenew: input.shouldAutoRenew,
      isPersonalizable: input.isPersonalizable,
      language: normalize(input.language) || null,
      primaryColour: normalizeEtsyColour(input.primaryColour),
      secondaryColour: normalizeEtsyColour(input.secondaryColour),
    },
  });

  return refresh(input);
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

  return refresh(context);
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

  return refresh(context);
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

  return refresh(context);
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
  const extension = path.extname(cleanFileName(originalFileName)).toLowerCase() || (kind === 'image' ? '.jpg' : '');

  if (kind === 'image' && !IMAGE_EXTENSIONS.has(extension)) {
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

  if (kind === 'image' && data.listing.images.length >= 20) {
    throw new Error('A listing can have no more than 20 images.');
  }

  const assetDirectory = kind === 'file' ? path.join(listingPath, 'downloads') : listingPath;
  await mkdir(assetDirectory, { recursive: true });
  const fileName = await nextAssetName(kind, data.listing.id, file.name, assetDirectory);
  const targetPath = path.join(assetDirectory, fileName);

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  await writeFile(targetPath, fileBuffer);

  if (kind === 'image') {
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

    await prisma.etsyListingFile.create({
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
      });
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

  return refresh(context);
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
  const existingIds = data.listing.images.map((image) => image.id);

  if (requestedIds.length !== existingIds.length || new Set(requestedIds).size !== requestedIds.length) {
    throw new Error('The image order must contain every listing image exactly once.');
  }
  if (requestedIds.some((id) => !existingIds.includes(id))) {
    throw new Error('The image order contains an image that does not belong to this listing.');
  }

  const imagesById = new Map(data.listing.images.map((image) => [image.id, image]));
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
        data: { lastLocalChangeAt: new Date() },
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
  const numericId = toInt(id, 'asset id');
  let localFileName: string | null = null;

  if (kind === 'image') {
    localFileName = (await prisma.etsyListingImage.findFirst({
      where: { id: numericId, listingId: data.listing.id },
      select: { localFileName: true },
    }))?.localFileName ?? null;
  } else if (kind === 'file') {
    localFileName = (await prisma.etsyListingFile.findFirst({
      where: { id: numericId, listingId: data.listing.id },
      select: { localFileName: true },
    }))?.localFileName ?? null;
  } else {
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
    contents: await readFile(path.join(listingPath, ...(kind === 'file' ? ['downloads'] : []), localFileName)),
    contentType: contentTypes[extension] ?? 'application/octet-stream',
  };
}

type DownloadZipAssignment = { fileId: string; zipNumber: number | null };

async function writeZipFile(targetPath: string, files: Array<{ path: string; name: string }>) {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(targetPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    files.forEach((file) => archive.file(file.path, { name: file.name }));
    void archive.finalize();
  });
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

export async function createListingZipFiles(context: ListingEditorContext, assignments: DownloadZipAssignment[]) {
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
  const generated: Array<{ zipNumber: number; fileName: string; tempPath: string; targetPath: string; sizeBytes: number }> = [];
  const zipBaseName = listingZipBaseName(data.listing.localDirectoryName ?? data.listing.title);

  try {
    for (const zipNumber of usedZipNumbers as number[]) {
    const groupedFiles = files.filter((file) => assignmentMap.get(file.id) === zipNumber && file.localFileName);
    const fileName = `${zipBaseName}_${zipNumber}.zip`;
    const targetPath = path.join(zippedDirectory, fileName);
    const tempPath = path.join(zippedDirectory, `.${fileName}.${randomUUID()}.tmp`);

    await writeZipFile(
      tempPath,
      groupedFiles.map((file) => ({ path: path.join(downloadsDirectory, file.localFileName!), name: file.originalFileName ?? file.localFileName! }))
    );
    const zipStats = await stat(tempPath);
    if (zipStats.size > ETSY_MAX_FILE_SIZE_BYTES) throw new Error(`Generated ZIP ${zipNumber} exceeds Etsy's 20 MB file limit.`);
    generated.push({ zipNumber, fileName, tempPath, targetPath, sizeBytes: zipStats.size });
    }

    await prisma.$transaction(async (tx) => {
      await Promise.all(files.map((file) => tx.etsyListingFile.update({
        where: { id: file.id },
        data: { zipNumber: assignmentMap.get(file.id)! },
      })));
      await tx.etsyListingZip.deleteMany({ where: { listingId: data.listing.id } });
      await Promise.all(generated.map((zip) => tx.etsyListingZip.create({
        data: { listingId: data.listing.id, zipNumber: zip.zipNumber, fileName: zip.fileName, sizeBytes: zip.sizeBytes },
      })));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    for (const zip of generated) {
      try { await unlink(zip.targetPath); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      await rename(zip.tempPath, zip.targetPath);
    }
    const generatedFileNames = new Set(generated.map((zip) => zip.fileName));
    for (const oldZip of data.listing.zippedFiles) {
      if (generatedFileNames.has(oldZip.fileName)) continue;
      try { await unlink(path.join(zippedDirectory, oldZip.fileName)); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
  } catch (error) {
    await Promise.all(generated.map(async (zip) => {
      try { await unlink(zip.tempPath); } catch { /* Temporary archive may already have been renamed. */ }
    }));
    throw error;
  }

  return refresh(context);
}

export async function reduceListingDownload(context: ListingEditorContext, fileId: string) {
  const { data, listingPath } = await getListingAssetDirectory(context);
  const numericFileId = toInt(fileId, 'file id');
  const file = data.listing.files.find((item) => item.id === numericFileId);

  if (!file?.localFileName) throw new Error('Download file not found.');

  const target = getNextPrintSize(file.widthPixels, file.heightPixels);
  if (!target) throw new Error('This file is already at its smallest supported size or does not match a supported print size.');

  const filePath = path.join(listingPath, 'downloads', file.localFileName);
  const resizedBuffer = await sharp(await readFile(filePath))
    .resize(target.width, target.height, { fit: 'inside', withoutEnlargement: true })
    .withMetadata({ density: 300 })
    .toBuffer();
  await writeFile(filePath, resizedBuffer);

  const metadata = await sharp(resizedBuffer).metadata();
  await prisma.etsyListingFile.update({
      where: { id: file.id },
      data: {
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
    });

  await prisma.etsyListingZip.deleteMany({ where: { listingId: data.listing.id } });
  await removeListingZipFiles(listingPath, data.listing.zippedFiles);

  return refresh(context);
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
  await writeFile(filePath, recompressedBuffer);

  const metadata = await sharp(recompressedBuffer).metadata();
  await prisma.etsyListingFile.update({
    where: { id: file.id },
    data: {
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
  });

  await prisma.etsyListingZip.deleteMany({ where: { listingId: data.listing.id } });
  await removeListingZipFiles(listingPath, data.listing.zippedFiles);

  return refresh(context);
}

export async function deleteListingAsset(context: ListingEditorContext, kind: UploadKind, id: string) {
  const { data, listingPath } = await getListingAssetDirectory(context);
  const numericId = toInt(id, 'asset id');
  let localFileName: string | null = null;

  if (kind === 'image') {
    const image = await prisma.etsyListingImage.findFirst({ where: { id: numericId, listingId: data.listing.id } });
    if (!image) throw new Error('Asset not found.');
    await prisma.etsyListingImage.delete({ where: { id: numericId } });
    localFileName = image.localFileName;
  } else if (kind === 'file') {
    const file = await prisma.etsyListingFile.findFirst({ where: { id: numericId, listingId: data.listing.id } });
    if (!file) throw new Error('Asset not found.');
    await prisma.etsyListingFile.delete({ where: { id: numericId } });
    localFileName = file.localFileName;
  } else {
    const video = await prisma.etsyListingVideo.findFirst({ where: { id: numericId, listingId: data.listing.id } });
    if (!video) throw new Error('Asset not found.');
    await prisma.etsyListingVideo.delete({ where: { id: numericId } });
    localFileName = video.localFileName;
  }

  if (localFileName) {
    try {
      await unlink(path.join(listingPath, ...(kind === 'file' ? ['downloads'] : []), localFileName));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }

  return refresh(context);
}

export async function deleteAllListingDownloads(context: ListingEditorContext) {
  const { data, listingPath } = await getListingAssetDirectory(context);

  await prisma.$transaction([
    prisma.etsyListingZip.deleteMany({ where: { listingId: data.listing.id } }),
    prisma.etsyListingFile.deleteMany({ where: { listingId: data.listing.id } }),
  ]);

  await Promise.all([
    rm(path.join(listingPath, 'downloads'), { recursive: true, force: true }),
    rm(path.join(listingPath, 'zipped'), { recursive: true, force: true }),
  ]);

  return refresh(context);
}
