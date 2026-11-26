import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ shop: vi.fn(), section: vi.fn(), subSection: vi.fn(), listing: vi.fn(), prices: vi.fn(), query: vi.fn(),
  orientations: vi.fn(), artwork: vi.fn(), render: vi.fn(), read: vi.fn(), mkdir: vi.fn(), write: vi.fn(), remove: vi.fn(), listFiles: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section },
  etsyShopSubSection: { findFirst: mocks.subSection }, etsyListing: { findFirst: mocks.listing }, adminProductPrice: { findMany: mocks.prices }, $queryRaw: mocks.query } }));
vi.mock('@/lib/listing-template-orientation', () => ({ getListingTemplateOrientationPlans: mocks.orientations }));
vi.mock('@/lib/listing-template-artwork', () => ({ getListingTemplateArtworkPlan: mocks.artwork }));
vi.mock('@/lib/our-categories', () => ({ renderOurCategoryImageTemplate: mocks.render }));
vi.mock('@/lib/listing-image-reset', () => ({ removeListingImages: mocks.remove }));
vi.mock('@/lib/s3-listing-storage', () => ({ mkdir: mocks.mkdir, readFile: mocks.read, writeFile: mocks.write, listGeneratedListingImageFiles: mocks.listFiles }));
import { deleteAllListingImages, generateListingTemplateImages } from '@/lib/listing-editor';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft, type ListingArtworkOrientation } from '@/lib/listing-print-crops';
import { createTemplateOrientationPlan } from '@/lib/template-orientation';
import type { ListingTemplateArtworkPlan, ListingTemplateArtworkRole } from '@/lib/listing-template-artwork-policy';
const context = { shopId: '66615491', sectionId: '9', subSectionId: '14', listingId: '266' };
const sceneId = '10000000-0000-4000-8000-000000000001';
const updatedAt = new Date('2026-01-01T00:00:00.000Z'), rendererReached = new Error('Renderer reached');
function makeListing() {
  return { id: 266, localDirectoryName: 'Current', thumbnailFileName: 'current.png' as string | null, thumbnailUpdatedAt: updatedAt,
    productConfig: null, groupItems: [], images: [{ id: 1, ourCategoryImageTemplateId: 94, localFileName: 'template-94.png' }],
    ourCategory: { id: 6, templateType: 'single', itemCount: 1, followedTemplateId: null, customisePrints: false, customTop: false, customBottom: false,
      imageTemplates: [{ id: 94, name: 'First role' }, { id: 95, name: 'Second role' }] } };
}
function sourceListing(id: number, thumbnailFileName: string) { return { id, thumbnailFileName, localDirectoryName: `Source-${id}`, productConfig: null, ourCategory: null,
  subSection: { name: 'Animals', shopSection: { title: 'Art', shop: { shopName: 'Shop', title: null, etsyShopId: 66615491n } } } }; }
let listing: ReturnType<typeof makeListing>, plan: ListingTemplateArtworkPlan;
const extras = new Map<number, Record<string, unknown>>(), sources = new Map<number, ReturnType<typeof sourceListing>>(), files = new Map<string, Buffer>();
function role(id: number, items: Array<[number, string, ListingArtworkOrientation]> = [[7, '266', 'portrait']]): ListingTemplateArtworkRole {
  return { id, name: `Role ${id}`, sceneId, assignmentKey: `${id}:${sceneId}`, mode: 'both', requiresSelection: items.length > 1, valid: true, errors: [],
    items: items.map(([itemNumber, sourceListingId, orientation]) => ({ itemNumber, sourceListingId, orientation, automatic: false })) };
}
async function addSource(id: number, orientation: ListingArtworkOrientation = 'portrait', fileName = id === 266 ? 'current.png' : `source-${id}.png`) {
  const width = orientation === 'portrait' ? 60 : 90, height = orientation === 'portrait' ? 90 : 60;
  files.set(fileName, await sharp({ create: { width, height, channels: 4, background: id === 266 ? '#ee2200' : '#0022ee' } }).png().toBuffer());
  extras.set(id, { artworkOrientation: orientation, thumbnailUpdatedAt: updatedAt, personalisationTextAreas: null,
    printCropSettings: createListingPrintCropSettings(defaultNativeListingPrintCropDraft(width, height, orientation), { width, height, fileName, updatedAt: updatedAt.toISOString() }, orientation) });
  sources.set(id, sourceListing(id, fileName));
}
beforeEach(() => {
  vi.clearAllMocks(); extras.clear(); sources.clear(); files.clear(); listing = makeListing();
  plan = { categoryId: 6, orientation: 'portrait', valid: true, errors: [], roles: [role(94), role(95)], candidates: [], assignments: {} };
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: null });
  mocks.section.mockResolvedValue({ id: 9, title: 'Art' }); mocks.subSection.mockResolvedValue({ id: 14, name: 'Animals' }); mocks.prices.mockResolvedValue([]);
  mocks.listing.mockImplementation(async ({ where }) => where.shopId ? sources.get(where.id) : listing);
  mocks.query.mockImplementation(async (sql, id) => {
    const value = id ?? sql.values?.[0]; return extras.has(value) ? [extras.get(value)] : [];
  });
  const orientations = createTemplateOrientationPlan(6, {}, [94, 95].map((id) => ({ id, name: `Role ${id}`, neutral: false,
    portrait: { sceneId, itemMapping: null, mode: 'both', openings: [{ imageItemNumber: 7, orientation: 'portrait' }] } })));
  mocks.orientations.mockResolvedValue(new Map([[6, orientations]])); mocks.artwork.mockImplementation(async () => plan);
  mocks.render.mockRejectedValue(rendererReached); mocks.listFiles.mockResolvedValue([]);
  mocks.read.mockImplementation(async (filePath: string) => {
    const name = filePath.replaceAll('\\', '/').split('/').at(-1)!, contents = files.get(name);
    if (!contents) throw new Error(`Source file missing: ${name}`); return contents;
  });
});

describe('whole-listing artwork preflight and per-definition renderer routing', () => {
  it('blocks a requested valid role when any other role is invalid, before rendering or removing images', async () => {
    plan.valid = false; plan.roles[1].valid = false; plan.errors = ['Second role needs artwork item 2.'];
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('Second role needs artwork item 2.');
    expect(mocks.render).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.listFiles).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('blocks generation cleanup when any role is invalid, retaining all previous photos', async () => {
    plan.valid = false; plan.errors = ['A Combined image is missing landscape artwork.'];
    await expect(deleteAllListingImages(context, { forGeneration: true })).rejects.toThrow('A Combined image is missing landscape artwork.');
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.listFiles).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
  });
  it('reads every selected source before cleanup and blocks if its original file is missing', async () => {
    await addSource(266); await addSource(11); plan.roles[1] = role(95, [[3, '266', 'portrait'], [9, '11', 'portrait']]); files.delete('source-11.png');
    await expect(deleteAllListingImages(context, { forGeneration: true })).rejects.toThrow('Source file missing: source-11.png');
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.listFiles).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
  });
  it('blocks before cleanup if live source crop settings have become incomplete', async () => {
    await addSource(266); extras.get(266)!.printCropSettings = null;
    await expect(deleteAllListingImages(context, { forGeneration: true })).rejects.toThrow('Complete Set Size for listing 266');
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
  });
  it('revalidates freshly read source orientation before cleanup if it changed after the artwork plan', async () => {
    await addSource(266, 'landscape');
    await expect(deleteAllListingImages(context, { forGeneration: true })).rejects.toThrow(/orientation|portrait/i);
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.listFiles).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
  });
  it('renders No areas without an own thumbnail, sizes, text areas, or any source read', async () => {
    listing.thumbnailFileName = null; listing.ourCategory.customisePrints = true;
    plan.roles = [{ ...role(94, []), mode: 'no-areas', requiresSelection: false }];
    await expect(generateListingTemplateImages(context, 94)).rejects.toBe(rendererReached);
    expect(mocks.render.mock.calls[0][1]).toEqual(new Map()); expect(mocks.render.mock.calls[0][5]).toEqual(new Map());
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.listing).toHaveBeenCalledTimes(1); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('keeps original scene item IDs and reads a repeatedly selected source only once per preflight', async () => {
    await addSource(266); plan.roles[0] = role(94, [[3, '266', 'portrait'], [99, '266', 'portrait']]);
    await expect(generateListingTemplateImages(context, 94)).rejects.toBe(rendererReached);
    const args = mocks.render.mock.calls[0]; expect([...args[1].keys()]).toEqual([3, 99]);
    expect(args[1].get(3)).toBe(files.get('current.png')); expect(args[1].get(99)).toBe(files.get('current.png'));
    expect(args[9]).toEqual({ sourceItemNumbersAreSceneItems: true }); expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.artwork).toHaveBeenCalledWith(context, { includeCandidates: false }); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('routes independent selections for two definitions sharing the same scene/item numbers', async () => {
    await addSource(266); await addSource(11);
    plan.roles = [role(94, [[3, '266', 'portrait'], [9, '11', 'portrait']]), role(95, [[3, '11', 'portrait'], [9, '266', 'portrait']])];
    await expect(generateListingTemplateImages(context, 94)).rejects.toBe(rendererReached);
    expect(mocks.render.mock.calls[0][0]).toBe(94); expect(mocks.render.mock.calls[0][1].get(3)).toBe(files.get('current.png'));
    expect(mocks.render.mock.calls[0][1].get(9)).toBe(files.get('source-11.png')); expect(mocks.read).toHaveBeenCalledTimes(2);
    mocks.render.mockClear(); mocks.read.mockClear();
    await expect(generateListingTemplateImages(context, 95)).rejects.toBe(rendererReached);
    expect(mocks.render.mock.calls[0][0]).toBe(95); expect(mocks.render.mock.calls[0][1].get(3)).toBe(files.get('source-11.png'));
    expect(mocks.render.mock.calls[0][1].get(9)).toBe(files.get('current.png')); expect(mocks.read).toHaveBeenCalledTimes(2);
  });
});
