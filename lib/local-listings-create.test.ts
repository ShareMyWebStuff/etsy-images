import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    adminProductPrice: {
      findMany: vi.fn(),
    },
    etsyListing: {
      create: vi.fn(),
    },
  };
  return {
    tx,
    transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    shopFindUnique: vi.fn(),
    sectionFindFirst: vi.fn(),
    subSectionFindFirst: vi.fn(),
    listingFindFirst: vi.fn(),
    listingFindMany: vi.fn(),
    createListingDirectory: vi.fn(),
    createSubSectionDirectory: vi.fn(),
    listingDirectoryExists: vi.fn(),
    listingDirectoryIsEmpty: vi.fn(),
    ensureDefaultsInTransaction: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    etsyShop: { findUnique: mocks.shopFindUnique },
    etsyShopSection: { findFirst: mocks.sectionFindFirst },
    etsyShopSubSection: { findFirst: mocks.subSectionFindFirst },
    etsyListing: {
      findFirst: mocks.listingFindFirst,
      findMany: mocks.listingFindMany,
    },
  },
}));

vi.mock('@/lib/local-shop-directory', () => ({
  createListingDirectory: mocks.createListingDirectory,
  createSubSectionDirectory: mocks.createSubSectionDirectory,
  listingDirectoryExists: mocks.listingDirectoryExists,
  listingDirectoryIsEmpty: mocks.listingDirectoryIsEmpty,
  listSubSectionListingDirectories: vi.fn(),
  getListingDirectoryPath: vi.fn(() => 'listing/path'),
}));

vi.mock('@/lib/listing-products', () => ({
  ensureListingProductDefaults: vi.fn(),
  ensureListingProductDefaultsInTransaction: mocks.ensureDefaultsInTransaction,
}));

vi.mock('@/lib/s3-listing-storage', () => ({ readFile: vi.fn() }));
vi.mock('@/lib/dropbox-bundle', () => ({
  deleteDropboxBundleFolder: vi.fn(),
  isDropboxInstructionPdfFile: vi.fn(),
}));

import { createLocalListing } from '@/lib/local-listings';

function configureContext() {
  mocks.shopFindUnique.mockResolvedValue({
    id: 1,
    etsyShopId: 66615491n,
    shopName: 'Test Shop',
    title: null,
  });
  mocks.sectionFindFirst.mockResolvedValue({
    id: 2,
    title: 'Prints',
    etsyShopSectionId: '123',
    numberOfDownloads: 1,
    includeAllDownloads: false,
  });
  mocks.subSectionFindFirst.mockResolvedValue({ id: 3, name: 'Animals' });
}

describe('single local listing creation recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureContext();
    mocks.listingFindFirst.mockResolvedValue(null);
    mocks.listingFindMany.mockResolvedValue([]);
    mocks.listingDirectoryExists.mockResolvedValue(false);
    mocks.listingDirectoryIsEmpty.mockResolvedValue(true);
    mocks.tx.adminProductPrice.findMany.mockResolvedValue([]);
    mocks.tx.etsyListing.create.mockResolvedValue({ id: 79 });
    mocks.ensureDefaultsInTransaction.mockResolvedValue(undefined);
  });

  it('creates the listing row and its product defaults in the same transaction', async () => {
    await expect(createLocalListing('66615491', '2', '3', 'Donkey', {
      numberOfItems: 1,
      includeAllItems: false,
      etsyProductType: 'physical',
    })).resolves.toEqual({ id: 79 });

    expect(mocks.tx.etsyListing.create).toHaveBeenCalledOnce();
    expect(mocks.tx.etsyListing.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        quantity: 999,
        priceAmount: 3499,
        priceDivisor: 100,
        priceCurrencyCode: 'GBP',
        whoMade: 'i_did',
        whenMade: '2020_2026',
        isSupply: false,
        shouldAutoRenew: true,
      }),
    }));
    expect(mocks.ensureDefaultsInTransaction).toHaveBeenCalledWith(mocks.tx, 79);
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('can retry after initialization fails and leaves only an empty listing folder', async () => {
    mocks.listingDirectoryExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mocks.ensureDefaultsInTransaction
      .mockRejectedValueOnce(new Error('SKU initialization failed'))
      .mockResolvedValueOnce(undefined);

    await expect(createLocalListing('66615491', '2', '3', 'Donkey', {
      numberOfItems: 1,
      includeAllItems: false,
      etsyProductType: 'physical',
    })).rejects.toThrow('SKU initialization failed');

    await expect(createLocalListing('66615491', '2', '3', 'Donkey', {
      numberOfItems: 1,
      includeAllItems: false,
      etsyProductType: 'physical',
    })).resolves.toEqual({ id: 79 });

    expect(mocks.listingDirectoryIsEmpty).toHaveBeenCalledOnce();
    expect(mocks.ensureDefaultsInTransaction).toHaveBeenCalledTimes(2);
  });

  it('repairs an older partial row in place without replacing its id', async () => {
    mocks.listingFindFirst.mockResolvedValue({
      id: 55,
      etsyId: null,
      isLocal: true,
      title: 'Donkey',
      localDirectoryName: 'Donkey',
      productConfig: null,
    });

    await expect(createLocalListing('66615491', '2', '3', 'Donkey', {
      numberOfItems: 1,
      includeAllItems: false,
      etsyProductType: 'physical',
    })).resolves.toEqual({ id: 55 });

    expect(mocks.ensureDefaultsInTransaction).toHaveBeenCalledWith(mocks.tx, 55);
    expect(mocks.tx.etsyListing.create).not.toHaveBeenCalled();
    expect(mocks.listingFindMany).not.toHaveBeenCalled();
  });

  it('uses the configured item-count price for a new digital listing', async () => {
    mocks.tx.adminProductPrice.findMany.mockResolvedValue([
      { productKey: 'digital_6', amountPence: 825 },
    ]);

    await createLocalListing('66615491', '2', '3', 'Donkey set', {
      numberOfItems: 6,
      includeAllItems: false,
      etsyProductType: 'digital',
    });

    expect(mocks.tx.adminProductPrice.findMany).toHaveBeenCalledWith({
      where: { productKey: { in: ['digital_6'] } },
      select: { productKey: true, amountPence: true },
    });
    expect(mocks.tx.etsyListing.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ priceAmount: 825, etsyProductType: 'digital' }),
    }));
  });
});
