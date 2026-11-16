import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  data: vi.fn(), findListing: vi.fn(), readFingerprint: vi.fn(), saveFingerprint: vi.fn(),
  deleteImages: vi.fn(), generateImages: vi.fn(), generateDetails: vi.fn(), groupedPdf: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyListing: { findUnique: mocks.findListing }, $queryRaw: mocks.readFingerprint, $executeRaw: mocks.saveFingerprint,
} }));
vi.mock('@/lib/listing-editor', () => ({
  getListingEditorData: mocks.data, deleteAllListingImages: mocks.deleteImages,
  generateListingTemplateImages: mocks.generateImages, generateListingPrintableDownload: vi.fn(),
  generateListingHowToPrintGuide: vi.fn(),
}));
vi.mock('@/lib/bedrock-listing-details', () => ({
  generateListingDetailsWithBedrock: vi.fn(), generateMultipleListingDetailsWithBedrock: mocks.generateDetails,
}));
vi.mock('@/lib/dropbox-bundle', () => ({
  createDropboxInstructionPdf: vi.fn(), createGroupedDropboxInstructionPdf: mocks.groupedPdf,
  createOrUpdateDropbox: vi.fn(), isDropboxInstructionPdfFile: (file: { localFileName: string }) => file.localFileName === 'instructions.pdf',
}));

import { generateListingOverview, recordCurrentListingOverviewFingerprint } from '@/lib/listing-overview-generation';

const context = { shopId: '66615491', sectionId: '15', subSectionId: '27', listingId: '99' };
let fingerprint: string | null;
let sourceCrop: Record<string, unknown>;
let sourceTextAreas: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  fingerprint = null;
  sourceCrop = { version: 4, regions: { '2x3': { x: 0, y: 0, width: 5 / 6, height: 1 } } };
  sourceTextAreas = { version: 2, areasByRatio: { '2x3': { top: { y: 0.1 } } } };
  mocks.data.mockResolvedValue({
    section: { sectionName: 'Jellyfish' }, subSection: { name: 'Sets' },
    template: { templateType: 'multiple', imageTemplates: [{ id: 94, name: 'Wall', generated: true }] },
    listing: {
      artworkOrientation: 'portrait', printCropSettings: null, personalisationTextAreas: null,
      title: 'Set', description: 'Set description', digitalTitle: 'Digital set', digitalDescription: 'Digital set description',
      quantity: 99, digitalQuantity: 99, primaryColour: 'Green', secondaryColour: 'White',
    },
    tags: [{ value: 'art' }],
    dropbox: { current: true },
  });
  mocks.findListing.mockImplementation(async (args) => {
    // Return only selected source fields, as Prisma does, so the regression
    // detects a crop field omitted from the actual generation snapshot.
    const sourceFields = args.select.groupItems.select.sourceListing.select as Record<string, unknown>;
    const source = {
      localDirectoryName: 'Source', thumbnailFileName: 'thumbnail.png',
      thumbnailUpdatedAt: new Date('2026-11-13T00:00:00.000Z'), artworkOrientation: 'portrait',
      downloadsRevision: 1, printCropSettings: sourceCrop, personalisationTextAreas: sourceTextAreas,
    };
    return {
      id: 99, images: [{ ourCategoryImageTemplateId: 94 }], files: [{ localFileName: 'instructions.pdf' }],
      groupItems: [{ position: 1, sourceListingId: 548, sourceListing: Object.fromEntries(
        Object.entries(source).filter(([key]) => sourceFields[key]),
      ) }],
    };
  });
  mocks.readFingerprint.mockImplementation(async () => [{ overviewGenerationFingerprint: fingerprint }]);
  mocks.saveFingerprint.mockImplementation(async (query) => { fingerprint = query.values[0] as string; });
});

describe('grouped generation source crops', () => {
  it.each(['crop', 'text areas'] as const)('regenerates Only Changed when a grouped source changes its %s before downloads are rebuilt', async (change) => {
    await recordCurrentListingOverviewFingerprint(context);
    const unchanged = await generateListingOverview(context, 'changed');
    expect(unchanged.generation.regenerated).toBe(false);
    expect(mocks.generateImages).not.toHaveBeenCalled();

    if (change === 'crop') sourceCrop = { ...sourceCrop, regions: { '2x3': { x: 1 / 6, y: 0, width: 5 / 6, height: 1 } } };
    else sourceTextAreas = { ...sourceTextAreas, areasByRatio: { '2x3': { top: { y: 0.2 } } } };
    const updated = await generateListingOverview(context, 'changed');
    expect(updated.generation.regenerated).toBe(true);
    expect(mocks.deleteImages).toHaveBeenCalledWith(context);
    expect(mocks.generateImages).toHaveBeenCalledWith(context);
    expect(mocks.generateDetails).toHaveBeenCalledWith(context);
    expect(mocks.groupedPdf).toHaveBeenCalledWith(context);
  });
});
