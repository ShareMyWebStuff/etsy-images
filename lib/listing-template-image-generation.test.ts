import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shop: vi.fn(), section: vi.fn(), subSection: vi.fn(), listing: vi.fn(), prices: vi.fn(),
  query: vi.fn(), render: vi.fn(), read: vi.fn(), mkdir: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section },
  etsyShopSubSection: { findFirst: mocks.subSection }, etsyListing: { findFirst: mocks.listing },
  adminProductPrice: { findMany: mocks.prices }, $queryRaw: mocks.query,
} }));
vi.mock('@/lib/our-categories', () => ({ renderOurCategoryImageTemplate: mocks.render }));
vi.mock('@/lib/s3-listing-storage', () => ({ mkdir: mocks.mkdir, readFile: mocks.read }));

import { generateListingTemplateImages, getGroupedListingThumbnail } from '@/lib/listing-editor';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft, type ListingArtworkOrientation } from '@/lib/listing-print-crops';

const context = { shopId: '66615491', sectionId: '9', subSectionId: '14', listingId: '266' };
const updatedAt = new Date('2026-01-01T00:00:00.000Z');
const rendered = new Error('Renderer reached');
let mainListing: ReturnType<typeof makeListing>;
const sources = new Map<number, ReturnType<typeof sourceListing>>();
const extras = new Map<number, Record<string, unknown>>();
const images = new Map<string, Buffer>();

function makeListing() {
  return {
    id: 266, localDirectoryName: 'Current', thumbnailFileName: 'current.png', thumbnailUpdatedAt: updatedAt,
    productConfig: null, groupItems: [] as Array<{ position: number; sourceListingId: number }>,
    ourCategory: {
      id: 6, templateType: 'single', itemCount: 1, followedTemplateId: null,
      customisePrints: false, customTop: false, customBottom: false,
      imageTemplates: [{ id: 94, name: 'Wall' }],
    },
  };
}

function sourceListing(id: number) {
  return {
    id, thumbnailFileName: `source-${id}.png`, localDirectoryName: `Source-${id}`, productConfig: null, ourCategory: null,
    subSection: { name: 'Animals', shopSection: { title: 'Art', shop: { shopName: 'Shop', title: null, etsyShopId: BigInt(66615491) } } },
  };
}

async function addSource(id: number, orientation: ListingArtworkOrientation, fileName = `source-${id}.png`) {
  const width = orientation === 'landscape' ? 90 : 60;
  const height = orientation === 'landscape' ? 60 : 90;
  images.set(fileName, await sharp({ create: { width, height, channels: 4, background: '#ff0000' } }).png().toBuffer());
  extras.set(id, {
    artworkOrientation: orientation, thumbnailUpdatedAt: updatedAt, personalisationTextAreas: null,
    printCropSettings: createListingPrintCropSettings(defaultNativeListingPrintCropDraft(width, height, orientation), {
      fileName, updatedAt: updatedAt.toISOString(), width, height,
    }, orientation),
  });
  if (id !== 266) sources.set(id, sourceListing(id));
}

beforeEach(() => {
  vi.clearAllMocks();
  images.clear(); sources.clear(); extras.clear();
  mainListing = makeListing();
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: BigInt(66615491), shopName: 'Shop', title: null });
  mocks.section.mockResolvedValue({ id: 9, title: 'Art' });
  mocks.subSection.mockResolvedValue({ id: 14, name: 'Animals' });
  mocks.listing.mockImplementation(async (args) => args.where.shopId ? sources.get(args.where.id) : mainListing);
  mocks.prices.mockResolvedValue([]);
  mocks.query.mockImplementation(async (_sql: TemplateStringsArray, id: number) => extras.has(id) ? [extras.get(id)] : []);
  mocks.read.mockImplementation(async (filePath: string) => {
    const fileName = filePath.replaceAll('\\', '/').split('/').at(-1)!;
    const buffer = images.get(fileName);
    if (!buffer) throw new Error(`Unexpected storage read: ${fileName}`);
    return buffer;
  });
  mocks.render.mockRejectedValue(rendered);
});

describe('listing image generation source orientation routing', () => {
  it('passes a landscape listing orientation with its crop settings to the template renderer', async () => {
    await addSource(266, 'landscape', 'current.png');
    await expect(generateListingTemplateImages(context)).rejects.toBe(rendered);
    expect(mocks.render).toHaveBeenCalledTimes(1);
    const args = mocks.render.mock.calls[0];
    expect(args[7]).toEqual(new Map([[1, 'landscape']]));
    expect(args[5].get(1).orientation).toBe('landscape');
  });

  it('passes the orientation of each grouped source using the selected image position', async () => {
    mainListing.ourCategory.templateType = 'multiple';
    mainListing.ourCategory.itemCount = 3;
    mainListing.groupItems = [{ position: 1, sourceListingId: 12 }, { position: 2, sourceListingId: 11 }, { position: 3, sourceListingId: 13 }];
    await addSource(11, 'landscape');
    await addSource(12, 'portrait');
    await addSource(13, 'landscape');
    await expect(generateListingTemplateImages(context, 94)).rejects.toBe(rendered);
    expect(mocks.render.mock.calls[0][7]).toEqual(new Map([[1, 'portrait'], [2, 'landscape'], [3, 'landscape']]));
  });

  it('detects a legacy grouped thumbnail orientation when no stored orientation exists', async () => {
    await addSource(11, 'landscape');
    extras.get(11)!.artworkOrientation = null;
    const source = await getGroupedListingThumbnail(context, '11');
    expect(source.artworkOrientation).toBe('landscape');
    expect(source.printCropSettings?.orientation).toBe('landscape');
  });
});
