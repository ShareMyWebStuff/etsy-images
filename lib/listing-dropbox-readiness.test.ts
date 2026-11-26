import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), update: vi.fn(), read: vi.fn(), orientations: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyListing: { update: mocks.update } } }));
vi.mock('@/lib/dropbox-bundle', () => ({ inspectListingZipStorage: mocks.inspect,
  isDropboxInstructionPdfFile: (file: { rawJson?: { kind?: string } }) => file.rawJson?.kind === 'dropbox_instruction_pdf' }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read }));
vi.mock('@/lib/listing-template-orientation', () => ({ getListingTemplateOrientationPlans: mocks.orientations }));
import { mapEditorData } from '@/lib/listing-editor';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';
import { PRINTABLE_DOWNLOAD_SPECS } from '@/lib/printable-download-specs';
const context = { shopId: '66615491', sectionId: '9', subSectionId: '14', listingId: '664' };
const timestamp = new Date('2026-11-25T12:00:00.000Z');
function source(templateType: 'single' | 'multiple', digitalDownload: boolean, digitalDownloadOverride: boolean | null = null) {
  const cropSource = { width: 600, height: 900, fileName: 'art.png', updatedAt: timestamp.toISOString() };
  return {
    shop: { id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: null }, section: { id: 9, title: 'Art', etsyShopSectionId: 123 },
    subSection: { id: 14, name: 'Single', numberOfDownloads: 1, includeAllDownloads: false }, adminPrices: [], groupCandidates: [],
    listing: {
      id: 664, title: 'Artwork', localDirectoryName: 'Artwork', listingItem: 'Artwork', listingDescription: 'Artwork', description: 'Print details',
      digitalTitle: 'Download title', digitalDescription: 'Download details', digitalQuantity: 999, quantity: 999, primaryColour: 'Green', secondaryColour: 'White',
      roomTheme: 'Gallery', backgroundColour: '#FFFFFF', state: 'local', etsyProductType: 'physical', numberOfItems: templateType === 'multiple' ? 3 : 1, includeAllItems: false,
      thumbnailFileName: cropSource.fileName, thumbnailOriginalFileName: 'Original.png', thumbnailUpdatedAt: timestamp,
      thumbnailWidthPixels: cropSource.width, thumbnailHeightPixels: cropSource.height, artworkOrientation: 'portrait',
      printCropSettings: createListingPrintCropSettings(defaultNativeListingPrintCropDraft(cropSource.width, cropSource.height), cropSource),
      imageGenerationState: { revision: 1, generatedRevision: 1, needsRegeneration: false },
      productConfig: { listOnEtsy: true, printsFrames: true, digitalDownload: true, digitalDownloadOverride, printsFramesOverride: null,
        customisePrints: false, customTop: false, customBottom: false, sku: 'ART-664' },
      ourCategory: { id: 6, name: 'Template', templateType, itemCount: templateType === 'multiple' ? 3 : 1, followedTemplateId: null,
        printsFrames: true, customisePrints: false, digitalDownload, customTop: false, customBottom: false, backgroundColour: '#FFFFFF',
        printFrameSectionId: 1, customisedSectionId: null, downloadSection: digitalDownload ? { id: 2, etsyShopSectionId: 456, title: 'Downloads' } : null,
        sizes: {}, frames: {}, imageTemplates: [{ id: 94, name: 'Room', position: 0 }] },
      images: [{ id: 1, localFileName: 'template-94.png', originalFileName: 'Room.png', ourCategoryImageTemplateId: 94, rank: 1,
        fullWidth: 2000, fullHeight: 2000, updatedAt: timestamp, createdAt: timestamp }],
      files: [...PRINTABLE_DOWNLOAD_SPECS.map((spec, index) => ({ id: index + 1, localFileName: `Artwork_${spec.fileToken}.jpg`,
        originalFileName: `Artwork_${spec.fileToken}.jpg`, filename: `Artwork_${spec.fileToken}.jpg`, widthPixels: spec.portraitWidth,
        heightPixels: spec.portraitHeight, sizeBytes: 1000, rawJson: {}, rank: index + 1 })),
        { id: 10, localFileName: 'How_To_Print_Guide.pdf', originalFileName: 'How_To_Print_Guide.pdf', filename: 'How_To_Print_Guide.pdf',
          widthPixels: null, heightPixels: null, sizeBytes: 1000, rawJson: {}, rank: 10 }],
      groupItems: templateType === 'multiple' ? [1, 2, 3].map((position) => ({ position, sourceListingId: position,
        sourceListing: { id: position, title: `Source ${position}`, localDirectoryName: `Source ${position}`, artworkOrientation: 'portrait',
          subSectionId: 14, subSection: { shopSectionId: 9 }, thumbnailFileName: `source-${position}.png`, thumbnailUpdatedAt: timestamp } })) : [],
      tags: [{ id: 1, tag: 'art', position: 0 }], materials: [], styles: [], videos: [], translations: [], inventoryItems: [], personalizations: [], buyerPrices: [],
      products: [], zippedFiles: [], dropboxFiles: [{ groupNumber: 1 }], orderItems: [],
      dropboxBundle: { folderPath: '/managed/existing', sharedUrl: 'https://example.com/existing', updatedAt: timestamp },
      dropboxSyncedAt: timestamp, dropboxRevision: 1, downloadsRevision: 2, detailsChanged: false, tagsChanged: false, imagesChanged: false,
      downloadsChanged: false, productsChanged: false,
    },
  };
}
async function map(data: ReturnType<typeof source>) { return mapEditorData(context, data as unknown as Parameters<typeof mapEditorData>[1]); }
beforeEach(() => { vi.clearAllMocks(); mocks.orientations.mockResolvedValue(new Map()); mocks.inspect.mockResolvedValue({ valid: false }); });

describe('effective digital-download Dropbox readiness', () => {
  it.each([
    { templateType: 'single' as const, digital: false, override: null },
    { templateType: 'multiple' as const, digital: false, override: null },
    { templateType: 'single' as const, digital: true, override: false },
    { templateType: 'multiple' as const, digital: true, override: false },
    { templateType: 'single' as const, digital: false, override: true },
  ])('skips Dropbox requirements/storage checks for $templateType digital=$digital override=$override without deleting an existing bundle', async ({ templateType, digital, override }) => {
    const data = await map(source(templateType, digital, override));
    expect(data.dropbox).toMatchObject({ action: null, canCreateZips: false, zipsCurrent: false,
      message: 'Dropbox is only needed for listings sold as digital downloads.',
      bundle: { folderPath: '/managed/existing', sharedUrl: 'https://example.com/existing' } });
    expect(data.todoItems.some((item) => /Dropbox|grouped download instructions/i.test(item.label))).toBe(false);
    expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(['single', 'multiple'] as const)('still requires delivery for a digital-enabled %s listing', async (templateType) => {
    const input = source(templateType, true), data = await map(input);
    expect(data.dropbox.action).toBe('update'); expect(data.dropbox.canCreateZips).toBe(true);
    expect(data.todoItems).toContainEqual(templateType === 'single'
      ? { label: 'Create or update Dropbox', tab: 'dropbox' }
      : { label: 'Create the grouped download instructions PDF', tab: 'downloads' });
    expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith(input.listing, expect.any(String));
  });
  it('continues to require printable masters and the guide for a physical-only single listing', async () => {
    const input = source('single', false); input.listing.files = [];
    const data = await map(input);
    expect(data.todoItems).toContainEqual({ label: 'Create all printable downloads and the How to Print guide', tab: 'downloads' });
    expect(data.todoItems.some((item) => item.tab === 'dropbox')).toBe(false); expect(mocks.inspect).not.toHaveBeenCalled();
  });
});
