import { PrintShrimpAdapterError, type PrintShrimpArtworkClient } from '@/lib/printshrimp/client';
import { PRINTSHRIMP_RATIOS, type PrintShrimpRatio } from '@/lib/printshrimp/artwork';

export type PrintShrimpStoredItem = {
  ratio: PrintShrimpRatio;
  status: 'PENDING' | 'RUNNING' | 'SYNCED' | 'FAILED';
  syncStartedAt: Date | null;
  printShrimpSku: string;
  externalItemId: string | null;
  lastSuccessfulSourceHash: string | null;
};

export type PreparedPrintShrimpArtwork = {
  ratio: PrintShrimpRatio;
  productName: string;
  sourceFileId: number;
  sourceHash: string;
  sku: string;
  fileName: string;
  filePath: string;
  width: number;
  height: number;
  density: number;
};

export interface PrintShrimpSyncStore {
  getItems(listingId: number): Promise<PrintShrimpStoredItem[]>;
  claim(listingId: number, artwork: PreparedPrintShrimpArtwork[], startedAt: Date): Promise<boolean>;
  refreshClaim(listingId: number, ratios: PrintShrimpRatio[], refreshedAt: Date): Promise<boolean>;
  recordNoop(listingId: number, artwork: PreparedPrintShrimpArtwork): Promise<void>;
  recordSuccess(listingId: number, artwork: PreparedPrintShrimpArtwork, externalItemId: string | null, completedAt: Date): Promise<void>;
  recordFailure(listingId: number, artwork: PreparedPrintShrimpArtwork, message: string): Promise<void>;
  release(listingId: number, ratios: PrintShrimpRatio[]): Promise<void>;
}

export class PrintShrimpSyncInProgressError extends Error {}

export const PRINTSHRIMP_SYNC_LEASE_MS = 2 * 60 * 1000;
const PRINTSHRIMP_SYNC_HEARTBEAT_MS = 15 * 1000;

export function isActivePrintShrimpSync(item: Pick<PrintShrimpStoredItem, 'status' | 'syncStartedAt'>, now = new Date()) {
  return item.status === 'RUNNING'
    && item.syncStartedAt !== null
    && item.syncStartedAt.getTime() >= now.getTime() - PRINTSHRIMP_SYNC_LEASE_MS;
}

export type PrintShrimpSyncSummary = {
  uploaded: number;
  unchanged: number;
  failed: number;
  fullySynced: boolean;
};

function safeSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : 'PrintShrimp rejected the product synchronisation.';
  return message.replace(/https?:\/\/\S+/gi, '[remote service]').slice(0, 1000);
}

function needsLocalSync(artwork: PreparedPrintShrimpArtwork, stored: PrintShrimpStoredItem | undefined) {
  return !stored
    || stored.status !== 'SYNCED'
    || stored.lastSuccessfulSourceHash !== artwork.sourceHash
    || stored.printShrimpSku !== artwork.sku;
}

async function withTransientRetry<T>(
  operation: () => Promise<T>,
  sleep: (milliseconds: number) => Promise<void>,
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof PrintShrimpAdapterError) || !error.transient || attempt >= 3) throw error;
      await sleep(250 * (2 ** (attempt - 1)));
    }
  }
}

export async function syncPreparedPrintShrimpArtwork(params: {
  listingId: number;
  artwork: PreparedPrintShrimpArtwork[];
  client: PrintShrimpArtworkClient;
  store: PrintShrimpSyncStore;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<PrintShrimpSyncSummary> {
  const suppliedRatios = new Set(params.artwork.map((item) => item.ratio));
  if (params.artwork.length !== PRINTSHRIMP_RATIOS.length || PRINTSHRIMP_RATIOS.some((ratio) => !suppliedRatios.has(ratio))) {
    throw new Error('All six PrintShrimp artwork ratios are required before synchronisation.');
  }
  const productSkus = new Set(params.artwork.map((item) => item.sku));
  if (productSkus.size !== 1) throw new Error('All six PrintShrimp files must use one base product SKU.');

  const now = params.now ?? (() => new Date());
  const sleep = params.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const previous = new Map((await params.store.getItems(params.listingId)).map((item) => [item.ratio, item]));
  const claimed = await params.store.claim(params.listingId, params.artwork, now());
  if (!claimed) throw new PrintShrimpSyncInProgressError('This listing is already being synchronised with PrintShrimp.');

  const claimedRatios = params.artwork.map((item) => item.ratio);
  const heartbeat = setInterval(() => {
    void params.store.refreshClaim(params.listingId, claimedRatios, now()).catch(() => undefined);
  }, PRINTSHRIMP_SYNC_HEARTBEAT_MS);
  heartbeat.unref?.();

  const processed = new Set<PrintShrimpRatio>();
  let ratiosToUpdate = params.artwork
    .filter((artwork) => needsLocalSync(artwork, previous.get(artwork.ratio)))
    .map((artwork) => artwork.ratio);

  try {
    const sku = params.artwork[0].sku;
    const existingExternalItemId = [...previous.values()].find((item) => item.externalItemId)?.externalItemId ?? null;

    if (ratiosToUpdate.length === 0 && params.client.productExists) {
      const exists = await withTransientRetry(() => params.client.productExists!({
        externalItemId: existingExternalItemId,
        sku,
        ratios: [...PRINTSHRIMP_RATIOS],
      }), sleep);
      if (!exists) ratiosToUpdate = [...PRINTSHRIMP_RATIOS];
    }

    if (ratiosToUpdate.length === 0) {
      for (const artwork of params.artwork) {
        await params.store.recordNoop(params.listingId, artwork);
        processed.add(artwork.ratio);
      }
      return { uploaded: 0, unchanged: params.artwork.length, failed: 0, fullySynced: true };
    }

    const result = await withTransientRetry(() => params.client.syncProduct({
      productName: params.artwork[0].productName,
      sku,
      previousSkus: [...new Set([...previous.values()].map((item) => item.printShrimpSku))],
      existingExternalItemId,
      artwork: params.artwork.map((artwork) => ({
        ratio: artwork.ratio,
        fileName: artwork.fileName,
        filePath: artwork.filePath,
        width: artwork.width,
        height: artwork.height,
        density: artwork.density,
      })),
      ratiosToUpdate,
    }), sleep);
    const synchronizedRatios = new Set(result.synchronizedRatios);
    if (synchronizedRatios.size === 0 || [...synchronizedRatios].some((ratio) => !suppliedRatios.has(ratio))) {
      throw new Error('PrintShrimp did not confirm which artwork ratios were synchronised.');
    }

    for (const artwork of params.artwork) {
      if (synchronizedRatios.has(artwork.ratio)) {
        await params.store.recordSuccess(params.listingId, artwork, result.externalItemId, now());
      } else {
        await params.store.recordNoop(params.listingId, artwork);
      }
      processed.add(artwork.ratio);
    }

    return {
      uploaded: synchronizedRatios.size,
      unchanged: params.artwork.length - synchronizedRatios.size,
      failed: 0,
      fullySynced: true,
    };
  } catch (error) {
    const message = safeSyncError(error);
    const failedRatios = new Set(ratiosToUpdate.length > 0 ? ratiosToUpdate : PRINTSHRIMP_RATIOS);
    for (const artwork of params.artwork) {
      if (failedRatios.has(artwork.ratio)) {
        await params.store.recordFailure(params.listingId, artwork, message);
      } else {
        await params.store.recordNoop(params.listingId, artwork);
      }
      processed.add(artwork.ratio);
    }
    throw new Error(`PrintShrimp product sync failed: ${message}`);
  } finally {
    clearInterval(heartbeat);
    const unprocessed = params.artwork.map((item) => item.ratio).filter((ratio) => !processed.has(ratio));
    if (unprocessed.length > 0) await params.store.release(params.listingId, unprocessed);
  }
}
