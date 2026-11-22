import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ shop: vi.fn(), section: vi.fn(), subSections: vi.fn(), listings: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section },
  etsyShopSubSection: { findMany: mocks.subSections }, etsyListing: { findMany: mocks.listings } } }));
import { getListingGallery } from '@/lib/listing-gallery';

const shopId = '66615491', sectionId = '2';
const updated = new Date('2026-11-22T09:20:30.000Z');
const subsections = [{ id: 3, shopSectionId: 2 }, { id: 7, shopSectionId: 2 }, { id: 9, shopSectionId: 8 }];
type Row = { id: number; title: string; localDirectoryName: string | null; thumbnailFileName: string | null; thumbnailUpdatedAt: Date | null;
  shopId: string; shopSectionId: number | null; subSectionId: number | null };
let rows: Row[];
let linkedSection: bigint | null;
function row(id: number, subSectionId: number | null, overrides: Partial<Row> = {}): Row {
  return { id, title: `Artwork ${id}`, localDirectoryName: `Local ${id}`, thumbnailFileName: 'thumbnail.png', thumbnailUpdatedAt: updated,
    shopId, shopSectionId: null, subSectionId, ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks(); linkedSection = null;
  rows = [row(10, 3), row(11, 7), row(12, 9), row(13, 3, { shopId: '999' }), row(14, null, { shopSectionId: 1234 })];
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: BigInt(shopId) });
  mocks.section.mockImplementation(async ({ where }) => where.id === 2 && where.OR.some((owner: { shopId?: number; etsyShopId?: bigint }) => owner.shopId === 1 || owner.etsyShopId === BigInt(shopId))
    ? { id: 2, title: 'Japanese Landscapes', etsyShopSectionId: linkedSection } : null);
  mocks.subSections.mockImplementation(async ({ where }) => subsections.filter((subsection) => subsection.shopSectionId === where.shopSectionId).map(({ id }) => ({ id })));
  mocks.listings.mockImplementation(async ({ where }) => rows.filter((listing) => listing.shopId === where.shopId && where.OR.some((branch: {
    subSection?: { is: { shopSectionId: number } }; subSectionId?: null; shopSectionId?: number;
  }) => branch.subSection
    ? subsections.some((subsection) => subsection.id === listing.subSectionId && subsection.shopSectionId === branch.subSection!.is.shopSectionId)
    : listing.subSectionId === null && listing.shopSectionId === branch.shopSectionId))
    .sort((first, second) => first.title.localeCompare(second.title) || first.id - second.id));
});

describe('section listing gallery metadata', () => {
  it('includes every subsection and excludes other shops and sections using only lightweight listing columns', async () => {
    const result = await getListingGallery(shopId, sectionId);
    expect(result).toEqual({ sectionName: 'Japanese Landscapes', listings: [
      { id: '10', listingName: 'Local 10', hasThumbnail: true, thumbnailUpdatedAt: updated.toISOString(), subSectionId: '3' },
      { id: '11', listingName: 'Local 11', hasThumbnail: true, thumbnailUpdatedAt: updated.toISOString(), subSectionId: '7' },
    ] });
    expect(mocks.listings).toHaveBeenCalledWith({
      where: { shopId, OR: [{ subSection: { is: { shopSectionId: 2 } } }] },
      select: { id: true, title: true, localDirectoryName: true, thumbnailFileName: true, thumbnailUpdatedAt: true, subSectionId: true },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });
    expect(mocks.subSections).toHaveBeenCalledWith({ where: { shopSectionId: 2 }, select: { id: true }, orderBy: { id: 'asc' } });
  });

  it('includes matching unassigned Etsy rows with a first-subsection preview context, without stealing assigned rows', async () => {
    linkedSection = 1234n;
    rows.push(row(15, null, { shopSectionId: 5678 }), row(16, 9, { shopSectionId: 1234 }), row(17, null, { shopSectionId: 1234, shopId: '999' }));
    const result = await getListingGallery(shopId, sectionId);
    expect(result.listings.map(({ id, subSectionId }) => ({ id, subSectionId }))).toEqual([
      { id: '10', subSectionId: '3' }, { id: '11', subSectionId: '7' }, { id: '14', subSectionId: '3' },
    ]);
    expect(mocks.listings.mock.calls[0][0].where).toEqual({ shopId, OR: [
      { subSection: { is: { shopSectionId: 2 } } }, { subSectionId: null, shopSectionId: 1234 },
    ] });
  });

  it('keeps remote-only metadata visible with no preview context when the section has no subsections', async () => {
    linkedSection = 1234n; rows = [row(14, null, { shopSectionId: 1234 })]; mocks.subSections.mockResolvedValue([]);
    expect((await getListingGallery(shopId, sectionId)).listings[0]).toMatchObject({ id: '14', hasThumbnail: true, subSectionId: null });
  });

  it('maps absent and blank thumbnails, nullable dates and the title fallback without exposing filenames', async () => {
    rows = [row(20, 3, { localDirectoryName: null, thumbnailFileName: null, thumbnailUpdatedAt: null }),
      row(21, 7, { thumbnailFileName: '  ', thumbnailUpdatedAt: null }), row(22, 7, { thumbnailFileName: '' })];
    const result = await getListingGallery(shopId, sectionId);
    expect(result.listings).toEqual([
      { id: '20', listingName: 'Artwork 20', hasThumbnail: false, thumbnailUpdatedAt: null, subSectionId: '3' },
      { id: '21', listingName: 'Local 21', hasThumbnail: false, thumbnailUpdatedAt: null, subSectionId: '7' },
      { id: '22', listingName: 'Local 22', hasThumbnail: false, thumbnailUpdatedAt: updated.toISOString(), subSectionId: '7' },
    ]);
    expect(JSON.stringify(result)).not.toContain('thumbnail.png');
  });

  it('retains title/id ordering across subsections even when displayed local names differ', async () => {
    rows = [row(30, 7, { title: 'B', localDirectoryName: 'First display name' }), row(29, 3, { title: 'A' }), row(28, 7, { title: 'A' })];
    expect((await getListingGallery(shopId, sectionId)).listings.map((listing) => listing.id)).toEqual(['28', '29', '30']);
  });

  it('canonicalizes numeric context and preserves shop identifiers beyond Number precision', async () => {
    const bigintId = '9007199254740993'; mocks.shop.mockResolvedValue({ id: 1, etsyShopId: BigInt(bigintId) }); rows = [row(10, 3, { shopId: bigintId })];
    expect((await getListingGallery(`000${bigintId}`, '02')).listings[0].id).toBe('10');
    expect(mocks.shop).toHaveBeenCalledWith({ where: { etsyShopId: BigInt(bigintId) }, select: { id: true, etsyShopId: true } });
    expect(mocks.listings.mock.calls[0][0].where.shopId).toBe(bigintId);
  });

  it('rejects a section belonging to another shop before reading listings or subsections', async () => {
    mocks.shop.mockResolvedValue({ id: 99, etsyShopId: 999n });
    await expect(getListingGallery('999', sectionId)).rejects.toMatchObject({ status: 404 });
    expect(mocks.section).toHaveBeenCalledWith({ where: { id: 2, OR: [{ shopId: 99 }, { etsyShopId: 999n }] },
      select: { id: true, title: true, etsyShopSectionId: true } });
    expect(mocks.listings).not.toHaveBeenCalled(); expect(mocks.subSections).not.toHaveBeenCalled();
  });

  it('rejects a missing shop or section rather than returning unrelated metadata', async () => {
    mocks.shop.mockResolvedValueOnce(null); await expect(getListingGallery(shopId, sectionId)).rejects.toMatchObject({ status: 404 });
    expect(mocks.section).not.toHaveBeenCalled();
    await expect(getListingGallery(shopId, '8')).rejects.toMatchObject({ status: 404 });
    expect(mocks.listings).not.toHaveBeenCalled();
  });

  it.each([
    ['', '2'], [' ', '2'], ['-1', '2'], ['0', '2'], ['1.2', '2'], ['1e3', '2'], ['9223372036854775808', '2'],
    [shopId, ''], [shopId, '-2'], [shopId, '0'], [shopId, '2.5'], [shopId, '9007199254740993'], [shopId, '2147483648'],
  ])('rejects invalid identifiers before database access: shop=%s section=%s', async (shop, section) => {
    await expect(getListingGallery(shop, section)).rejects.toMatchObject({ status: 400 });
    expect(mocks.shop).not.toHaveBeenCalled(); expect(mocks.section).not.toHaveBeenCalled(); expect(mocks.listings).not.toHaveBeenCalled();
  });

  it('returns an empty gallery for a valid empty section and propagates database failures', async () => {
    rows = []; expect(await getListingGallery(shopId, sectionId)).toEqual({ sectionName: 'Japanese Landscapes', listings: [] });
    mocks.listings.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(getListingGallery(shopId, sectionId)).rejects.toThrow('Database unavailable');
  });
});
