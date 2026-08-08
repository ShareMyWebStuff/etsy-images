import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { getListingDirectoryPath, getSubSectionDirectoryPath } from '@/lib/local-shop-directory';
import { prisma } from '@/lib/prisma';

export type MultiListingWizardData = {
  subSection: { id: string; name: string; numberOfDownloads: number | null; includeAllDownloads: boolean };
  defaultSourceSectionId: string | null;
  sourceSections: Array<{
    id: string;
    name: string;
    sources: Array<{ id: string; name: string; description: string; primaryColour: string | null; secondaryColour: string | null }>;
  }>;
};

type Context = {
  shop: { id: number; etsyShopId: bigint; displayName: string };
  section: { id: number; title: string; etsyShopSectionId: string | null };
  subSection: { id: number; name: string; numberOfDownloads: number | null; includeAllDownloads: boolean };
};

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
          id: String(listing.id), name: listing.localDirectoryName!, description: listing.localProfile?.description ?? '',
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

export async function validateMultiListingName(
  contextInput: { shopId: string; sectionId: string; subSectionId: string; sourceSectionId: string },
  requestedName: string
) {
  const context = await getContext(contextInput.shopId, contextInput.sectionId, contextInput.subSectionId);
  const sourceSection = await getSourceSection(context, contextInput.sourceSectionId);
  const listingName = requestedName.trim();
  if (!listingName) throw new Error('Enter a listing name.');
  const listingPath = getListingDirectoryPath(
    context.shop.displayName,
    context.section.title,
    context.subSection.name,
    listingName
  );
  const allDownloadSourceCount = context.subSection.includeAllDownloads
    ? await prisma.etsyListing.count({
        where: { subSection: { shopSectionId: sourceSection.id } },
      })
    : 0;
  const generatedImageCount = context.subSection.includeAllDownloads
    ? 6 + Math.ceil(allDownloadSourceCount / 16)
    : context.subSection.numberOfDownloads === 12 ? 8 : 4;
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
      files: { some: { localFileName: 'CosyHousePrints_Download_Instructions.pdf' } },
    },
    select: { id: true, etsyId: true },
  });
  if (!listing) throw new Error('Create the Dropbox bundle and download PDF before completing the listing.');
  if (listing.etsyId === null) {
    await prisma.etsyListing.update({ where: { id: listing.id }, data: { state: 'complete' } });
  }
  return { completed: true };
}

async function removeExistingMultiListing(context: Context, listingName: string, listingPath: string) {
  const existing = await prisma.etsyListing.findFirst({
    where: {
      subSectionId: context.subSection.id,
      localDirectoryName: listingName,
    },
    select: {
      etsyId: true, state: true, url: true, rawJson: true, shopSectionId: true,
      lastSyncedAt: true, downloadedAt: true,
      images: { select: { rank: true, localFileName: true, etsyImageId: true } },
      files: { select: { localFileName: true, etsyListingFileId: true } },
    },
  });
  await prisma.etsyListing.deleteMany({
    where: { subSectionId: context.subSection.id, localDirectoryName: listingName },
  });
  await rm(listingPath, { recursive: true, force: true });
  return existing;
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
    bedroomImage: File;
    playroomImage: File;
  }
) {
  const context = await getContext(contextInput.shopId, contextInput.sectionId, contextInput.subSectionId);
  const sourceSection = await getSourceSection(context, contextInput.sourceSectionId);
  if (context.subSection.numberOfDownloads !== 3 || context.subSection.includeAllDownloads) {
    throw new Error('This creation flow is only available for 3-download sub sections.');
  }
  if (input.sourceIds.length !== 3 || new Set(input.sourceIds).size !== 3) throw new Error('Select 3 items.');
  const title = input.title.trim();
  const listingName = input.listingName.trim();
  const description = input.description.trim();
  await validateMultiListingName(contextInput, listingName);
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

  const subSectionPath = getSubSectionDirectoryPath(context.shop.displayName, context.section.title, context.subSection.name);
  await mkdir(subSectionPath, { recursive: true });
  const stagingPath = path.join(subSectionPath, `.creating-${randomUUID()}`);
  const downloadsPath = path.join(stagingPath, 'downloads');
  await mkdir(downloadsPath, { recursive: true });

  const imageRows: Array<{ localFileName: string; originalFileName: string; rank: number; fullWidth?: number; fullHeight?: number }> = [];
  const fileRows: Array<{
    localFileName: string; originalFileName: string; rank: number; sizeBytes: number | null;
    widthPixels: number | null; heightPixels: number | null; jpegQuality: number | null; rawJson: Prisma.InputJsonValue;
  }> = [];

  try {
    for (const [rank, uploaded] of [input.bedroomImage, input.playroomImage].entries()) {
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
    }

    const imagePlan = [
      [0, 0], [1, 0], [2, 0],
      [0, 1], [1, 1], [2, 1],
      [0, 2], [1, 2], [2, 2],
      [0, 3], [1, 4], [2, 5],
      [0, 6], [1, 7], [2, 8], [0, 9],
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

    let downloadRank = 1;
    const copiedTextFiles = new Set<string>();
    for (const source of orderedSources) {
      const sourcePath = getListingDirectoryPath(
        context.shop.displayName, sourceSection.title, source!.subSection!.name,
        source!.localDirectoryName ?? `Listing-${source!.id}`
      );
      for (const file of source!.files) {
        const originalName = file.originalFileName ?? file.localFileName!;
        const isTextFile = path.extname(file.localFileName!).toLocaleLowerCase() === '.txt';
        const textFileKey = path.basename(originalName).toLocaleLowerCase();
        if (isTextFile && copiedTextFiles.has(textFileKey)) continue;
        if (isTextFile) copiedTextFiles.add(textFileKey);
        const localFileName = isTextFile
          ? cleanPart(originalName)
          : `${cleanPart(source!.localDirectoryName ?? source!.title)}_${cleanPart(file.localFileName!)}`;
        await copyFile(path.join(sourcePath, 'downloads', file.localFileName!), path.join(downloadsPath, localFileName));
        fileRows.push({
          localFileName,
          originalFileName: originalName,
          rank: downloadRank++,
          sizeBytes: file.sizeBytes,
          widthPixels: file.widthPixels,
          heightPixels: file.heightPixels,
          jpegQuality: file.jpegQuality,
          rawJson: {},
        });
      }
    }

    await Promise.all([
      writeFile(path.join(stagingPath, 'title.txt'), title, 'utf8'),
      writeFile(path.join(stagingPath, 'description.txt'), description, 'utf8'),
      writeFile(path.join(stagingPath, 'tags.txt'), input.tags.join('\n'), 'utf8'),
    ]);

    const preserved = await removeExistingMultiListing(context, listingName, finalPath);
    const priceAmount = Math.round(input.price * 100);
    const listing = await prisma.etsyListing.create({
      data: {
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
        taxonomyId: 2078,
        whoMade: 'i_did',
        isSupply: false,
        whenMade: '2020_2026',
        shouldAutoRenew: true,
        language: 'en-US',
        primaryColour: input.primaryColour || null,
        secondaryColour: input.secondaryColour || null,
        subSectionId: context.subSection.id,
        localDirectoryName: listingName,
        isLocal: true,
        rawJson: preserved?.rawJson === null || preserved?.rawJson === undefined ? Prisma.JsonNull : preserved.rawJson,
        lastSyncedAt: preserved?.lastSyncedAt ?? null,
        downloadedAt: preserved?.downloadedAt ?? new Date(),
        tags: { create: input.tags.map((tag, position) => ({ tag, position: position + 1 })) },
        images: { create: imageRows.map((image) => ({
          ...image,
          etsyImageId: image.rank <= 2 ? null : preserved?.images.find((old) => old.rank === image.rank && old.localFileName === image.localFileName)?.etsyImageId ?? null,
        })) },
        files: { create: fileRows.map((file) => ({
          ...file,
          etsyListingFileId: preserved?.files.find((old) => old.localFileName === file.localFileName)?.etsyListingFileId ?? null,
        })) },
      },
      select: { id: true },
    });

    try {
      await rename(stagingPath, finalPath);
    } catch (error) {
      await prisma.etsyListing.delete({ where: { id: listing.id } });
      throw error;
    }
    return { listingId: String(listing.id) };
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
  }
) {
  const context = await getContext(contextInput.shopId, contextInput.sectionId, contextInput.subSectionId);
  const sourceSection = await getSourceSection(context, contextInput.sourceSectionId);
  const isAllDownloads = context.subSection.includeAllDownloads;
  const itemCount = isAllDownloads ? input.sourceIds.length : context.subSection.numberOfDownloads;
  if (!isAllDownloads && itemCount !== 6 && itemCount !== 12) {
    throw new Error('This creation flow is only available for 6-, 12-, or All-download sub sections.');
  }
  if (!itemCount || itemCount < 1) throw new Error('No source listings were selected.');
  const generatedImageCount = isAllDownloads ? 6 + Math.ceil(itemCount / 16) : itemCount === 12 ? 8 : 4;
  if (input.sourceIds.length !== itemCount || new Set(input.sourceIds).size !== itemCount) throw new Error(`Select ${itemCount} items.`);
  if (input.uploadedImages.length !== generatedImageCount) throw new Error(`Provide all ${generatedImageCount} generated image slots.`);
  const title = input.title.trim();
  const listingName = input.listingName.trim();
  const description = input.description.trim();
  await validateMultiListingName(contextInput, listingName);
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
        where: { localFileName: 'CosyHousePrints_Download_Instructions.pdf' },
        take: 1,
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

    const imagePlan = isAllDownloads
      ? [
          [generatedImageCount + 1, 1, 6],
          [generatedImageCount + 2, 3, 7],
          [generatedImageCount + 3, 4, 8],
          [generatedImageCount + 4, 5, 9],
        ]
      : itemCount === 12
      ? [[13, 1, 6], [14, 3, 7], [15, 4, 8], [18, 5, 9]]
      : [
          [5, 0, 0], [6, 1, 0], [7, 2, 0], [8, 3, 0], [9, 4, 0], [10, 5, 0],
          [11, 2, 3], [12, 0, 5], [13, 1, 6], [14, 3, 7], [15, 4, 8], [18, 5, 9],
        ];
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
    await Promise.all([
      writeFile(path.join(stagingPath, 'title.txt'), title, 'utf8'),
      writeFile(path.join(stagingPath, 'description.txt'), description, 'utf8'),
      writeFile(path.join(stagingPath, 'tags.txt'), input.tags.join('\n'), 'utf8'),
    ]);
    const comparableDropboxRows = (rows: Array<{
      sourceListingId: number | null;
      sourceDirectoryName: string;
      groupNumber: number;
      localFileName: string;
      originalFileName: string | null;
      sizeBytes: number | null;
    }>) => rows.map((row) => ({
      sourceListingId: row.sourceListingId,
      sourceDirectoryName: row.sourceDirectoryName,
      groupNumber: row.groupNumber,
      localFileName: row.localFileName,
      originalFileName: row.originalFileName ?? '',
      sizeBytes: row.sizeBytes,
    }));
    const filesChanged = Boolean(existingListing)
      && JSON.stringify(comparableDropboxRows(existingListing!.dropboxFiles)) !== JSON.stringify(comparableDropboxRows(dropboxRows));
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
    const existingPdf = existingListing?.files[0];
    let pdfPreserved = false;
    if (existingPdf?.localFileName) {
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
    const preserved = await removeExistingMultiListing(context, listingName, finalPath);
    const listing = await prisma.etsyListing.create({
      data: {
        shopId: context.shop.etsyShopId.toString(),
        shopSectionId: context.section.etsyShopSectionId === null ? null : Number(context.section.etsyShopSectionId),
        etsyId: preserved?.etsyId ?? null, title, description, state: preserved?.state ?? 'local', url: preserved?.url ?? null,
        quantity: input.quantity, priceAmount: Math.round(input.price * 100),
        priceDivisor: 100, priceCurrencyCode: 'GBP', taxonomyId: 2078, whoMade: 'i_did', isSupply: false,
        whenMade: '2020_2026', shouldAutoRenew: true, language: 'en-US',
        primaryColour: input.primaryColour || null, secondaryColour: input.secondaryColour || null,
        subSectionId: context.subSection.id, localDirectoryName: listingName, isLocal: true,
        rawJson: preserved?.rawJson === null || preserved?.rawJson === undefined ? Prisma.JsonNull : preserved.rawJson,
        lastSyncedAt: preserved?.lastSyncedAt ?? null,
        downloadedAt: preserved?.downloadedAt ?? new Date(),
        tags: { create: input.tags.map((tag, position) => ({ tag, position: position + 1 })) },
        images: { create: imageRows.map((image) => ({
          ...image,
          etsyImageId: input.uploadedImages[image.rank - 1]
            ? null
            : preserved?.images.find((old) => old.rank === image.rank && old.localFileName === image.localFileName)?.etsyImageId ?? null,
        })) },
        dropboxFiles: { create: dropboxRows },
        ...(pdfPreserved && existingPdf ? {
          files: {
            create: {
              localFileName: existingPdf.localFileName,
              originalFileName: existingPdf.originalFileName,
              filename: existingPdf.filename,
              filetype: existingPdf.filetype,
              filesize: existingPdf.filesize,
              sizeBytes: existingPdf.sizeBytes,
              rank: existingPdf.rank,
              etsyListingFileId: preserved?.files.find((old) => old.localFileName === existingPdf.localFileName)?.etsyListingFileId ?? null,
              rawJson: existingPdf.rawJson === null ? Prisma.JsonNull : existingPdf.rawJson,
            },
          },
        } : {}),
        ...(existingListing?.dropboxBundle ? {
          dropboxBundle: {
            create: {
              folderPath: existingListing.dropboxBundle.folderPath,
              sharedUrl: existingListing.dropboxBundle.sharedUrl,
              instructions: existingListing.dropboxBundle.instructions,
            },
          },
        } : {}),
      },
      select: { id: true },
    });
    try {
      await rename(stagingPath, finalPath);
    } catch (error) {
      await prisma.etsyListing.delete({ where: { id: listing.id } });
      throw error;
    }
    return {
      listingId: String(listing.id),
      groups: orderedSources.map((source, index) => ({
        groupNumber: index + 1,
        sourceDirectoryName: source!.localDirectoryName ?? source!.title,
        fileCount: dropboxRows.filter((row) => row.groupNumber === index + 1).length,
      })),
      zips: preservedZips,
      filesChanged,
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
