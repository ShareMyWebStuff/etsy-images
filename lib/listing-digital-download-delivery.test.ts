import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findListing: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyListing: { findFirst: mocks.findListing } } }));

import { assertListingDigitalDownloadDelivery, ListingDigitalDownloadDeliveryError } from './listing-digital-download-delivery';

const context = { shopId: '66615491', sectionId: '18', subSectionId: '30', listingId: '664' };
const digitalTemplate = { printsFrames: true, customisePrints: false, digitalDownload: true };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findListing.mockResolvedValue({ ourCategory: digitalTemplate, productConfig: { digitalDownloadOverride: null } });
});

describe('persisted digital-download delivery policy', () => {
  it('uses the canonical shop and exact listing, section and subsection, selecting only sales settings', async () => {
    await expect(assertListingDigitalDownloadDelivery({ ...context, shopId: '00066615491' })).resolves.toBeUndefined();
    expect(mocks.findListing).toHaveBeenCalledExactlyOnceWith({
      where: { id: 664, shopId: '66615491', subSectionId: 30, subSection: { is: { shopSectionId: 18 } } },
      select: {
        ourCategory: { select: { printsFrames: true, customisePrints: true, digitalDownload: true } },
        productConfig: { select: { digitalDownloadOverride: true } },
      },
    });
  });

  it.each([
    { ourCategory: { ...digitalTemplate, digitalDownload: false }, productConfig: null },
    { ourCategory: { ...digitalTemplate, digitalDownload: false }, productConfig: { digitalDownloadOverride: true } },
    { ourCategory: digitalTemplate, productConfig: { digitalDownloadOverride: false } },
    { ourCategory: null, productConfig: { digitalDownloadOverride: true } },
  ])('rejects disabled digital delivery even if a legacy flag or override tries to enable it: %j', async listing => {
    mocks.findListing.mockResolvedValue(listing);
    await expect(assertListingDigitalDownloadDelivery(context)).rejects.toMatchObject({
      name: 'ListingDigitalDownloadDeliveryError', status: 400,
      message: expect.stringContaining('only available for listings sold as digital downloads'),
    });
  });

  it.each([null, { digitalDownloadOverride: null, digitalDownload: false }, { digitalDownloadOverride: true }])(
    'allows digital templates with inherited or enabled overrides: %j', async productConfig => {
      mocks.findListing.mockResolvedValue({ ourCategory: digitalTemplate, productConfig });
      await expect(assertListingDigitalDownloadDelivery(context)).resolves.toBeUndefined();
    },
  );

  it('rechecks current persisted settings on every call', async () => {
    await assertListingDigitalDownloadDelivery(context);
    mocks.findListing.mockResolvedValue({ ourCategory: digitalTemplate, productConfig: { digitalDownloadOverride: false } });
    await expect(assertListingDigitalDownloadDelivery(context)).rejects.toBeInstanceOf(ListingDigitalDownloadDeliveryError);
    expect(mocks.findListing).toHaveBeenCalledTimes(2);
  });

  it('reports an absent or out-of-scope listing as 404', async () => {
    mocks.findListing.mockResolvedValue(null);
    await expect(assertListingDigitalDownloadDelivery(context)).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    { shopId: '0' }, { shopId: '0x123' }, { sectionId: '-1' }, { subSectionId: '1.5' },
    { listingId: '9007199254740992' }, { listingId: '' },
  ])('rejects invalid identifiers before querying: %j', async invalid => {
    await expect(assertListingDigitalDownloadDelivery({ ...context, ...invalid })).rejects.toMatchObject({ status: 400 });
    expect(mocks.findListing).not.toHaveBeenCalled();
  });

  it('propagates database failures so callers cannot proceed with unverified sales settings', async () => {
    const failure = new Error('Database unavailable');
    mocks.findListing.mockRejectedValue(failure);
    await expect(assertListingDigitalDownloadDelivery(context)).rejects.toBe(failure);
  });
});
