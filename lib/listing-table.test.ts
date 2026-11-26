import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listings: vi.fn(), orientations: vi.fn(),artworks:vi.fn(), inspect: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: async () => ({ id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: 'Shop' }) },
  etsyShopSection: { findFirst: async () => ({ id: 2, title: 'Prints', etsyShopSectionId: null }) },
  etsyShopSubSection: { findFirst: async () => ({ id: 3, name: 'Animals', numberOfDownloads: 1, includeAllDownloads: false }) },
  etsyListing: { findMany: mocks.listings }, ourCategory: { findMany: async () => [] },
} }));
vi.mock('@/lib/dropbox-bundle', () => ({ inspectListingZipStorage: mocks.inspect, isDropboxInstructionPdfFile: () => false }));
vi.mock('@/lib/listing-image-generation-state', () => ({ listingsNeedingImageGeneration: async () => new Set() }));
vi.mock('@/lib/listing-template-orientation', () => ({ getListingTemplateOrientationPlans: mocks.orientations }));
vi.mock('@/lib/listing-template-artwork',()=>({getListingTemplateArtworkPlans:mocks.artworks}));
import { getSubSectionListingsPageData } from './listing-table';
import { createTemplateOrientationPlan } from '@/lib/template-orientation';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';
import { PRINTABLE_DOWNLOAD_SPECS } from '@/lib/printable-download-specs';

beforeEach(() => {mocks.orientations.mockResolvedValue(new Map());mocks.artworks.mockResolvedValue(new Map());mocks.inspect.mockResolvedValue({valid:false});mocks.inspect.mockClear();});

function listing(id: number, thumbnailFileName: string | null, thumbnailUpdatedAt: Date | null) {
  return { id, title: `Artwork ${id}`, localDirectoryName: `Artwork ${id}`, thumbnailFileName, thumbnailUpdatedAt,
    artworkOrientation: 'portrait', numberOfItems: 1, ourCategoryId: null, sourceSection: null, ourCategory: null, state: 'local',
    etsyId: null, etsyDownloadId: null, etsyDownloadState: null, priceAmount: 2999, priceDivisor: 100, priceCurrencyCode: 'GBP', quantity: 999,
    tags: [], images: [], files: [], zippedFiles: [], products: [], dropboxFiles: [], groupItems: [], productConfig: null,
    dropboxBundle: null, dropboxSyncedAt: null, dropboxRevision: 0, downloadsRevision: 0, listingDescription: null,
    description: null, digitalTitle: null, digitalDescription: null, digitalQuantity: null, primaryColour: null, secondaryColour: null,
    printCropSettings: null };
}

describe('listing table artwork availability', () => {
  it('always maps an actual thumbnail boolean and ISO version, including blank and absent filenames', async () => {
    const timestamp = new Date('2026-11-21T14:20:00.000Z');
    mocks.listings.mockResolvedValue([listing(79, 'thumbnail.png', timestamp), listing(80, null, null), listing(81, '  ', null), listing(82, '', null)]);
    const data = await getSubSectionListingsPageData('66615491', '2', '3');
    expect(data?.listings.map(({ id, hasThumbnail, thumbnailUpdatedAt }) => ({ id, hasThumbnail, thumbnailUpdatedAt }))).toEqual([
      { id: '79', hasThumbnail: true, thumbnailUpdatedAt: timestamp.toISOString() },
      { id: '80', hasThumbnail: false, thumbnailUpdatedAt: null },
      { id: '81', hasThumbnail: false, thumbnailUpdatedAt: null },
      { id: '82', hasThumbnail: false, thumbnailUpdatedAt: null },
    ]);
    expect(mocks.listings).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ thumbnailFileName: true, thumbnailUpdatedAt: true }) }));
  });

  it('blocks a mismatched room even when a compatible general image already exists', async () => {
    const timestamp = new Date('2026-11-24T12:00:00.000Z');
    const source = { fileName: 'art.png', updatedAt: timestamp.toISOString(), width: 300, height: 200 };
    const row = {
      ...listing(79, source.fileName, timestamp), artworkOrientation: 'landscape', ourCategoryId: 6,
      description: 'Print description', digitalTitle: 'Download title', digitalDescription: 'Download description', digitalQuantity: 99,
      listingDescription: 'Artwork', primaryColour: 'Green', secondaryColour: 'White', tags: [{ id: 1 }],
      printCropSettings: createListingPrintCropSettings(defaultNativeListingPrintCropDraft(source.width, source.height, 'landscape'), source, 'landscape'),
      productConfig: { sku: 'ART-79', printsFramesOverride: null, digitalDownloadOverride: null, customisePrints: false, customTop: false, customBottom: false },
      ourCategory: { templateType: 'single', itemCount: 1, printsFrames: true, customisePrints: false, customTop: false, customBottom: false,
        digitalDownload: false, printFrameSection: null, customisedSection: null, downloadSection: null, imageTemplates: [{ id: 94 }, { id: 95 }] },
      images: [{ ourCategoryImageTemplateId: 95 }], dropboxBundle: { sharedUrl: 'https://example.com/art' },
      dropboxSyncedAt: timestamp, dropboxRevision: 1, downloadsRevision: 1,
      files: [...PRINTABLE_DOWNLOAD_SPECS.map((spec) => ({ localFileName: `Artwork_${spec.fileToken}.jpg`, originalFileName: `Artwork_${spec.fileToken}.jpg`,
        filename: `Artwork_${spec.fileToken}.jpg`, widthPixels: spec.portraitHeight, heightPixels: spec.portraitWidth, rawJson: {} })),
      { localFileName: 'How_To_Print_Guide.pdf', originalFileName: 'How_To_Print_Guide.pdf', filename: 'How_To_Print_Guide.pdf' }],
    };
    const plan = createTemplateOrientationPlan(6, { portraitEnabled: true, landscapeEnabled: false }, [
      { id: 94, name: 'Landing image', neutral: false, portrait: { sceneId: '11111111-1111-4111-8111-111111111111',
        itemMapping: null, openings: [{ imageItemNumber: 1, orientation: 'portrait' }] } },
      { id: 95, name: 'Size guide', neutral: true },
    ]);
    mocks.orientations.mockResolvedValue(new Map([[6, plan]]));
    mocks.listings.mockResolvedValue([row]);
    const data = await getSubSectionListingsPageData('66615491', '2', '3');
    expect(data?.listings[0]).toMatchObject({ id: '79', artworkOrientation: 'landscape', isComplete: false,
      orientationWarning: expect.stringContaining('does not support landscape') });
    expect(mocks.orientations).toHaveBeenCalledWith([6]);
    mocks.listings.mockResolvedValue([{ ...row, images: [] }]);
    expect((await getSubSectionListingsPageData('66615491', '2', '3'))?.listings[0].isComplete).toBe(false);

    const readyPlan=createTemplateOrientationPlan(6,{},[{id:94,name:'Room',neutral:true},{id:95,name:'Guide',neutral:true}]);
    mocks.orientations.mockResolvedValue(new Map([[6,readyPlan]]));
    mocks.listings.mockResolvedValue([{...row,images:[{ourCategoryImageTemplateId:94},{ourCategoryImageTemplateId:95}]}]);
    mocks.artworks.mockResolvedValue(new Map([[79,{valid:true,errors:[],roles:[{id:94},{id:95}]}]]));
    expect((await getSubSectionListingsPageData('66615491','2','3'))?.listings[0]).toMatchObject({isComplete:true,orientationWarning:null});
    mocks.artworks.mockResolvedValue(new Map([[79,{valid:false,errors:['Room: Choose artwork item 2.'],roles:[{id:94},{id:95}]}]]));
    expect((await getSubSectionListingsPageData('66615491','2','3'))?.listings[0]).toMatchObject({isComplete:false,
      orientationWarning:'Room: Choose artwork item 2.',artworkAssignmentErrors:['Room: Choose artwork item 2.']});
    expect(mocks.artworks).toHaveBeenLastCalledWith([{shopId:'66615491',sectionId:'2',subSectionId:'3',listingId:'79'}],
      expect.objectContaining({includeCandidates:false}));
  });

  it.each([
    { type: 'single', digital: false, override: null, complete: true },
    { type: 'single', digital: true, override: false, complete: true },
    { type: 'single', digital: true, override: null, complete: false },
    { type: 'multiple', digital: false, override: null, complete: true },
    { type: 'multiple', digital: true, override: null, complete: false },
  ])('uses effective digital delivery for $type digital=$digital override=$override without requiring physical-only Dropbox', async ({ type, digital, override, complete }) => {
    const timestamp = new Date('2026-11-25T12:00:00Z'), cropSource = { width: 600, height: 900, fileName: 'art.png', updatedAt: timestamp.toISOString() };
    const row = { ...listing(79, cropSource.fileName, timestamp), ourCategoryId: 6, description: 'Print details', listingDescription: 'Artwork',
      digitalTitle: 'Download title', digitalDescription: 'Download details', digitalQuantity: 999, primaryColour: 'Green', secondaryColour: 'White',
      tags: [{ id: 1 }], images: [{ ourCategoryImageTemplateId: 94 }],
      printCropSettings: createListingPrintCropSettings(defaultNativeListingPrintCropDraft(cropSource.width, cropSource.height), cropSource),
      productConfig: { sku: 'ART-79', printsFramesOverride: null, digitalDownloadOverride: override, customisePrints: false, customTop: false, customBottom: false },
      ourCategory: { templateType: type, itemCount: type === 'multiple' ? 3 : 1, printsFrames: true, customisePrints: false, digitalDownload: digital,
        customTop: false, customBottom: false, downloadSection: { etsyShopSectionId: 456 }, imageTemplates: [{ id: 94 }] },
      groupItems: type === 'multiple' ? [1, 2, 3].map((position) => ({ id: position, position, sourceListing: { artworkOrientation: 'portrait' } })) : [],
      files: [...PRINTABLE_DOWNLOAD_SPECS.map((spec) => ({ localFileName: `Artwork_${spec.fileToken}.jpg`, originalFileName: `Artwork_${spec.fileToken}.jpg`,
        filename: `Artwork_${spec.fileToken}.jpg`, widthPixels: spec.portraitWidth, heightPixels: spec.portraitHeight, rawJson: {} })),
      { localFileName: 'How_To_Print_Guide.pdf', originalFileName: 'How_To_Print_Guide.pdf', filename: 'How_To_Print_Guide.pdf' }],
    };
    mocks.listings.mockResolvedValue([row]);
    expect((await getSubSectionListingsPageData('66615491', '2', '3'))?.listings[0].isComplete).toBe(complete);
    if (complete) expect(mocks.inspect).not.toHaveBeenCalled(); else expect(mocks.inspect).toHaveBeenCalledTimes(1);
  });
});
