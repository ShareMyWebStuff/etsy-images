import path from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shop: vi.fn(), section: vi.fn(), subSection: vi.fn(), listing: vi.fn(), query: vi.fn(),
  read: vi.fn(), mkdir: vi.fn(), execute: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section },
  etsyShopSubSection: { findFirst: mocks.subSection }, etsyListing: { findFirst: mocks.listing },
  adminProductPrice: { findMany: vi.fn().mockResolvedValue([]) },
  $queryRaw: mocks.query, $executeRaw: mocks.execute,
} }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, mkdir: mocks.mkdir }));

import { getListingPrintCropSourceDimensions } from '@/lib/listing-editor';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';

const context = { shopId: '66615491', sectionId: '15', subSectionId: '27', listingId: '548' };
const listing = (extra: Record<string, unknown> = {}) => ({
  id: 548, title: 'Artwork', localDirectoryName: 'Artwork', thumbnailFileName: 'art.png',
  thumbnailWidthPixels: null, thumbnailHeightPixels: null, ...extra,
});

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: 66615491n, shopName: 'Shop' });
  mocks.section.mockResolvedValue({ id: 15, title: 'Art' });
  mocks.subSection.mockResolvedValue({ id: 27, name: 'Single' });
  mocks.listing.mockResolvedValue(listing());
  mocks.query.mockResolvedValue([{ artworkOrientation: 'portrait' }]);
  mocks.read.mockResolvedValue(await sharp({ create: { width: 40, height: 50, channels: 3, background: '#008000' } }).png().toBuffer());
});

describe('listing print crop source dimensions', () => {
  it('returns saved full-resolution dimensions without reading or writing S3', async () => {
    mocks.listing.mockResolvedValue(listing({ thumbnailWidthPixels: 7200, thumbnailHeightPixels: 9000 }));
    await expect(getListingPrintCropSourceDimensions(context)).resolves.toEqual({ width: 7200, height: 9000 });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.listing.mock.calls[0][0].where).toEqual({ id: 548, subSectionId: 27 });
  });

  it.each([
    [null, null], [40, null], [0, 50], [40, -1], [40.5, 50],
  ])('inspects the original when saved dimensions are unavailable or invalid: %s × %s', async (width, height) => {
    mocks.listing.mockResolvedValue(listing({ thumbnailWidthPixels: width, thumbnailHeightPixels: height }));
    await expect(getListingPrintCropSourceDimensions(context)).resolves.toEqual({ width: 40, height: 50 });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.read.mock.calls[0][0]).toBe(path.join(getListingDirectoryPath('Shop', 'Art', 'Single', 'Artwork'), 'thumbnail', 'art.png'));
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([5, 6, 7, 8])('preserves EXIF orientation %s when inspecting a legacy original', async (orientation) => {
    mocks.read.mockResolvedValue(await sharp({ create: { width: 40, height: 50, channels: 3, background: '#008000' } })
      .jpeg().withMetadata({ orientation }).toBuffer());
    await expect(getListingPrintCropSourceDimensions(context)).resolves.toEqual({ width: 50, height: 40 });
  });

  it('retains Sharp’s default safety guard for legacy originals with excessive pixel dimensions', async () => {
    const original = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#008000' } }).png().toBuffer();
    original.writeUInt32BE(20_000, 16);
    original.writeUInt32BE(20_000, 20);
    original.writeUInt32BE(crc32(original.subarray(12, 29)), 29);
    mocks.read.mockResolvedValue(original);
    await expect(getListingPrintCropSourceDimensions(context)).rejects.toThrow(/pixel limit/i);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('requires a thumbnail and validates its context before using cached dimensions', async () => {
    mocks.listing.mockResolvedValue(listing({ thumbnailFileName: null, thumbnailWidthPixels: 7200, thumbnailHeightPixels: 9000 }));
    await expect(getListingPrintCropSourceDimensions(context)).rejects.toThrow('Upload a thumbnail before setting print sizes.');
    mocks.section.mockResolvedValue(null);
    await expect(getListingPrintCropSourceDimensions(context)).rejects.toThrow('Section not found.');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();
  });

  it('keeps the actionable missing-original error for legacy records', async () => {
    mocks.read.mockRejectedValue(Object.assign(new Error('Missing'), { code: 'ENOENT' }));
    await expect(getListingPrintCropSourceDimensions(context)).rejects.toThrow('The saved thumbnail file could not be found. Upload the thumbnail again.');
  });
});
