import { mkdtemp, rm as removeTemporaryDirectory, writeFile as writeTemporaryFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { prisma } from '@/lib/prisma';
import {
  convertPrintShrimpArtwork,
  getPrintShrimpArtworkIdentity,
  hashPrintShrimpSource,
  mapPrintShrimpRatioFiles,
  PRINTSHRIMP_RATIOS,
  validatePrintShrimpBaseSku,
  type PrintShrimpRatio,
  type PrintShrimpSourceFile,
} from '@/lib/printshrimp/artwork';
import {
  getPrintShrimpAdapterStatus,
  getPrintShrimpArtworkClient,
  type PrintShrimpArtworkClient,
} from '@/lib/printshrimp/client';
import {
  PrintShrimpSyncInProgressError,
  PRINTSHRIMP_SYNC_LEASE_MS,
  isActivePrintShrimpSync,
  syncPreparedPrintShrimpArtwork,
  type PreparedPrintShrimpArtwork,
  type PrintShrimpStoredItem,
  type PrintShrimpSyncStore,
} from '@/lib/printshrimp/sync-core';
import { readFile, stat } from '@/lib/s3-listing-storage';
import { getSyncToEtsyData } from '@/lib/sync-to-etsy';

type ListingRecord = Awaited<ReturnType<typeof loadListingRecords>>[number];

export type PrintShrimpListingStatus = 'INCOMPLETE' | 'INVALID' | 'NOT_SYNCED' | 'NEEDS_SYNC' | 'SYNCING' | 'FAILED' | 'SYNCED';

export type SyncToPrintShrimpData = {
  adapter: ReturnType<typeof getPrintShrimpAdapterStatus>;
  sections: Array<{
    id: string;
    sectionName: string;
    listings: Array<{
      id: string;
      listingName: string;
      etsyPrintId: string | null;
      etsyDownloadId: string | null;
      etsySku: string;
      isComplete: boolean;
      hasAllSixFiles: boolean;
      status: PrintShrimpListingStatus;
      lastSuccessfulSyncAt: string | null;
      sourceChanged: boolean | null;
      validationError: string | null;
      lastError: string | null;
      canSync: boolean;
      syncDisabledReason: string | null;
      ratioFiles: Array<{ ratio: PrintShrimpRatio; fileName: string | null; synced: boolean }>;
    }>;
  }>;
};

function loadListingRecords(ids?: number[]) {
  return prisma.etsyListing.findMany({
    where: ids ? { id: { in: ids } } : undefined,
    select: {
      id: true,
      etsyId: true,
      etsyDownloadId: true,
      title: true,
      localDirectoryName: true,
      productConfig: { select: { sku: true } },
      files: {
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          localFileName: true,
          originalFileName: true,
          widthPixels: true,
          heightPixels: true,
          rawJson: true,
        },
      },
      printShrimpArtworkSyncs: {
        select: {
          ratio: true,
          status: true,
          printShrimpSku: true,
          externalItemId: true,
          lastSuccessfulSourceHash: true,
          lastSuccessfulSyncAt: true,
          lastError: true,
          syncStartedAt: true,
        },
      },
      subSection: {
        select: {
          name: true,
          shopSection: {
            select: {
              title: true,
              shop: { select: { etsyShopId: true, shopName: true, title: true } },
            },
          },
        },
      },
    },
    orderBy: [{ localDirectoryName: 'asc' }, { title: 'asc' }],
  });
}

function listingStoragePath(listing: ListingRecord) {
  const section = listing.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing.subSection || !section || !shop) throw new Error('The listing is not linked to a local Etsy shop section.');
  return getListingDirectoryPath(
    shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`,
    section.title,
    listing.subSection.name,
    listing.localDirectoryName ?? `Listing-${listing.id}`,
  );
}

function ratioValidationMessage(mapping: ReturnType<typeof mapPrintShrimpRatioFiles>) {
  if (mapping.duplicateRatios.length > 0) return `Multiple Digital Download files match: ${mapping.duplicateRatios.join(', ')}.`;
  if (mapping.missingRatios.length > 0) return `Missing Digital Download ratios: ${mapping.missingRatios.join(', ')}.`;
  return null;
}

function asStoredItems(listing: ListingRecord): PrintShrimpStoredItem[] {
  return listing.printShrimpArtworkSyncs.flatMap((item) => {
    if (!PRINTSHRIMP_RATIOS.includes(item.ratio as PrintShrimpRatio)) return [];
    return [{
      ratio: item.ratio as PrintShrimpRatio,
      status: item.status,
      syncStartedAt: item.syncStartedAt,
      printShrimpSku: item.printShrimpSku,
      externalItemId: item.externalItemId,
      lastSuccessfulSourceHash: item.lastSuccessfulSourceHash,
    }];
  });
}

async function inspectListingSources(listing: ListingRecord, baseSku: string) {
  const mapping = mapPrintShrimpRatioFiles(listing.files);
  const mappingError = ratioValidationMessage(mapping);
  if (mappingError) return { mapping, hashes: new Map<PrintShrimpRatio, string>(), error: mappingError };

  let listingPath: string;
  try {
    listingPath = listingStoragePath(listing);
  } catch (error) {
    return { mapping, hashes: new Map<PrintShrimpRatio, string>(), error: error instanceof Error ? error.message : 'Listing storage is unavailable.' };
  }

  const hashes = new Map<PrintShrimpRatio, string>();
  try {
    for (const ratio of PRINTSHRIMP_RATIOS) {
      const file = mapping.files.get(ratio)!;
      if (!file.localFileName) throw new Error(`${ratio} does not have a stored source filename.`);
      const sourcePath = path.join(listingPath, 'downloads', file.localFileName);
      const fileStats = await stat(sourcePath);
      if (!fileStats.isFile()) throw new Error(`${ratio} source artwork is not a file.`);
      const source = await readFile(sourcePath);
      const metadata = await sharp(source, { failOn: 'error' }).metadata();
      if (!metadata.width || !metadata.height) throw new Error(`${ratio} source artwork dimensions could not be read.`);
      hashes.set(ratio, hashPrintShrimpSource(source, ratio));
      getPrintShrimpArtworkIdentity(baseSku, ratio);
    }
  } catch (error) {
    return { mapping, hashes, error: error instanceof Error ? error.message : 'A Digital Download file could not be read.' };
  }
  return { mapping, hashes, error: null };
}

function latestDate(values: Array<Date | null>) {
  const timestamps = values.flatMap((value) => value ? [value.getTime()] : []);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

export async function getSyncToPrintShrimpData(): Promise<SyncToPrintShrimpData> {
  const etsyData = await getSyncToEtsyData();
  const etsyListings = etsyData.sections.flatMap((section) => section.listings);
  const completionById = new Map(etsyListings.map((listing) => [Number(listing.id), listing.isComplete]));
  const records = await loadListingRecords([...completionById.keys()]);
  const recordById = new Map(records.map((listing) => [listing.id, listing]));
  const adapter = getPrintShrimpAdapterStatus();

  return {
    adapter,
    sections: await Promise.all(etsyData.sections.map(async (section) => ({
      id: section.id,
      sectionName: section.sectionName,
      listings: await Promise.all(section.listings.map(async (etsyListing) => {
        const listing = recordById.get(Number(etsyListing.id));
        if (!listing) throw new Error(`Listing ${etsyListing.id} was not found.`);
        const isComplete = completionById.get(listing.id) ?? false;
        const etsySku = listing.productConfig?.sku?.trim() ?? '';
        let skuError: string | null = null;
        try {
          validatePrintShrimpBaseSku(etsySku);
        } catch (error) {
          skuError = error instanceof Error ? error.message : 'The Etsy SKU is invalid.';
        }

        const shouldInspectSourceContents = !skuError && isComplete && (adapter.configured || listing.printShrimpArtworkSyncs.length > 0);
        const inspection = !shouldInspectSourceContents
          ? { mapping: mapPrintShrimpRatioFiles(listing.files), hashes: new Map<PrintShrimpRatio, string>(), error: null }
          : await inspectListingSources(listing, etsySku);
        const validationError = skuError ?? ratioValidationMessage(inspection.mapping) ?? inspection.error;
        const hasAllSixFiles = inspection.mapping.missingRatios.length === 0 && inspection.mapping.duplicateRatios.length === 0;
        const stored = new Map(asStoredItems(listing).map((item) => [item.ratio, item]));
        const hasPreviousSuccess = [...stored.values()].some((item) => item.lastSuccessfulSourceHash !== null);
        const currentRows = PRINTSHRIMP_RATIOS.map((ratio) => {
          const item = stored.get(ratio);
          const identity = etsySku ? getPrintShrimpArtworkIdentity(etsySku, ratio) : null;
          const currentHash = inspection.hashes.get(ratio);
          const current = Boolean(
            item
            && item.status === 'SYNCED'
            && currentHash
            && item.lastSuccessfulSourceHash === currentHash
            && item.printShrimpSku === identity?.sku,
          );
          return { ratio, item, current };
        });
        const sourceChanged = hasPreviousSuccess
          ? currentRows.some(({ item, current }) => Boolean(item?.lastSuccessfulSourceHash) && !current)
          : null;
        const observedAt = new Date();
        const staleRun = currentRows.some(({ item }) => item?.status === 'RUNNING' && !isActivePrintShrimpSync(item, observedAt));
        const lastError = listing.printShrimpArtworkSyncs.find((item) => item.status === 'FAILED' && item.lastError)?.lastError
          ?? (staleRun ? 'The previous PrintShrimp sync was interrupted. Retry the listing.' : null);
        const allCurrent = currentRows.every(({ current }) => current);
        const anyRunning = currentRows.some(({ item }) => item ? isActivePrintShrimpSync(item, observedAt) : false);
        const anyStored = currentRows.some(({ item }) => Boolean(item));
        const status: PrintShrimpListingStatus = !isComplete
          ? 'INCOMPLETE'
          : validationError ? 'INVALID'
          : anyRunning ? 'SYNCING'
          : lastError ? 'FAILED'
          : allCurrent ? 'SYNCED'
          : anyStored ? 'NEEDS_SYNC'
          : 'NOT_SYNCED';
        const syncDisabledReason = !isComplete
          ? 'Complete this listing before syncing it to PrintShrimp.'
          : validationError
            ? validationError
            : !adapter.configured ? adapter.message : null;

        return {
          id: String(listing.id),
          listingName: listing.localDirectoryName ?? listing.title,
          etsyPrintId: listing.etsyId,
          etsyDownloadId: listing.etsyDownloadId,
          etsySku,
          isComplete,
          hasAllSixFiles,
          status,
          lastSuccessfulSyncAt: latestDate(listing.printShrimpArtworkSyncs.map((item) => item.lastSuccessfulSyncAt)),
          sourceChanged,
          validationError,
          lastError,
          canSync: isComplete && !validationError && adapter.configured && !anyRunning,
          syncDisabledReason,
          ratioFiles: PRINTSHRIMP_RATIOS.map((ratio) => ({
            ratio,
            fileName: inspection.mapping.files.get(ratio)?.originalFileName ?? inspection.mapping.files.get(ratio)?.localFileName ?? null,
            synced: currentRows.find((row) => row.ratio === ratio)?.current ?? false,
          })),
        };
      })),
    }))),
  };
}

class PrismaPrintShrimpSyncStore implements PrintShrimpSyncStore {
  async getItems(listingId: number) {
    const items = await prisma.printShrimpArtworkSync.findMany({ where: { listingId } });
    return items.flatMap((item) => PRINTSHRIMP_RATIOS.includes(item.ratio as PrintShrimpRatio) ? [{
      ratio: item.ratio as PrintShrimpRatio,
      status: item.status,
      syncStartedAt: item.syncStartedAt,
      printShrimpSku: item.printShrimpSku,
      externalItemId: item.externalItemId,
      lastSuccessfulSourceHash: item.lastSuccessfulSourceHash,
    }] : []);
  }

  async claim(listingId: number, artwork: PreparedPrintShrimpArtwork[], startedAt: Date) {
    const staleBefore = new Date(startedAt.getTime() - PRINTSHRIMP_SYNC_LEASE_MS);
    return prisma.$transaction(async (tx) => {
      for (const item of artwork) {
        await tx.printShrimpArtworkSync.upsert({
          where: { listingId_ratio: { listingId, ratio: item.ratio } },
          create: {
            listingId,
            ratio: item.ratio,
            sourceFileId: item.sourceFileId,
            sourceContentHash: item.sourceHash,
            printShrimpSku: item.sku,
            uploadedFileName: item.fileName,
          },
          update: {},
        });
      }
      const claimed = await tx.printShrimpArtworkSync.updateMany({
        where: {
          listingId,
          ratio: { in: artwork.map((item) => item.ratio) },
          OR: [{ status: { not: 'RUNNING' } }, { syncStartedAt: { lt: staleBefore } }],
        },
        data: { status: 'RUNNING', syncStartedAt: startedAt, lastError: null },
      });
      if (claimed.count !== artwork.length) throw new PrintShrimpSyncInProgressError('This listing is already being synchronised with PrintShrimp.');
      return true;
    });
  }

  async refreshClaim(listingId: number, ratios: PrintShrimpRatio[], refreshedAt: Date) {
    const refreshed = await prisma.printShrimpArtworkSync.updateMany({
      where: { listingId, ratio: { in: ratios }, status: 'RUNNING' },
      data: { syncStartedAt: refreshedAt },
    });
    return refreshed.count === ratios.length;
  }

  async recordNoop(listingId: number, artwork: PreparedPrintShrimpArtwork) {
    await prisma.printShrimpArtworkSync.update({
      where: { listingId_ratio: { listingId, ratio: artwork.ratio } },
      data: {
        sourceFileId: artwork.sourceFileId,
        sourceContentHash: artwork.sourceHash,
        printShrimpSku: artwork.sku,
        uploadedFileName: artwork.fileName,
        status: 'SYNCED',
        syncStartedAt: null,
        lastError: null,
      },
    });
  }

  async recordSuccess(listingId: number, artwork: PreparedPrintShrimpArtwork, externalItemId: string | null, completedAt: Date) {
    await prisma.printShrimpArtworkSync.update({
      where: { listingId_ratio: { listingId, ratio: artwork.ratio } },
      data: {
        sourceFileId: artwork.sourceFileId,
        sourceContentHash: artwork.sourceHash,
        lastSuccessfulSourceHash: artwork.sourceHash,
        printShrimpSku: artwork.sku,
        uploadedFileName: artwork.fileName,
        ...(externalItemId ? { externalItemId } : {}),
        status: 'SYNCED',
        syncStartedAt: null,
        lastSuccessfulSyncAt: completedAt,
        lastError: null,
      },
    });
  }

  async recordFailure(listingId: number, artwork: PreparedPrintShrimpArtwork, message: string) {
    await prisma.printShrimpArtworkSync.update({
      where: { listingId_ratio: { listingId, ratio: artwork.ratio } },
      data: {
        sourceFileId: artwork.sourceFileId,
        sourceContentHash: artwork.sourceHash,
        printShrimpSku: artwork.sku,
        uploadedFileName: artwork.fileName,
        status: 'FAILED',
        syncStartedAt: null,
        lastError: message,
      },
    });
  }

  async release(listingId: number, ratios: PrintShrimpRatio[]) {
    await prisma.printShrimpArtworkSync.updateMany({
      where: { listingId, ratio: { in: ratios }, status: 'RUNNING' },
      data: { status: 'PENDING', syncStartedAt: null },
    });
  }
}

async function prepareArtwork(listing: ListingRecord, baseSku: string, temporaryDirectory: string) {
  const mapping = mapPrintShrimpRatioFiles(listing.files);
  const mappingError = ratioValidationMessage(mapping);
  if (mappingError) throw new Error(mappingError);
  const listingPath = listingStoragePath(listing);
  const prepared: PreparedPrintShrimpArtwork[] = [];

  for (const ratio of PRINTSHRIMP_RATIOS) {
    const file = mapping.files.get(ratio)!;
    if (!file.localFileName) throw new Error(`${ratio} does not have a stored source filename.`);
    const source = await readFile(path.join(listingPath, 'downloads', file.localFileName));
    const converted = await convertPrintShrimpArtwork(source);
    const identity = getPrintShrimpArtworkIdentity(baseSku, ratio);
    const filePath = path.join(temporaryDirectory, identity.fileName);
    await writeTemporaryFile(filePath, converted.jpeg);
    prepared.push({
      ratio,
      productName: listing.localDirectoryName ?? listing.title,
      sourceFileId: file.id,
      sourceHash: hashPrintShrimpSource(source, ratio),
      sku: identity.sku,
      fileName: identity.fileName,
      filePath,
      width: converted.width,
      height: converted.height,
      density: converted.density,
    });
  }
  return prepared;
}

export async function syncListingToPrintShrimp(listingId: string, client: PrintShrimpArtworkClient = getPrintShrimpArtworkClient()) {
  const numericListingId = Number(listingId);
  if (!Number.isInteger(numericListingId) || numericListingId < 1) throw new Error('Choose a valid listing to sync.');
  const etsyData = await getSyncToEtsyData();
  const canonicalListing = etsyData.sections.flatMap((section) => section.listings).find((listing) => Number(listing.id) === numericListingId);
  if (!canonicalListing) throw new Error('Listing not found.');
  if (!canonicalListing.isComplete) throw new Error('Complete this listing before syncing it to PrintShrimp.');

  const listing = (await loadListingRecords([numericListingId]))[0];
  if (!listing) throw new Error('Listing not found.');
  const baseSku = validatePrintShrimpBaseSku(listing.productConfig?.sku);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'printshrimp-'));
  try {
    const artwork = await prepareArtwork(listing, baseSku, temporaryDirectory);
    return await syncPreparedPrintShrimpArtwork({
      listingId: numericListingId,
      artwork,
      client,
      store: new PrismaPrintShrimpSyncStore(),
    });
  } finally {
    await removeTemporaryDirectory(temporaryDirectory, { recursive: true, force: true });
  }
}
