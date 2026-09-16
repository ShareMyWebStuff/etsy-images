import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { inspectListingZipStorage } from '@/lib/dropbox-bundle';
import { getListingDirectoryPath, getSubSectionDirectoryPath } from '@/lib/local-shop-directory';
import { ensureListingProductDefaultsInTransaction } from '@/lib/listing-products';
import { prisma } from '@/lib/prisma';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from '@/lib/s3-listing-storage';

export type MultiListingWizardData = {
  subSection: { id: string; name: string; numberOfDownloads: number | null; includeAllDownloads: boolean };
  defaultSourceSectionId: string | null;
  sourceSections: Array<{
    id: string;
    name: string;
    sources: Array<{ id: string; name: string; description: string; primaryColour: string | null; secondaryColour: string | null }>;
  }>;
};

export type MultiListingConfiguration = {
  numberOfItems: number | null;
  includeAllItems: boolean;
  etsyProductType: 'physical' | 'digital';
};

const ALLOWED_ITEM_COUNTS = new Set([1, 3, 6, 12]);

type Context = {
  shop: { id: number; etsyShopId: bigint; displayName: string };
  section: { id: number; title: string; etsyShopSectionId: string | null };
  subSection: { id: number; name: string; numberOfDownloads: number | null; includeAllDownloads: boolean };
};

function resolveMultiListingConfiguration(
  context: Context,
  requested?: MultiListingConfiguration
): MultiListingConfiguration {
  const includeAllItems = requested?.includeAllItems ?? context.subSection.includeAllDownloads;
  const numberOfItems = includeAllItems
    ? null
    : requested?.numberOfItems ?? context.subSection.numberOfDownloads ?? 1;
  const etsyProductType = requested?.etsyProductType ?? 'physical';

  if (!includeAllItems && !ALLOWED_ITEM_COUNTS.has(numberOfItems ?? 0)) {
    throw new Error('Choose 1, 3, 6, 12, or All items.');
  }
  if (etsyProductType !== 'physical' && etsyProductType !== 'digital') {
    throw new Error('Choose a Physical or Digital Etsy product.');
  }

  return { numberOfItems, includeAllItems, etsyProductType };
}

async function getContext(shopId: string, sectionId: string, subSectionId: string): Promise<Context> {
  const etsyShopId = BigInt(shopId);
  const sectionNumber = Number(sectionId);
  const subSectionNumber = Number(subSectionId);
  if (!Number.isInteger(sectionNumber) || !Number.isInteger(subSectionNumber)) throw new Error('Invalid listing context.');

  const shop = await prisma.etsyShop.findUnique({
    where: { etsyShopId },
    select: { id: true, etsyShopId: true, shopName: true, title: true },
  });
  if (!shop) throw new Error('Shop not found.');

  const section = await prisma.etsyShopSection.findFirst({
    where: { id: sectionNumber, OR: [{ shopId: shop.id }, { etsyShopId: shop.etsyShopId }] },
    select: { id: true, title: true, etsyShopSectionId: true },
  });
  if (!section) throw new Error('Section not found.');

  const subSection = await prisma.etsyShopSubSection.findFirst({
    where: { id: subSectionNumber, shopSectionId: section.id },
    select: { id: true, name: true, numberOfDownloads: true, includeAllDownloads: true },
  });
  if (!subSection) throw new Error('Sub section not found.');

  return {
    shop: { id: shop.id, etsyShopId: shop.etsyShopId, displayName: shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}` },
    section,
    subSection,
  };
}

export async function getMultiListingWizardData(
  shopId: string,
  sectionId: string,
  subSectionId: string
): Promise<MultiListingWizardData | null> {
  try {
    const context = await getContext(shopId, sectionId, subSectionId);
    const targetSection = await prisma.etsyShopSection.findUnique({
      where: { id: context.section.id },
      select: { sourceSectionId: true },
    });
    const sourceSections = await prisma.etsyShopSection.findMany({
      where: {
        OR: [{ shopId: context.shop.id }, { etsyShopId: context.shop.etsyShopId }],
        numberOfDownloads: 1,
        includeAllDownloads: false,
      },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        subSections: { select: { listings: {
          where: { localDirectoryName: { not: null } },
          orderBy: { localDirectoryName: 'asc' },
          select: {
            id: true,
            localDirectoryName: true,
            primaryColour: true,
            secondaryColour: true,
            localProfile: { select: { name: true, description: true } },
          },
        } } },
      },
    });

    return {
      subSection: {
        id: String(context.subSection.id),
        name: context.subSection.name,
        numberOfDownloads: context.subSection.numberOfDownloads,
        includeAllDownloads: context.subSection.includeAllDownloads,
      },
      defaultSourceSectionId: targetSection?.sourceSectionId ? String(targetSection.sourceSectionId) : null,
      sourceSections: sourceSections.map((section) => ({
        id: String(section.id),
        name: section.title,
        sources: section.subSections.flatMap((subSection) => subSection.listings).map((listing) => ({
          id: String(listing.id), name: listing.localProfile?.name ?? listing.localDirectoryName!, description: listing.localProfile?.description ?? '',
          primaryColour: listing.primaryColour, secondaryColour: listing.secondaryColour,
        })),
      })),
    };
  } catch {
    return null;
  }
}

async function getSourceSection(context: Context, sourceSectionId: string) {
  const id = Number(sourceSectionId);
  if (!Number.isInteger(id)) throw new Error('Choose a valid source section.');
  const section = await prisma.etsyShopSection.findFirst({
    where: {
      id,
      OR: [{ shopId: context.shop.id }, { etsyShopId: context.shop.etsyShopId }],
      numberOfDownloads: 1,
      includeAllDownloads: false,
    },
    select: { id: true, title: true },
  });
  if (!section) throw new Error('Choose a one-download source section.');
  return section;
}

function cleanPart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
}

async function exists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

type ComparableDropboxRow = {
  sourceListingId: number | null;
  sourceDirectoryName: string;
  groupNumber: number;
  localFileName: string;
  originalFileName: string | null;
  sizeBytes: number | null;
};

function isDropboxInstructionPdf(file: {
  localFileName: string | null;
  filename?: string | null;
  rawJson: Prisma.JsonValue;
}) {
  if (file.rawJson && typeof file.rawJson === 'object' && !Array.isArray(file.rawJson)) {
    const metadata = file.rawJson as Record<string, unknown>;
    if (metadata.kind === 'dropbox_instruction_pdf' || typeof metadata.dropboxSharedUrl === 'string') return true;
  }
  return /^CosyHousePrints_Download_Instructions(?:_\d+)?\.pdf$/i.test(
    file.localFileName ?? file.filename ?? '',
  );
}

function comparableDropboxRows(rows: ComparableDropboxRow[]) {
  return rows.map((row) => ({
    sourceListingId: row.sourceListingId,
    sourceDirectoryName: row.sourceDirectoryName,
    groupNumber: row.groupNumber,
    localFileName: row.localFileName,
    originalFileName: row.originalFileName ?? '',
    sizeBytes: row.sizeBytes,
  }));
}

async function readOptionalFile(filePath: string) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function groupedDownloadFilesChanged(
  existingRows: ComparableDropboxRow[],
  nextRows: ComparableDropboxRow[],
  finalPath: string,
  stagingPath: string,
) {
  if (JSON.stringify(comparableDropboxRows(existingRows)) !== JSON.stringify(comparableDropboxRows(nextRows))) {
    return true;
  }

  const names = [...new Set([...nextRows.map(({ localFileName }) => localFileName), 'HowToPrintGuide.txt'])];
  for (const name of names) {
    const [existingFile, nextFile] = await Promise.all([
      readOptionalFile(path.join(finalPath, 'dropboxDownloads', name)),
      readOptionalFile(path.join(stagingPath, 'dropboxDownloads', name)),
    ]);
    if (existingFile === null || nextFile === null) {
      if (existingFile !== nextFile) return true;
      continue;
    }
    if (!existingFile.equals(nextFile)) return true;
  }
  return false;
}

export function hasCompleteEtsyImageRanks(
  images: Array<{ rank: number | null; localFileName: string | null }>,
) {
  const activeImages = images.filter((image) =>
    image.localFileName?.trim()
      && image.rank !== null
      && Number.isInteger(image.rank)
      && image.rank >= 1
      && image.rank <= 10
  );
  const activeRanks = new Set(activeImages.map(({ rank }) => rank));
  return activeImages.length === 10
    && activeRanks.size === 10
    && Array.from({ length: 10 }, (_, index) => index + 1).every((rank) => activeRanks.has(rank));
}

export async function validateMultiListingName(
  contextInput: { shopId: string; sectionId: string; subSectionId: string; sourceSectionId: string },
  requestedName: string,
  requestedConfiguration?: MultiListingConfiguration
) {
  const context = await getContext(contextInput.shopId, contextInput.sectionId, contextInput.subSectionId);
  const configuration = resolveMultiListingConfiguration(context, requestedConfiguration);
  const sourceSection = await getSourceSection(context, contextInput.sourceSectionId);
  const listingName = requestedName.trim();
  if (!listingName) throw new Error('Enter a listing name.');
  const listingPath = getListingDirectoryPath(
    context.shop.displayName,
    context.section.title,
    context.subSection.name,
    listingName
  );
  const allDownloadSourceCount = configuration.includeAllItems
    ? await prisma.etsyListing.count({
        where: { subSection: { shopSectionId: sourceSection.id } },
      })
    : 0;
  const generatedImageCount = configuration.includeAllItems
    ? Math.min(10, 6 + Math.ceil(allDownloadSourceCount / 16))
    : configuration.numberOfItems === 12
      ? 8
      : configuration.numberOfItems === 6
        ? 4
        : configuration.numberOfItems === 3
          ? 2
          : 0;
  const duplicate = await prisma.etsyListing.findFirst({
    where: {
      subSectionId: context.subSection.id,
      localDirectoryName: listingName,
    },
    select: {
      id: true,
      title: true,
      description: true,
      priceAmount: true,
      priceDivisor: true,
      quantity: true,
      primaryColour: true,
      secondaryColour: true,
      tags: { orderBy: { position: 'asc' }, select: { tag: true } },
      images: {
        where: { rank: { in: Array.from({ length: generatedImageCount }, (_, index) => index + 1) }, localFileName: { not: null } },
        orderBy: { rank: 'asc' },
        select: { rank: true, localFileName: true },
      },
      dropboxFiles: {
        where: { sourceListingId: { not: null } },
        orderBy: [{ groupNumber: 'asc' }, { id: 'asc' }],
        select: { sourceListingId: true },
      },
    },
  });
  return {
    listingName,
    willReplace: Boolean(duplicate) || await exists(listingPath),
    existing: duplicate ? {
      title: duplicate.title,
      description: duplicate.description ?? '',
      price: duplicate.priceAmount === null
        ? ''
        : String(duplicate.priceAmount / (duplicate.priceDivisor || 100)),
      quantity: duplicate.quantity === null ? '' : String(duplicate.quantity),
      primaryColour: duplicate.primaryColour ?? '',
      secondaryColour: duplicate.secondaryColour ?? '',
      tags: duplicate.tags.map(({ tag }) => tag),
      sourceIds: [...new Set(duplicate.dropboxFiles.flatMap(({ sourceListingId }) => sourceListingId === null ? [] : [String(sourceListingId)]))],
      imageNames: Array.from({ length: generatedImageCount }, (_, index) => index + 1)
        .map((rank) => duplicate.images.find((image) => image.rank === rank)?.localFileName ?? null),
    } : null,
  };
}

export async function completeMultiListing(
  contextInput: { shopId: string; sectionId: string; subSectionId: string },
  listingId: string
) {
  const context = await getContext(contextInput.shopId, contextInput.sectionId, contextInput.subSectionId);
  const numericListingId = Number(listingId);
  if (!Number.isInteger(numericListingId)) throw new Error('Invalid listing id.');
  const listing = await prisma.etsyListing.findFirst({
    where: {
      id: numericListingId,
      subSectionId: context.subSection.id,
      dropboxBundle: { isNot: null },
    },
    select: {
      id: true,
      etsyId: true,
      title: true,
      localDirectoryName: true,
      description: true,
      quantity: true,
      primaryColour: true,
      secondaryColour: true,
      thumbnailFileName: true,
      tags: { select: { id: true } },
      images: { select: { localFileName: true, rank: true } },
      files: { select: { localFileName: true, rawJson: true } },
      zippedFiles: { select: { fileName: true, sizeBytes: true } },
      dropboxFiles: {
        select: {
          groupNumber: true,
          sourceListingId: true,
          sourceDirectoryName: true,
          localFileName: true,
          originalFileName: true,
        },
      },
      dropboxBundle: { select: { id: true } },
      productConfig: { select: { id: true } },
      products: { select: { id: true } },
      downloadsRevision: true,
      zippedRevision: true,
      dropboxRevision: true,
      dropboxSyncedAt: true,
      hasEverZipped: true,
      numberOfItems: true,
      includeAllItems: true,
    },
  });
  if (!listing) throw new Error('Listing not found.');
  const hasDropboxPdf = listing.files.some(isDropboxInstructionPdf);
  if (!listing.dropboxBundle || !hasDropboxPdf) {
    throw new Error('Create the Dropbox bundle and download PDF before completing the listing.');
  }
  const listingPath = getListingDirectoryPath(
    context.shop.displayName,
    context.section.title,
    context.subSection.name,
    listing.localDirectoryName ?? `Listing-${listing.id}`,
  );
  const currentZips = (await inspectListingZipStorage(listing, listingPath)).valid;
  const currentDropbox = listing.dropboxBundle !== null
    && listing.dropboxSyncedAt !== null
    && listing.dropboxRevision === listing.downloadsRevision;
  const hasFinishedListing = Boolean(listing.thumbnailFileName?.trim())
    && hasCompleteEtsyImageRanks(listing.images)
    && currentZips
    && currentDropbox
    && listing.productConfig !== null
    && listing.products.length > 0
    && listing.tags.length > 0
    && Boolean(listing.title.trim())
    && Boolean(listing.description?.trim())
    && (listing.quantity ?? 0) > 0
    && Boolean(listing.primaryColour?.trim());
  if (listing.etsyId === null) {
    await prisma.etsyListing.update({
      where: { id: listing.id },
      data: { state: hasFinishedListing ? 'complete' : 'local' },
    });
  }
  return { completed: true, isComplete: hasFinishedListing };
}

async function loadExistingMultiListing(context: Context, listingName: string) {
  const existing = await prisma.etsyListing.findFirst({
    where: {
      subSectionId: context.subSection.id,
      localDirectoryName: listingName,
    },
    select: {
      id: true,
      etsyId: true, state: true, url: true, rawJson: true, shopSectionId: true, etsyProductType: true,
      lastSyncedAt: true, downloadedAt: true,
      downloadsRevision: true, zippedRevision: true, hasEverZipped: true,
      dropboxRevision: true, dropboxSyncedAt: true,
      thumbnailFileName: true,
      images: {
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          rank: true,
          localFileName: true,
          originalFileName: true,
          fullWidth: true,
          fullHeight: true,
          etsyImageId: true,
        },
      },
      files: {
        select: {
          localFileName: true,
          originalFileName: true,
          filename: true,
          filetype: true,
          filesize: true,
          sizeBytes: true,
          rank: true,
          rawJson: true,
          etsyListingFileId: true,
        },
      },
      dropboxFiles: {
        orderBy: [{ groupNumber: 'asc' }, { id: 'asc' }],
        select: {
          sourceListingId: true,
          sourceDirectoryName: true,
          groupNumber: true,
          localFileName: true,
          originalFileName: true,
          sizeBytes: true,
        },
      },
      dropboxBundle: { select: { folderPath: true, sharedUrl: true } },
    },
  });
  return existing;
}

type DesiredListingImage = {
  localFileName: string;
  originalFileName: string;
  rank: number;
  fullWidth?: number;
  fullHeight?: number;
};

type ExistingListingImage = {
  id: number;
  rank: number | null;
  localFileName: string | null;
  etsyImageId: string | null;
};

type PreparedListingImage = DesiredListingImage & {
  existingId: number | null;
  etsyImageId: string | null;
  bytesChanged: boolean;
};

async function prepareDesiredListingImages(
  existingImages: ExistingListingImage[],
  desiredImages: DesiredListingImage[],
  finalPath: string,
  stagingPath: string,
): Promise<PreparedListingImage[]> {
  if (!hasCompleteEtsyImageRanks(desiredImages)) {
    throw new Error('A multi-item listing must contain one image in every Etsy rank from 1 to 10.');
  }
  const existingByRank = new Map<number, ExistingListingImage>();
  for (const image of existingImages) {
    if (image.rank !== null && image.rank >= 1 && image.rank <= 10 && !existingByRank.has(image.rank)) {
      existingByRank.set(image.rank, image);
    }
  }

  const prepared: PreparedListingImage[] = [];
  for (const desired of desiredImages) {
    const existing = existingByRank.get(desired.rank) ?? null;
    let bytesChanged = true;
    if (existing?.localFileName) {
      const [currentBytes, desiredBytes] = await Promise.all([
        readOptionalFile(path.join(finalPath, existing.localFileName)),
        readOptionalFile(path.join(stagingPath, desired.localFileName)),
      ]);
      bytesChanged = currentBytes === null || desiredBytes === null || !currentBytes.equals(desiredBytes);
    }
    prepared.push({
      ...desired,
      existingId: existing?.id ?? null,
      etsyImageId: bytesChanged ? null : existing?.etsyImageId ?? null,
      bytesChanged,
    });
  }
  return prepared;
}

async function persistDesiredListingImages(
  tx: Prisma.TransactionClient,
  listingId: number,
  images: PreparedListingImage[],
) {
  for (const image of images) {
    const data = {
      localFileName: image.localFileName,
      originalFileName: image.originalFileName,
      rank: image.rank,
      fullWidth: image.fullWidth ?? null,
      fullHeight: image.fullHeight ?? null,
      etsyImageId: image.etsyImageId,
      ...(image.bytesChanged ? {
        url75x75: null,
        url170x135: null,
        url570xN: null,
        urlFullxFull: null,
      } : {}),
    };
    if (image.existingId !== null) {
      await tx.etsyListingImage.update({ where: { id: image.existingId }, data });
    } else {
      await tx.etsyListingImage.create({ data: { listingId, ...data } });
    }
  }
}

async function preserveThumbnail(
  existing: Awaited<ReturnType<typeof loadExistingMultiListing>>,
  finalPath: string,
  stagingPath: string
) {
  if (!existing?.thumbnailFileName) return;
  const sourcePath = path.join(finalPath, 'thumbnail', existing.thumbnailFileName);
  if (!await exists(sourcePath)) return;
  const targetDirectory = path.join(stagingPath, 'thumbnail');
  await mkdir(targetDirectory, { recursive: true });
  await copyFile(sourcePath, path.join(targetDirectory, existing.thumbnailFileName));
}

async function preserveLegacyListingImages(
  existing: Awaited<ReturnType<typeof loadExistingMultiListing>>,
  finalPath: string,
  stagingPath: string,
) {
  if (!existing) return;
  for (const image of existing.images) {
    if (image.rank === null || image.rank <= 10 || !image.localFileName) continue;
    const sourcePath = path.join(finalPath, image.localFileName);
    const destinationPath = path.join(stagingPath, image.localFileName);
    if (!await exists(sourcePath) || await exists(destinationPath)) continue;
    await copyFile(sourcePath, destinationPath);
  }
}

async function installStagedListingDirectory(stagingPath: string, finalPath: string) {
  if (!await exists(finalPath)) {
    try {
      await rename(stagingPath, finalPath);
      return null;
    } catch (installError) {
      // A failed S3 copy can leave a partial destination even though the source
      // staging prefix still exists.
      await rm(finalPath, { recursive: true, force: true });
      throw installError;
    }
  }

  const backupPath = `${finalPath}.replaced-${randomUUID()}`;
  await rename(finalPath, backupPath);
  try {
    await rename(stagingPath, finalPath);
    return backupPath;
  } catch (installError) {
    await restorePreviousListingDirectory(finalPath, backupPath, 'staged directory install', installError);
    throw installError;
  }
}

async function restorePreviousListingDirectory(
  finalPath: string,
  backupPath: string,
  operation: string,
  originalError: unknown,
) {
  try {
    // S3 directory renames are copy/delete operations. A failed copy can leave a
    // partial destination, so the destination must be empty before restoration.
    await rm(finalPath, { recursive: true, force: true });
    await rename(backupPath, finalPath);
  } catch (restoreError) {
    const evidencePath = `${backupPath}.recovery-${randomUUID()}.json`;
    try {
      await writeFile(evidencePath, JSON.stringify({
        operation,
        finalPath,
        backupPath,
        originalError: originalError instanceof Error ? originalError.message : String(originalError),
        restoreError: restoreError instanceof Error ? restoreError.message : String(restoreError),
        recordedAt: new Date().toISOString(),
      }, null, 2), 'utf8');
    } catch (evidenceError) {
      console.error(`Unable to write listing recovery evidence ${evidencePath}:`, evidenceError);
    }
    throw new Error(
      `Unable to restore the previous listing directory after ${operation}. `
        + `The backup remains at ${backupPath}; recovery evidence: ${evidencePath}.`,
      { cause: restoreError },
    );
  }
}

async function rollbackStagedListingDirectory(
  finalPath: string,
  backupPath: string | null,
  originalError: unknown,
) {
  if (!backupPath) {
    await rm(finalPath, { recursive: true, force: true });
    return;
  }
  await restorePreviousListingDirectory(finalPath, backupPath, 'database transaction rollback', originalError);
}

export async function createThreeItemListing(
  contextInput: { shopId: string; sectionId: string; subSectionId: string; sourceSectionId: string },
  input: {
    sourceIds: string[];
    listingName: string;
    title: string;
    description: string;
    price: number;
    quantity: number;
    primaryColour: string;
    secondaryColour: string;
    tags: string[];
    bedroomImage: File | null;
    playroomImage: File | null;
    numberOfItems: number | null;
    includeAllItems: boolean;
    etsyProductType: 'physical' | 'digital';
  }
) {
  const context = await getContext(contextInput.shopId, contextInput.sectionId, contextInput.subSectionId);
  const configuration = resolveMultiListingConfiguration(context, input);
  const sourceSection = await getSourceSection(context, contextInput.sourceSectionId);
  if (configuration.numberOfItems !== 3 || configuration.includeAllItems) {
    throw new Error('This creation flow is only available when No of Items is 3.');
  }
  if (input.sourceIds.length !== 3 || new Set(input.sourceIds).size !== 3) throw new Error('Select 3 items.');
  const title = input.title.trim();
  const listingName = input.listingName.trim();
  const description = input.description.trim();
  await validateMultiListingName(contextInput, listingName, configuration);
  if (!title || !description) throw new Error('Enter a title and description.');
  if (!Number.isFinite(input.price) || input.price < 0) throw new Error('Enter a valid price.');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('Enter a valid quantity.');

  const sourceIds = input.sourceIds.map(Number);
  const sources = await prisma.etsyListing.findMany({
    where: {
      id: { in: sourceIds },
      subSection: { shopSectionId: sourceSection.id },
    },
    include: {
      images: { where: { localFileName: { not: null } }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] },
      files: { where: { localFileName: { not: null } }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] },
      subSection: true,
    },
  });
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const orderedSources = sourceIds.map((id) => sourceById.get(id));
  if (orderedSources.some((source) => !source)) throw new Error('One or more selected items could not be found.');

  const finalPath = getListingDirectoryPath(context.shop.displayName, context.section.title, context.subSection.name, listingName);
  const preserved = await loadExistingMultiListing(context, listingName);

  const subSectionPath = getSubSectionDirectoryPath(context.shop.displayName, context.section.title, context.subSection.name);
  await mkdir(subSectionPath, { recursive: true });
  const stagingPath = path.join(subSectionPath, `.creating-${randomUUID()}`);
  const downloadsPath = path.join(stagingPath, 'dropboxDownloads');
  await mkdir(downloadsPath, { recursive: true });

  const imageRows: Array<{ localFileName: string; originalFileName: string; rank: number; fullWidth?: number; fullHeight?: number }> = [];
  const dropboxRows: Array<{
    sourceListingId: number; sourceDirectoryName: string; groupNumber: number;
    localFileName: string; originalFileName: string; sizeBytes: number | null;
  }> = [];

  try {
    const generatedUploads = [input.bedroomImage, input.playroomImage];
    for (const [rank, uploaded] of generatedUploads.entries()) {
      if (uploaded) {
        if (!uploaded.type.startsWith('image/')) throw new Error('Only image uploads are allowed.');
        const extension = path.extname(uploaded.name).toLowerCase() || '.jpg';
        const localFileName = `image_${rank + 1}${extension}`;
        const buffer = Buffer.from(await uploaded.arrayBuffer());
        const metadata = await sharp(buffer).metadata();
        await writeFile(path.join(stagingPath, localFileName), buffer);
        imageRows.push({
          localFileName,
          originalFileName: uploaded.name,
          rank: rank + 1,
          fullWidth: metadata.width,
          fullHeight: metadata.height,
        });
        continue;
      }

      const existingImage = preserved?.images.find((image) => image.rank === rank + 1);
      const existingImagePath = existingImage?.localFileName
        ? path.join(finalPath, existingImage.localFileName)
        : null;
      if (!existingImage?.localFileName || !existingImagePath || !await exists(existingImagePath)) {
        throw new Error(`Upload generated image ${rank + 1}; no existing image is available to retain.`);
      }
      await copyFile(existingImagePath, path.join(stagingPath, existingImage.localFileName));
      imageRows.push({
        localFileName: existingImage.localFileName,
        originalFileName: existingImage.originalFileName ?? existingImage.localFileName,
        rank: rank + 1,
        fullWidth: existingImage.fullWidth ?? undefined,
        fullHeight: existingImage.fullHeight ?? undefined,
      });
    }

    const imagePlan = [
      [0, 0], [1, 0], [2, 0],
      [0, 1], [1, 1], [2, 1],
      [0, 2], [1, 2],
    ];
    for (let index = 0; index < imagePlan.length; index += 1) {
      const [sourceIndex, sourceImageIndex] = imagePlan[index];
      const source = orderedSources[sourceIndex]!;
      const sourceImage = source.images[sourceImageIndex];
      if (!sourceImage?.localFileName || !source.subSection) {
        throw new Error(`${source.localDirectoryName ?? source.title} is missing image_${sourceImageIndex + 1}.`);
      }
      const sourcePath = getListingDirectoryPath(
        context.shop.displayName, sourceSection.title, source.subSection.name,
        source.localDirectoryName ?? `Listing-${source.id}`
      );
      const extension = path.extname(sourceImage.localFileName);
      const localFileName = `image_${index + 3}${extension}`;
      await copyFile(path.join(sourcePath, sourceImage.localFileName), path.join(stagingPath, localFileName));
      imageRows.push({
        localFileName,
        originalFileName: sourceImage.originalFileName ?? sourceImage.localFileName,
        rank: index + 3,
        fullWidth: sourceImage.fullWidth ?? undefined,
        fullHeight: sourceImage.fullHeight ?? undefined,
      });
    }

    let printGuideCopied = false;
    for (let sourceIndex = 0; sourceIndex < orderedSources.length; sourceIndex += 1) {
      const source = orderedSources[sourceIndex]!;
      const sourceDirectoryName = source.localDirectoryName ?? source.title;
      const sourcePath = getListingDirectoryPath(
        context.shop.displayName, sourceSection.title, source.subSection!.name,
        sourceDirectoryName
      );
      for (const file of source.files) {
        const originalName = file.originalFileName ?? file.localFileName!;
        const extension = path.extname(file.localFileName!).toLocaleLowerCase();
        if (extension === '.txt') {
          if (!printGuideCopied) {
            await copyFile(
              path.join(sourcePath, 'downloads', file.localFileName!),
              path.join(downloadsPath, 'HowToPrintGuide.txt')
            );
            printGuideCopied = true;
          }
          continue;
        }
        if (!['.jpg', '.jpeg', '.png'].includes(extension)) continue;
        const localFileName = `${cleanPart(sourceDirectoryName)}_${cleanPart(file.localFileName!)}`;
        await copyFile(path.join(sourcePath, 'downloads', file.localFileName!), path.join(downloadsPath, localFileName));
        dropboxRows.push({
          sourceListingId: source.id,
          sourceDirectoryName,
          groupNumber: sourceIndex + 1,
          localFileName,
          originalFileName: originalName,
          sizeBytes: file.sizeBytes,
        });
      }
    }
    if (!printGuideCopied) {
      throw new Error('The selected source listings are missing HowToPrintGuide.txt. Add it before creating this listing.');
    }

    await Promise.all([
      writeFile(path.join(stagingPath, 'title.txt'), title, 'utf8'),
      writeFile(path.join(stagingPath, 'description.txt'), description, 'utf8'),
      writeFile(path.join(stagingPath, 'tags.txt'), input.tags.join('\n'), 'utf8'),
    ]);

    await preserveThumbnail(preserved, finalPath, stagingPath);
    await preserveLegacyListingImages(preserved, finalPath, stagingPath);
    const filesChanged = preserved
      ? await groupedDownloadFilesChanged(preserved.dropboxFiles, dropboxRows, finalPath, stagingPath)
      : false;
    const preservedZips: Array<{ groupNumber: number; sourceDirectoryName: string; fileName: string; sizeBytes: number }> = [];
    if (preserved && !filesChanged) {
      const existingZipsPath = path.join(finalPath, 'dropboxZipped');
      const stagedZipsPath = path.join(stagingPath, 'dropboxZipped');
      try {
        const zipDetails = orderedSources.map((source, index) => ({
          groupNumber: index + 1,
          sourceDirectoryName: source!.localDirectoryName ?? source!.title,
          fileName: `${String(index + 1).padStart(2, '0')}-${cleanPart(source!.localDirectoryName ?? source!.title)}.zip`,
        }));
        const zipStats = await Promise.all(zipDetails.map((zip) => stat(path.join(existingZipsPath, zip.fileName))));
        await mkdir(stagedZipsPath, { recursive: true });
        await Promise.all(zipDetails.map((zip) => copyFile(
          path.join(existingZipsPath, zip.fileName),
          path.join(stagedZipsPath, zip.fileName),
        )));
        preservedZips.push(...zipDetails.map((zip, index) => ({ ...zip, sizeBytes: zipStats[index].size })));
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    const existingPdf = preserved?.files.find(isDropboxInstructionPdf);
    let pdfPreserved = false;
    if (!filesChanged && existingPdf?.localFileName) {
      try {
        const stagedDownloadsPath = path.join(stagingPath, 'downloads');
        await mkdir(stagedDownloadsPath, { recursive: true });
        await copyFile(
          path.join(finalPath, 'downloads', existingPdf.localFileName),
          path.join(stagedDownloadsPath, existingPdf.localFileName),
        );
        pdfPreserved = true;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    const priceAmount = Math.round(input.price * 100);
    const listingData = {
      shopId: context.shop.etsyShopId.toString(),
      shopSectionId: context.section.etsyShopSectionId === null ? null : Number(context.section.etsyShopSectionId),
      title,
      description,
      etsyId: preserved?.etsyId ?? null,
      state: preserved?.state ?? 'local',
      url: preserved?.url ?? null,
      quantity: input.quantity,
      priceAmount,
      priceDivisor: 100,
      priceCurrencyCode: 'GBP',
      taxonomyId: configuration.etsyProductType === 'physical' ? 121 : 2078,
      whoMade: 'i_did',
      isSupply: false,
      whenMade: '2020_2026',
      shouldAutoRenew: true,
      language: 'en-US',
      primaryColour: input.primaryColour || null,
      secondaryColour: input.secondaryColour || null,
      subSectionId: context.subSection.id,
      sourceSectionId: sourceSection.id,
      localDirectoryName: listingName,
      isLocal: true,
      numberOfItems: configuration.numberOfItems,
      includeAllItems: configuration.includeAllItems,
      etsyProductType: configuration.etsyProductType,
      rawJson: preserved?.rawJson === null || preserved?.rawJson === undefined ? Prisma.JsonNull : preserved.rawJson,
      lastSyncedAt: preserved?.lastSyncedAt ?? null,
      detailsChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      tagsChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      imagesChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      downloadsChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      productsChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      downloadedAt: preserved?.downloadedAt ?? new Date(),
      downloadsRevision: !preserved || filesChanged
        ? (preserved?.downloadsRevision ?? 0) + 1
        : preserved.downloadsRevision,
      zippedRevision: !preserved || filesChanged ? 0 : preserved.zippedRevision,
      hasEverZipped: preserved?.hasEverZipped ?? false,
      dropboxRevision: !preserved || filesChanged ? 0 : preserved.dropboxRevision,
      dropboxSyncedAt: !preserved || filesChanged ? null : preserved.dropboxSyncedAt,
    };
    const tagsToCreate = input.tags.map((tag, position) => ({ tag, position: position + 1 }));
    const preparedImages = await prepareDesiredListingImages(
      preserved?.images ?? [],
      imageRows,
      finalPath,
      stagingPath,
    );
    const filesToCreate = pdfPreserved && existingPdf ? [{
      localFileName: existingPdf.localFileName,
      originalFileName: existingPdf.originalFileName,
      filename: existingPdf.filename,
      filetype: existingPdf.filetype,
      filesize: existingPdf.filesize,
      sizeBytes: existingPdf.sizeBytes,
      rank: existingPdf.rank,
      etsyListingFileId: existingPdf.etsyListingFileId,
      rawJson: existingPdf.rawJson === null ? Prisma.JsonNull : existingPdf.rawJson,
    }] : [];
    const replacedDirectory = await installStagedListingDirectory(stagingPath, finalPath);
    let listing: { id: number };
    try {
      listing = await prisma.$transaction(async (tx) => {
        const saved = preserved
          ? await tx.etsyListing.update({
              where: { id: preserved.id },
              data: {
                ...listingData,
                tags: { deleteMany: {}, create: tagsToCreate },
                files: { deleteMany: {}, create: filesToCreate },
                ...(filesChanged ? { zippedFiles: { deleteMany: {} } } : {}),
                dropboxFiles: { deleteMany: {}, create: dropboxRows },
              },
              select: { id: true },
            })
          : await tx.etsyListing.create({
              data: {
                ...listingData,
                tags: { create: tagsToCreate },
                files: { create: filesToCreate },
                dropboxFiles: { create: dropboxRows },
              },
              select: { id: true },
            });
        await persistDesiredListingImages(tx, saved.id, preparedImages);
        await ensureListingProductDefaultsInTransaction(
          tx,
          saved.id,
          preserved && preserved.etsyProductType !== configuration.etsyProductType
            ? { resetToProductType: configuration.etsyProductType }
            : undefined,
        );
        return saved;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await rollbackStagedListingDirectory(finalPath, replacedDirectory, error);
      throw error;
    }
    if (replacedDirectory) {
      try {
        await rm(replacedDirectory, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Unable to remove replaced listing backup ${replacedDirectory}:`, error);
      }
    }
    return {
      listingId: String(listing.id),
      groups: orderedSources.map((source, index) => ({
        groupNumber: index + 1,
        sourceDirectoryName: source!.localDirectoryName ?? source!.title,
        fileCount: dropboxRows.filter((row) => row.groupNumber === index + 1).length,
      })),
      zips: preservedZips,
      filesChanged: !preserved || filesChanged,
      dropbox: preserved?.dropboxBundle ?? null,
      pdfCreated: pdfPreserved,
    };
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

export async function createSixItemListing(
  contextInput: { shopId: string; sectionId: string; subSectionId: string; sourceSectionId: string },
  input: {
    sourceIds: string[]; listingName: string; title: string; description: string; price: number; quantity: number;
    primaryColour: string; secondaryColour: string; tags: string[]; uploadedImages: Array<File | null>;
    numberOfItems: number | null; includeAllItems: boolean; etsyProductType: 'physical' | 'digital';
  }
) {
  const context = await getContext(contextInput.shopId, contextInput.sectionId, contextInput.subSectionId);
  const configuration = resolveMultiListingConfiguration(context, input);
  const sourceSection = await getSourceSection(context, contextInput.sourceSectionId);
  const isAllDownloads = configuration.includeAllItems;
  const itemCount = isAllDownloads ? input.sourceIds.length : configuration.numberOfItems;
  if (!isAllDownloads && itemCount !== 6 && itemCount !== 12) {
    throw new Error('This creation flow is only available when No of Items is 6, 12, or All.');
  }
  if (!itemCount || itemCount < 1) throw new Error('No source listings were selected.');
  const generatedImageCount = isAllDownloads ? Math.min(10, 6 + Math.ceil(itemCount / 16)) : itemCount === 12 ? 8 : 4;
  if (input.sourceIds.length !== itemCount || new Set(input.sourceIds).size !== itemCount) throw new Error(`Select ${itemCount} items.`);
  if (input.uploadedImages.length !== generatedImageCount) throw new Error(`Provide all ${generatedImageCount} generated image slots.`);
  const title = input.title.trim();
  const listingName = input.listingName.trim();
  const description = input.description.trim();
  await validateMultiListingName(contextInput, listingName, configuration);
  if (!title || !description) throw new Error('Enter a title and description.');
  if (!Number.isFinite(input.price) || input.price < 0) throw new Error('Enter a valid price.');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('Enter a valid quantity.');

  const sourceIds = input.sourceIds.map(Number);
  if (isAllDownloads) {
    const allSources = await prisma.etsyListing.findMany({
      where: { subSection: { shopSectionId: sourceSection.id } },
      select: { id: true },
    });
    const selected = new Set(sourceIds);
    if (allSources.length !== sourceIds.length || allSources.some(({ id }) => !selected.has(id))) {
      throw new Error('All source listings must be selected.');
    }
  }
  const sources = await prisma.etsyListing.findMany({
    where: { id: { in: sourceIds }, subSection: { shopSectionId: sourceSection.id } },
    include: {
      images: { where: { localFileName: { not: null } }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] },
      files: { where: { localFileName: { not: null } }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] },
      subSection: true,
    },
  });
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const orderedSources = sourceIds.map((id) => sourceMap.get(id));
  if (orderedSources.some((source) => !source)) throw new Error('One or more selected items could not be found.');

  const finalPath = getListingDirectoryPath(context.shop.displayName, context.section.title, context.subSection.name, listingName);
  const existingListing = await prisma.etsyListing.findFirst({
    where: { subSectionId: context.subSection.id, localDirectoryName: listingName },
    select: {
      images: {
        where: { rank: { in: Array.from({ length: generatedImageCount }, (_, index) => index + 1) }, localFileName: { not: null } },
        select: { rank: true, localFileName: true, originalFileName: true, fullWidth: true, fullHeight: true },
      },
      dropboxFiles: {
        orderBy: [{ groupNumber: 'asc' }, { id: 'asc' }],
        select: {
          sourceListingId: true,
          sourceDirectoryName: true,
          groupNumber: true,
          localFileName: true,
          originalFileName: true,
          sizeBytes: true,
        },
      },
      dropboxBundle: {
        select: { folderPath: true, sharedUrl: true, instructions: true },
      },
      files: {
        select: {
          localFileName: true,
          originalFileName: true,
          filename: true,
          filetype: true,
          filesize: true,
          sizeBytes: true,
          rank: true,
          rawJson: true,
        },
      },
    },
  });
  const subSectionPath = getSubSectionDirectoryPath(context.shop.displayName, context.section.title, context.subSection.name);
  await mkdir(subSectionPath, { recursive: true });
  const stagingPath = path.join(subSectionPath, `.creating-${randomUUID()}`);
  const downloadsPath = path.join(stagingPath, 'dropboxDownloads');
  await mkdir(downloadsPath, { recursive: true });
  const imageRows: Array<{ localFileName: string; originalFileName: string; rank: number; fullWidth?: number; fullHeight?: number }> = [];
  const dropboxRows: Array<{ sourceListingId: number; sourceDirectoryName: string; groupNumber: number; localFileName: string; originalFileName: string; sizeBytes: number | null }> = [];

  try {
    for (let index = 0; index < input.uploadedImages.length; index += 1) {
      const uploaded = input.uploadedImages[index];
      if (uploaded) {
        if (!uploaded.type.startsWith('image/')) throw new Error('Only image uploads are allowed.');
        const extension = path.extname(uploaded.name).toLowerCase() || '.jpg';
        const localFileName = `image_${index + 1}${extension}`;
        const buffer = Buffer.from(await uploaded.arrayBuffer());
        const metadata = await sharp(buffer).metadata();
        await writeFile(path.join(stagingPath, localFileName), buffer);
        imageRows.push({ localFileName, originalFileName: uploaded.name, rank: index + 1, fullWidth: metadata.width, fullHeight: metadata.height });
      } else {
        const existingImage = existingListing?.images.find((image) => image.rank === index + 1);
        if (!existingImage?.localFileName) throw new Error(`Upload all ${generatedImageCount} generated images.`);
        await copyFile(path.join(finalPath, existingImage.localFileName), path.join(stagingPath, existingImage.localFileName));
        imageRows.push({
          localFileName: existingImage.localFileName,
          originalFileName: existingImage.originalFileName ?? existingImage.localFileName,
          rank: index + 1,
          fullWidth: existingImage.fullWidth ?? undefined,
          fullHeight: existingImage.fullHeight ?? undefined,
        });
      }
    }

    const sourceImageCandidates = itemCount === 12
      ? [[1, 6], [3, 7]]
      : itemCount === 6
        ? [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]
        : Array.from({ length: 10 }, (_, offset) => (offset + 6) % 10)
            .flatMap((sourceImageIndex) => orderedSources.map((_, sourceIndex) => [sourceIndex, sourceImageIndex]));
    const imagePlan = sourceImageCandidates
      .filter(([sourceIndex]) => sourceIndex < orderedSources.length)
      .slice(0, Math.max(0, 10 - generatedImageCount))
      .map(([sourceIndex, sourceImageIndex], index) => [generatedImageCount + index + 1, sourceIndex, sourceImageIndex]);
    for (const [destination, sourceIndex, sourceImageIndex] of imagePlan) {
      const source = orderedSources[sourceIndex]!;
      const sourceImage = source.images[sourceImageIndex];
      if (!sourceImage?.localFileName || !source.subSection) {
        throw new Error(`${source.localDirectoryName ?? source.title} is missing image_${sourceImageIndex + 1}.`);
      }
      const sourcePath = getListingDirectoryPath(context.shop.displayName, sourceSection.title, source.subSection.name, source.localDirectoryName ?? `Listing-${source.id}`);
      const localFileName = `image_${destination}${path.extname(sourceImage.localFileName)}`;
      await copyFile(path.join(sourcePath, sourceImage.localFileName), path.join(stagingPath, localFileName));
      imageRows.push({
        localFileName, originalFileName: sourceImage.originalFileName ?? sourceImage.localFileName, rank: destination,
        fullWidth: sourceImage.fullWidth ?? undefined, fullHeight: sourceImage.fullHeight ?? undefined,
      });
    }

    let printGuideCopied = false;
    for (let sourceIndex = 0; sourceIndex < orderedSources.length; sourceIndex += 1) {
      const source = orderedSources[sourceIndex]!;
      const sourceDirectoryName = source.localDirectoryName ?? source.title;
      const sourcePath = getListingDirectoryPath(context.shop.displayName, sourceSection.title, source.subSection!.name, sourceDirectoryName);
      for (const file of source.files) {
        const originalName = file.originalFileName ?? file.localFileName!;
        const extension = path.extname(file.localFileName!).toLocaleLowerCase();
        if (extension === '.txt') {
          if (!printGuideCopied) {
            await copyFile(
              path.join(sourcePath, 'downloads', file.localFileName!),
              path.join(downloadsPath, 'HowToPrintGuide.txt')
            );
            printGuideCopied = true;
          }
          continue;
        }
        if (!['.jpg', '.jpeg', '.png'].includes(extension)) continue;
        const localFileName = `${cleanPart(sourceDirectoryName)}_${cleanPart(file.localFileName!)}`;
        await copyFile(path.join(sourcePath, 'downloads', file.localFileName!), path.join(downloadsPath, localFileName));
        dropboxRows.push({
          sourceListingId: source.id, sourceDirectoryName, groupNumber: sourceIndex + 1,
          localFileName, originalFileName: originalName, sizeBytes: file.sizeBytes,
        });
      }
    }
    if (!printGuideCopied) {
      throw new Error('The selected source listings are missing HowToPrintGuide.txt. Add it before creating this listing.');
    }
    await Promise.all([
      writeFile(path.join(stagingPath, 'title.txt'), title, 'utf8'),
      writeFile(path.join(stagingPath, 'description.txt'), description, 'utf8'),
      writeFile(path.join(stagingPath, 'tags.txt'), input.tags.join('\n'), 'utf8'),
    ]);
    const filesChanged = existingListing
      ? await groupedDownloadFilesChanged(existingListing.dropboxFiles, dropboxRows, finalPath, stagingPath)
      : false;
    const preservedZips: Array<{ groupNumber: number; sourceDirectoryName: string; fileName: string; sizeBytes: number }> = [];
    if (existingListing && !filesChanged) {
      const existingZipsPath = path.join(finalPath, 'dropboxZipped');
      const stagedZipsPath = path.join(stagingPath, 'dropboxZipped');
      try {
        const zipDetails = orderedSources.map((source, index) => ({
          groupNumber: index + 1,
          sourceDirectoryName: source!.localDirectoryName ?? source!.title,
          fileName: `${String(index + 1).padStart(2, '0')}-${cleanPart(source!.localDirectoryName ?? source!.title)}.zip`,
        }));
        const zipStats = await Promise.all(zipDetails.map((zip) => stat(path.join(existingZipsPath, zip.fileName))));
        await mkdir(stagedZipsPath, { recursive: true });
        await Promise.all(zipDetails.map((zip) => copyFile(
          path.join(existingZipsPath, zip.fileName),
          path.join(stagedZipsPath, zip.fileName)
        )));
        preservedZips.push(...zipDetails.map((zip, index) => ({ ...zip, sizeBytes: zipStats[index].size })));
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    const existingPdf = existingListing?.files.find(isDropboxInstructionPdf);
    let pdfPreserved = false;
    if (!filesChanged && existingPdf?.localFileName) {
      try {
        const stagedDownloadsPath = path.join(stagingPath, 'downloads');
        await mkdir(stagedDownloadsPath, { recursive: true });
        await copyFile(
          path.join(finalPath, 'downloads', existingPdf.localFileName),
          path.join(stagedDownloadsPath, existingPdf.localFileName)
        );
        pdfPreserved = true;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    const preserved = await loadExistingMultiListing(context, listingName);
    await preserveThumbnail(preserved, finalPath, stagingPath);
    await preserveLegacyListingImages(preserved, finalPath, stagingPath);
    const listingData = {
      shopId: context.shop.etsyShopId.toString(),
      shopSectionId: context.section.etsyShopSectionId === null ? null : Number(context.section.etsyShopSectionId),
      etsyId: preserved?.etsyId ?? null,
      title,
      description,
      state: preserved?.state ?? 'local',
      url: preserved?.url ?? null,
      quantity: input.quantity,
      priceAmount: Math.round(input.price * 100),
      priceDivisor: 100,
      priceCurrencyCode: 'GBP',
      taxonomyId: configuration.etsyProductType === 'physical' ? 121 : 2078,
      whoMade: 'i_did',
      isSupply: false,
      whenMade: '2020_2026',
      shouldAutoRenew: true,
      language: 'en-US',
      primaryColour: input.primaryColour || null,
      secondaryColour: input.secondaryColour || null,
      subSectionId: context.subSection.id,
      sourceSectionId: sourceSection.id,
      localDirectoryName: listingName,
      isLocal: true,
      numberOfItems: configuration.numberOfItems,
      includeAllItems: configuration.includeAllItems,
      etsyProductType: configuration.etsyProductType,
      rawJson: preserved?.rawJson === null || preserved?.rawJson === undefined ? Prisma.JsonNull : preserved.rawJson,
      lastSyncedAt: preserved?.lastSyncedAt ?? null,
      detailsChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      tagsChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      imagesChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      downloadsChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      productsChanged: preserved?.etsyId !== null && preserved?.etsyId !== undefined,
      downloadedAt: preserved?.downloadedAt ?? new Date(),
      downloadsRevision: !preserved || filesChanged
        ? (preserved?.downloadsRevision ?? 0) + 1
        : preserved.downloadsRevision,
      zippedRevision: !preserved || filesChanged ? 0 : preserved.zippedRevision,
      hasEverZipped: preserved?.hasEverZipped ?? false,
      dropboxRevision: !preserved || filesChanged ? 0 : preserved.dropboxRevision,
      dropboxSyncedAt: !preserved || filesChanged ? null : preserved.dropboxSyncedAt,
    };
    const tagsToCreate = input.tags.map((tag, position) => ({ tag, position: position + 1 }));
    const preparedImages = await prepareDesiredListingImages(
      preserved?.images ?? [],
      imageRows,
      finalPath,
      stagingPath,
    );
    const filesToCreate = pdfPreserved && existingPdf ? [{
      localFileName: existingPdf.localFileName,
      originalFileName: existingPdf.originalFileName,
      filename: existingPdf.filename,
      filetype: existingPdf.filetype,
      filesize: existingPdf.filesize,
      sizeBytes: existingPdf.sizeBytes,
      rank: existingPdf.rank,
      etsyListingFileId: preserved?.files.find((old) => old.localFileName === existingPdf.localFileName)?.etsyListingFileId ?? null,
      rawJson: existingPdf.rawJson === null ? Prisma.JsonNull : existingPdf.rawJson,
    }] : [];
    const replacedDirectory = await installStagedListingDirectory(stagingPath, finalPath);
    let listing: { id: number };
    try {
      listing = await prisma.$transaction(async (tx) => {
        const saved = preserved
          ? await tx.etsyListing.update({
              where: { id: preserved.id },
              data: {
                ...listingData,
                tags: { deleteMany: {}, create: tagsToCreate },
                files: { deleteMany: {}, create: filesToCreate },
                ...(filesChanged ? { zippedFiles: { deleteMany: {} } } : {}),
                dropboxFiles: { deleteMany: {}, create: dropboxRows },
              },
              select: { id: true },
            })
          : await tx.etsyListing.create({
              data: {
                ...listingData,
                tags: { create: tagsToCreate },
                files: { create: filesToCreate },
                dropboxFiles: { create: dropboxRows },
              },
              select: { id: true },
            });
        await persistDesiredListingImages(tx, saved.id, preparedImages);
        await ensureListingProductDefaultsInTransaction(
          tx,
          saved.id,
          preserved && preserved.etsyProductType !== configuration.etsyProductType
            ? { resetToProductType: configuration.etsyProductType }
            : undefined,
        );
        return saved;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await rollbackStagedListingDirectory(finalPath, replacedDirectory, error);
      throw error;
    }
    if (replacedDirectory) {
      try {
        await rm(replacedDirectory, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Unable to remove replaced listing backup ${replacedDirectory}:`, error);
      }
    }
    return {
      listingId: String(listing.id),
      groups: orderedSources.map((source, index) => ({
        groupNumber: index + 1,
        sourceDirectoryName: source!.localDirectoryName ?? source!.title,
        fileCount: dropboxRows.filter((row) => row.groupNumber === index + 1).length,
      })),
      zips: preservedZips,
      filesChanged: !existingListing || filesChanged,
      dropbox: existingListing?.dropboxBundle
        ? { folderPath: existingListing.dropboxBundle.folderPath, sharedUrl: existingListing.dropboxBundle.sharedUrl }
        : null,
      pdfCreated: pdfPreserved,
    };
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}
