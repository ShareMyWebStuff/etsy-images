import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ context: vi.fn(), listing: vi.fn(), read: vi.fn(), preview: vi.fn(), mkdir: vi.fn(), write: vi.fn(), defaults: vi.fn() }));
vi.mock('@/lib/local-listings', () => ({ getListingContext: mocks.context }));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyListing: { findFirst: mocks.listing } } }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, readImagePreview: mocks.preview, mkdir: mocks.mkdir, writeFile: mocks.write }));
vi.mock('@/lib/listing-products', () => ({ ensureListingProductDefaults: mocks.defaults }));
import { GET } from './route';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '3', listingId: '79' };
const url = 'http://localhost/api/shops/listings/thumbnail';
function request(extra: Record<string, string | undefined> = {}) {
  const query = Object.fromEntries(Object.entries({ ...context, ...extra }).map(([key, value]) => [key, value ?? '']));
  return new Request(`${url}?${new URLSearchParams(query)}`);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ shop: { id: 1, etsyShopId: 66615491n, displayName: 'Shop' },
    section: { id: 2, title: 'Prints', etsyShopSectionId: '1234' }, subSection: { id: 3, name: 'Animals' } });
  mocks.listing.mockResolvedValue({ id: 79, localDirectoryName: 'Fox', thumbnailFileName: 'original.png' });
  mocks.read.mockResolvedValue(Buffer.from('full-resolution-original'));
  mocks.preview.mockResolvedValue(Buffer.from('small-cached-webp'));
});

describe('read-only listing thumbnail endpoint', () => {
  it('serves the cached gallery WebP for preview=1 without directly reading the full source', async () => {
    const response = await GET(request({ preview: '1', v: '2026-11-22T10:00:00.000Z' }));
    expect(response.status).toBe(200); expect(await response.text()).toBe('small-cached-webp');
    expect(response.headers.get('content-type')).toBe('image/webp'); expect(response.headers.get('cache-control')).toBe('private, max-age=60');
    expect(mocks.preview).toHaveBeenCalledWith(path.join('D:/Etsy/EtsyListings', 'Shop', 'Prints', 'Fox', 'thumbnail', 'original.png'));
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.mkdir).not.toHaveBeenCalled(); expect(mocks.defaults).not.toHaveBeenCalled();
  });

  it('reads the original artwork for an assigned listing without writing storage or initializing products', async () => {
    const response = await GET(request({ v: '2026-11-21T16:00:00.000Z' }));
    expect(response.status).toBe(200); expect(await response.text()).toBe('full-resolution-original');
    expect(response.headers.get('content-type')).toBe('image/png'); expect(response.headers.get('cache-control')).toBe('private, max-age=60');
    expect(mocks.context).toHaveBeenCalledWith('66615491', '2', '3');
    expect(mocks.read).toHaveBeenCalledWith(path.join('D:/Etsy/EtsyListings', 'Shop', 'Prints', 'Fox', 'thumbnail', 'original.png'));
    expect(mocks.mkdir).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.defaults).not.toHaveBeenCalled();
  });

  it('matches remote-only rows only in the validated shop and matching Etsy section', async () => {
    mocks.listing.mockImplementation(async ({ where }) => where.id === 79 && where.shopId === '66615491'
      && where.OR.some((scope: any) => scope.subSectionId === null && scope.shopSectionId === 1234)
      ? { id: 79, localDirectoryName: null, thumbnailFileName: 'remote.jpg' } : null);
    const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(mocks.listing).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 79, shopId: '66615491',
      OR: [{ subSectionId: 3 }, { subSectionId: null, shopSectionId: 1234 }] } }));
    expect(mocks.read).toHaveBeenCalledWith(path.join('D:/Etsy/EtsyListings', 'Shop', 'Prints', 'Listing-79', 'thumbnail', 'remote.jpg'));
  });

  it('does not include remote-only fallthrough for a section without an Etsy section ID', async () => {
    const resolved = await mocks.context(); resolved.section.etsyShopSectionId = null;
    await GET(request()); expect(mocks.listing.mock.calls[0][0].where.OR).toEqual([{ subSectionId: 3 }]);
  });

  it.each(['Shop not found.', 'Section not found.', 'Sub section not found.'])('rejects invalid parent scope: %s', async (error) => {
    mocks.context.mockRejectedValue(new Error(error)); expect((await GET(request())).status).toBe(404);
    expect(mocks.listing).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });

  it('returns 404 for a listing outside the validated shop/subsection/Etsy section', async () => {
    mocks.listing.mockResolvedValue(null); expect((await GET(request())).status).toBe(404); expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([null, '', '   ', '../another.png', 'subfolder/art.png', 'C:\\private.png', 'art.pdf'])('rejects missing or unsafe thumbnail filename %s before storage reads', async (thumbnailFileName) => {
    mocks.listing.mockResolvedValue({ id: 79, localDirectoryName: 'Fox', thumbnailFileName });
    expect((await GET(request())).status).toBe(404); expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([{ shopId: '-1' }, { sectionId: '1.5' }, { subSectionId: '' }, { listingId: '9007199254740993' }])('rejects invalid numeric context %j', async (values) => {
    expect((await GET(request(values))).status).toBe(400); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
});
