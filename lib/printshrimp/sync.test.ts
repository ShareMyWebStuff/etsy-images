import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  etsyData: vi.fn(), records: vi.fn(), readFile: vi.fn(), stat: vi.fn(),
}));
vi.mock('@/lib/sync-to-etsy', () => ({ getSyncToEtsyData: mocks.etsyData }));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyListing: { findMany: mocks.records } } }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.readFile, stat: mocks.stat }));
vi.mock('@/lib/local-shop-directory', () => ({ getListingDirectoryPath: () => 'D:/Listings/Current' }));

import { PRINTABLE_DOWNLOAD_SPECS } from '@/lib/printable-download-specs';
import { hashPrintShrimpSource, PRINTSHRIMP_RATIOS } from '@/lib/printshrimp/artwork';
import { getSyncToPrintShrimpData } from '@/lib/printshrimp/sync';

function record(printShrimpArtworkSyncs: Array<Record<string, unknown>> = []) {
  return {
    id: 518, title: 'Scarecrow', localDirectoryName: 'Scarecrow',
    etsyId: null, etsyCustomisedId: null, productConfig: { sku: 'SKU_000518' },
    files: PRINTABLE_DOWNLOAD_SPECS.map((spec, index) => ({
      id: index + 1, localFileName: `file_${index + 1}.jpg`,
      originalFileName: `Scarecrow_${spec.fileToken}.jpg`,
      widthPixels: spec.portraitWidth, heightPixels: spec.portraitHeight,
      rawJson: {},
    })),
    printShrimpArtworkSyncs,
    subSection: { name: 'SingleListings', shopSection: { title: 'Scarecrows', shop: { etsyShopId: 66615491n, shopName: 'Test Shop' } } },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PRINTSHRIMP_API_KEY', 'test-key');
  vi.stubEnv('PRINTSHRIMP_API_TIMEOUT_MS', '120000');
  const listing = { id: '518', isComplete: true, syncVariants: ['print'], etsyCategory: 'Kids Prints' };
  mocks.etsyData.mockResolvedValue({
    sections: [{ id: 'etsy:1', sectionName: 'Kids Prints', listings: [listing] }],
    localSections: [{ id: 'local:14', sectionName: 'Scarecrows', listings: [listing] }],
  });
  mocks.stat.mockResolvedValue({ isFile: () => true });
});
afterEach(() => vi.unstubAllEnvs());

describe('PrintShrimp page data loading', () => {
  it('loads unsynced listings without contacting Etsy or downloading the full artwork', async () => {
    mocks.records.mockResolvedValue([record()]);
    const data = await getSyncToPrintShrimpData();
    expect(mocks.etsyData).toHaveBeenCalledWith({ checkRemoteSections: false });
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(data.localSections[0].listings[0]).toMatchObject({
      status: 'NOT_SYNCED', hasAllSixFiles: true, canSync: true, sourceChanged: null,
    });
  });

  it.each([false, true])('still compares artwork against previous successful syncs: changed=%s', async (changed) => {
    const source = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#FFFFFF' } }).jpeg().toBuffer();
    mocks.readFile.mockResolvedValue(source);
    mocks.records.mockResolvedValue([record(PRINTSHRIMP_RATIOS.map((ratio) => ({
      ratio, status: 'SYNCED', printShrimpSku: 'SKU_000518', externalItemId: 'remote-518',
      lastSuccessfulSourceHash: changed ? 'previous-hash' : hashPrintShrimpSource(source, ratio),
      lastSuccessfulSyncAt: new Date('2026-11-01T12:00:00Z'), lastError: null, syncStartedAt: null,
    })))]);
    const data = await getSyncToPrintShrimpData();
    expect(mocks.readFile).toHaveBeenCalledTimes(6);
    expect(data.localSections[0].listings[0]).toMatchObject({
      status: changed ? 'NEEDS_SYNC' : 'SYNCED', sourceChanged: changed,
    });
  });
});
