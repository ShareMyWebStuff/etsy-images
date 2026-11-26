import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findListing: vi.fn(), groupedPdf: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyListing: { findFirst: mocks.findListing } } }));
vi.mock('@/lib/dropbox-bundle', () => ({ createGroupedDropboxInstructionPdf: mocks.groupedPdf }));
vi.mock('@/lib/listing-editor', () => ({
  getListingEditorData: mocks.refresh, generateListingTemplateImages: vi.fn(), deleteAllListingImages: vi.fn(),
  getGroupedListingThumbnail: vi.fn(), preflightListingImageGeneration: vi.fn(), saveListingGroupItems: vi.fn(),
}));
vi.mock('@/lib/bedrock-listing-details', () => ({ generateListingDetailsWithBedrock: vi.fn(), generateMultipleListingDetailsWithBedrock: vi.fn() }));
vi.mock('@/lib/listing-overview-generation', () => ({ generateListingOverview: vi.fn(), recordCurrentListingOverviewFingerprint: vi.fn() }));

import { POST } from './route';

const context = { shopId: '66615491', sectionId: '18', subSectionId: '30', listingId: '664' };
function request() {
  return new Request('http://localhost/api/shops/listings/editor/overview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...context, action: 'grouped-pdf' }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.findListing.mockResolvedValue({ ourCategory: { printsFrames: true, customisePrints: false, digitalDownload: false }, productConfig: null });
  mocks.refresh.mockResolvedValue({ context });
});

describe('overview grouped-PDF delivery policy', () => {
  it('blocks a physical-only group before source Dropbox links, PDF storage or DTO refresh', async () => {
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining('only available for listings sold as digital downloads') });
    expect(mocks.groupedPdf).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('creates digital group instructions only after its persisted flag is checked', async () => {
    mocks.findListing.mockResolvedValue({ ourCategory: { printsFrames: true, customisePrints: false, digitalDownload: true },
      productConfig: { digitalDownloadOverride: null } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.groupedPdf).toHaveBeenCalledExactlyOnceWith(context);
    expect(mocks.findListing.mock.invocationCallOrder[0]).toBeLessThan(mocks.groupedPdf.mock.invocationCallOrder[0]);
    expect(await response.json()).toEqual({ data: { context } });
  });
});
