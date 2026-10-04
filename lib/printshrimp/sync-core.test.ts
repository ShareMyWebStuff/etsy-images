import { describe, expect, it, vi } from 'vitest';

import {
  PrintShrimpAdapterError,
  type PrintShrimpArtworkClient,
  type PrintShrimpProductSync,
} from '@/lib/printshrimp/client';
import { PRINTSHRIMP_RATIOS, type PrintShrimpRatio } from '@/lib/printshrimp/artwork';
import {
  PrintShrimpSyncInProgressError,
  syncPreparedPrintShrimpArtwork,
  type PreparedPrintShrimpArtwork,
  type PrintShrimpStoredItem,
  type PrintShrimpSyncStore,
} from '@/lib/printshrimp/sync-core';

function artwork(baseSku = 'GREEN-TURTLE-001', changedRatio?: PrintShrimpRatio) {
  return PRINTSHRIMP_RATIOS.map((ratio, index): PreparedPrintShrimpArtwork => ({
    ratio,
    productName: 'Green Sea Turtle Print',
    sourceFileId: index + 1,
    sourceHash: ratio === changedRatio ? `changed-${ratio}` : `hash-${ratio}`,
    sku: baseSku,
    fileName: `${baseSku}_${ratio}.jpg`,
    filePath: `C:/temp/${baseSku}_${ratio}.jpg`,
    width: 1000,
    height: 1500,
    density: 300,
  }));
}

class MemoryStore implements PrintShrimpSyncStore {
  items = new Map<PrintShrimpRatio, PrintShrimpStoredItem>();
  claimed = false;

  async getItems() { return [...this.items.values()].map((item) => ({ ...item })); }
  async claim(_listingId: number, prepared: PreparedPrintShrimpArtwork[]) {
    if (this.claimed) return false;
    this.claimed = true;
    for (const item of prepared) {
      const previous = this.items.get(item.ratio);
      this.items.set(item.ratio, previous ? { ...previous, status: 'RUNNING' } : {
        ratio: item.ratio,
        status: 'RUNNING',
        syncStartedAt: new Date(),
        printShrimpSku: item.sku,
        externalItemId: null,
        lastSuccessfulSourceHash: null,
      });
    }
    return true;
  }
  async refreshClaim() { return true; }
  async recordNoop(_listingId: number, item: PreparedPrintShrimpArtwork) {
    this.items.set(item.ratio, { ...this.items.get(item.ratio)!, status: 'SYNCED', syncStartedAt: null, printShrimpSku: item.sku });
  }
  async recordSuccess(_listingId: number, item: PreparedPrintShrimpArtwork, externalItemId: string | null) {
    this.items.set(item.ratio, {
      ratio: item.ratio,
      status: 'SYNCED',
      syncStartedAt: null,
      printShrimpSku: item.sku,
      externalItemId,
      lastSuccessfulSourceHash: item.sourceHash,
    });
  }
  async recordFailure(_listingId: number, item: PreparedPrintShrimpArtwork) {
    this.items.set(item.ratio, { ...this.items.get(item.ratio)!, status: 'FAILED', syncStartedAt: null, printShrimpSku: item.sku });
  }
  async release(_listingId: number, ratios: PrintShrimpRatio[]) {
    for (const ratio of ratios) this.items.set(ratio, { ...this.items.get(ratio)!, status: 'PENDING', syncStartedAt: null });
    this.claimed = false;
  }
  allowAnotherRun() { this.claimed = false; }
}

function fakeClient() {
  return {
    syncProduct: vi.fn(async (input: PrintShrimpProductSync) => ({
      externalItemId: `product-${input.sku}`,
      synchronizedRatios: input.ratiosToUpdate,
    })),
  } satisfies PrintShrimpArtworkClient;
}

describe('PrintShrimp idempotent product synchronisation', () => {
  it('cannot report success unless all six current ratios are supplied', async () => {
    await expect(syncPreparedPrintShrimpArtwork({
      listingId: 1,
      artwork: artwork().slice(0, 4),
      client: fakeClient(),
      store: new MemoryStore(),
    })).rejects.toThrow(/All six/);
  });

  it('requires all artwork files to use one base product SKU', async () => {
    const mixed = artwork();
    mixed[4] = { ...mixed[4], sku: 'OTHER-SKU' };
    await expect(syncPreparedPrintShrimpArtwork({
      listingId: 1,
      artwork: mixed,
      client: fakeClient(),
      store: new MemoryStore(),
    })).rejects.toThrow(/one base product SKU/);
  });

  it('creates one product request containing all six ratios initially', async () => {
    const store = new MemoryStore();
    const client = fakeClient();
    const result = await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork(), client, store });
    expect(result).toEqual({ uploaded: 6, unchanged: 0, failed: 0, fullySynced: true });
    expect(client.syncProduct).toHaveBeenCalledOnce();
    expect(client.syncProduct.mock.calls[0][0].sku).toBe('GREEN-TURTLE-001');
    expect(client.syncProduct.mock.calls[0][0].ratiosToUpdate).toEqual(PRINTSHRIMP_RATIOS);
    expect(new Set([...store.items.values()].map((item) => item.externalItemId))).toEqual(new Set(['product-GREEN-TURTLE-001']));
  });

  it('does nothing remotely when all hashes and the base SKU are unchanged', async () => {
    const store = new MemoryStore();
    await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork(), client: fakeClient(), store });
    store.allowAnotherRun();
    const client = fakeClient();
    const result = await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork(), client, store });
    expect(result).toEqual({ uploaded: 0, unchanged: 6, failed: 0, fullySynced: true });
    expect(client.syncProduct).not.toHaveBeenCalled();
  });

  it('updates only the variants associated with a changed ratio', async () => {
    const store = new MemoryStore();
    await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork(), client: fakeClient(), store });
    store.allowAnotherRun();
    const client = fakeClient();
    const result = await syncPreparedPrintShrimpArtwork({
      listingId: 1,
      artwork: artwork('GREEN-TURTLE-001', '3x4'),
      client,
      store,
    });
    expect(result).toEqual({ uploaded: 1, unchanged: 5, failed: 0, fullySynced: true });
    expect(client.syncProduct).toHaveBeenCalledOnce();
    expect(client.syncProduct.mock.calls[0][0].ratiosToUpdate).toEqual(['3x4']);
  });

  it('renames the product and refreshes all ratios after the Etsy SKU changes', async () => {
    const store = new MemoryStore();
    await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork(), client: fakeClient(), store });
    store.allowAnotherRun();
    const client = fakeClient();
    const result = await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork('NEW-SKU'), client, store });
    expect(result.uploaded).toBe(6);
    expect(client.syncProduct).toHaveBeenCalledOnce();
    expect(client.syncProduct.mock.calls[0][0]).toMatchObject({
      sku: 'NEW-SKU',
      previousSkus: ['GREEN-TURTLE-001'],
    });
  });

  it('recreates every variant when the saved base product no longer exists', async () => {
    const store = new MemoryStore();
    await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork(), client: fakeClient(), store });
    store.allowAnotherRun();
    const client = {
      ...fakeClient(),
      productExists: vi.fn(async () => false),
    } satisfies PrintShrimpArtworkClient;
    const result = await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork(), client, store });
    expect(result.uploaded).toBe(6);
    expect(client.syncProduct.mock.calls[0][0].ratiosToUpdate).toEqual(PRINTSHRIMP_RATIOS);
  });

  it('marks only the changed ratio failed when an update fails', async () => {
    const store = new MemoryStore();
    await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork(), client: fakeClient(), store });
    store.allowAnotherRun();
    const client: PrintShrimpArtworkClient = {
      syncProduct: vi.fn(async () => { throw new Error('Permanent update failure'); }),
    };
    await expect(syncPreparedPrintShrimpArtwork({
      listingId: 1,
      artwork: artwork('GREEN-TURTLE-001', '11x14'),
      client,
      store,
    })).rejects.toThrow(/product sync failed/);
    expect(store.items.get('11x14')?.status).toBe('FAILED');
    expect(store.items.get('A')?.status).toBe('SYNCED');
    expect(store.items.get('4x5')?.status).toBe('SYNCED');
    expect(store.items.get('3x4')?.status).toBe('SYNCED');
    expect(store.items.get('2x3')?.status).toBe('SYNCED');
  });

  it('prevents a duplicate concurrent claim', async () => {
    const store = new MemoryStore();
    store.claimed = true;
    await expect(syncPreparedPrintShrimpArtwork({
      listingId: 1,
      artwork: artwork(),
      client: fakeClient(),
      store,
    })).rejects.toBeInstanceOf(PrintShrimpSyncInProgressError);
  });

  it('retries transient product failures but not permanent failures', async () => {
    const store = new MemoryStore();
    let attempts = 0;
    const client: PrintShrimpArtworkClient = {
      syncProduct: vi.fn(async (input) => {
        attempts += 1;
        if (attempts < 3) throw new PrintShrimpAdapterError('Try again', true);
        return { externalItemId: 'product-1', synchronizedRatios: input.ratiosToUpdate };
      }),
    };
    const sleep = vi.fn(async () => undefined);
    const result = await syncPreparedPrintShrimpArtwork({ listingId: 1, artwork: artwork(), client, store, sleep });
    expect(result.fullySynced).toBe(true);
    expect(client.syncProduct).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
