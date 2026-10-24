import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    adminProductPrice: {
      findMany: vi.fn(),
    },
    etsyListing: {
      create: vi.fn(),
      update: vi.fn(),
    },
    etsyListingGroupItem: { deleteMany: vi.fn() },
    ourCategory: {
      findFirst: vi.fn(),
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
    listingDelete: vi.fn(),
    rename: vi.fn(),
    createListingDirectory: vi.fn(),
    createSubSectionDirectory: vi.fn(),
    listingDirectoryExists: vi.fn(),
    listingDirectoryIsEmpty: vi.fn(),
    ensureDefaultsInTransaction: vi.fn(),
    saveListingProducts: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    etsyShop: { findUnique: mocks.shopFindUnique },
    etsyShopSection: { findFirst: mocks.sectionFindFirst },
    etsyShopSubSection: { findFirst: mocks.subSectionFindFirst },
    ourCategory: { findFirst: mocks.tx.ourCategory.findFirst },
    etsyListing: {
      findFirst: mocks.listingFindFirst,
      findMany: mocks.listingFindMany,
      delete: mocks.listingDelete,
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
  ETSY_PRODUCT_SIZES: [{ key: 'a4', label: 'A4' }],
  ensureListingProductDefaults: vi.fn(),
  ensureListingProductDefaultsInTransaction: mocks.ensureDefaultsInTransaction,
  saveListingProducts: mocks.saveListingProducts,
}));

vi.mock('@/lib/s3-listing-storage', () => ({ readFile: vi.fn(), rename: mocks.rename }));
vi.mock('@/lib/dropbox-bundle', () => ({
  deleteDropboxBundleFolder: vi.fn(),
  isDropboxInstructionPdfFile: vi.fn(),
}));

import { createLocalListing, updateLocalListing } from '@/lib/local-listings';

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

describe('editing local listing settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureContext();
    mocks.listingFindFirst.mockResolvedValueOnce({ id: 79, localDirectoryName: 'Old name', title: 'Generated Etsy title', numberOfItems: 1, ourCategoryId: 10 });
    mocks.listingFindFirst.mockResolvedValue(null);
    mocks.tx.ourCategory.findFirst.mockResolvedValue({ id: 12, itemCount: 3, templateType: 'multiple', roomTheme: 'Sea' });
    mocks.listingDirectoryExists.mockResolvedValue(false);
    mocks.tx.etsyListing.update.mockResolvedValue({ id: 79 });
    mocks.ensureDefaultsInTransaction.mockResolvedValue(undefined);
  });

  it('updates settings, clears an incompatible group and preserves the generated Etsy title', async () => {
    await updateLocalListing('66615491', '2', '3', '79', 'New name', 3, 12);
    expect(mocks.tx.etsyListing.update).toHaveBeenCalledWith({ where: { id: 79 }, data: {
      localDirectoryName: 'New name', numberOfItems: 3, includeAllItems: false, ourCategoryId: 12, roomTheme: 'Sea',
    } });
    expect(mocks.tx.etsyListingGroupItem.deleteMany).toHaveBeenCalledWith({ where: { groupListingId: 79 } });
    expect(mocks.ensureDefaultsInTransaction).toHaveBeenCalledWith(mocks.tx, 79);
  });

  it('rejects a template with a different item count before moving files or updating the listing', async () => {
    await expect(updateLocalListing('66615491', '2', '3', '79', 'New name', 1, 12)).rejects.toThrow('does not match');
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.tx.etsyListing.update).not.toHaveBeenCalled();
  });

  it('restores the listing folder if saving the database fails', async () => {
    mocks.listingDirectoryExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.tx.etsyListing.update.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(updateLocalListing('66615491', '2', '3', '79', 'New name', 3, 12)).rejects.toThrow('Database unavailable');
    expect(mocks.rename).toHaveBeenCalledTimes(2);
  });
});

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
    mocks.tx.ourCategory.findFirst.mockResolvedValue(null);
    mocks.ensureDefaultsInTransaction.mockResolvedValue(undefined);
    mocks.saveListingProducts.mockResolvedValue(undefined);
    mocks.listingDelete.mockResolvedValue({ id: 79 });
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
        priceAmount: 2999,
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

  it('uses the Etsy section id when applying a template download section', async () => {
    mocks.tx.ourCategory.findFirst.mockResolvedValue({
      id: 12,
      templateType: 'multiple',
      itemCount: 3,
      roomTheme: null,
      printsFrames: true,
      customisePrints: true,
      digitalDownload: true,
      customTop: true,
      customBottom: true,
      downloadSectionId: 4,
      downloadSection: { etsyShopSectionId: 60449656 },
      sizes: {},
      frames: {},
    });

    await expect(createLocalListing('66615491', '2', '3', 'Three sea creatures', {
      numberOfItems: 3,
      includeAllItems: false,
      etsyProductType: 'physical',
      ourCategoryId: 12,
    })).resolves.toEqual({ id: 79 });

    expect(mocks.saveListingProducts).toHaveBeenCalledWith(expect.objectContaining({
      listingId: '79',
      digitalDownload: true,
      downloadSectionId: 60449656,
    }));
  });

  it('removes the new listing row if template product setup fails', async () => {
    mocks.tx.ourCategory.findFirst.mockResolvedValue({
      id: 12,
      templateType: 'multiple',
      itemCount: 3,
      roomTheme: null,
      printsFrames: true,
      customisePrints: true,
      digitalDownload: true,
      customTop: true,
      customBottom: true,
      downloadSectionId: 4,
      downloadSection: { etsyShopSectionId: 60449656 },
      sizes: {},
      frames: {},
    });
    mocks.saveListingProducts.mockRejectedValue(new Error('Product setup failed'));

    await expect(createLocalListing('66615491', '2', '3', 'Three sea creatures', {
      numberOfItems: 3,
      includeAllItems: false,
      etsyProductType: 'physical',
      ourCategoryId: 12,
    })).rejects.toThrow('Product setup failed');

    expect(mocks.listingDelete).toHaveBeenCalledWith({ where: { id: 79 } });
  });
});
