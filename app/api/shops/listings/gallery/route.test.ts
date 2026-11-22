import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ gallery: vi.fn() }));
vi.mock('@/lib/listing-gallery', async (original) => ({ ...await original<typeof import('@/lib/listing-gallery')>(), getListingGallery: mocks.gallery }));
import { ListingGalleryError } from '@/lib/listing-gallery';
import { GET } from './route';

const url = 'http://localhost/api/shops/listings/gallery';
const payload = { sectionName: 'Japanese Landscapes', listings: [
  { id: '10', listingName: 'Fuji', hasThumbnail: true, thumbnailUpdatedAt: '2026-11-22T09:20:30.000Z', subSectionId: '3' },
  { id: '11', listingName: 'Kyoto', hasThumbnail: false, thumbnailUpdatedAt: null, subSectionId: '7' },
  { id: '12', listingName: 'Unassigned artwork', hasThumbnail: true, thumbnailUpdatedAt: null, subSectionId: null },
] };
beforeEach(() => { mocks.gallery.mockReset().mockResolvedValue(payload); });

describe('section gallery API', () => {
  it('returns section-wide metadata directly with no-store caching', async () => {
    const response = await GET(new Request(`${url}?shopId=66615491&sectionId=2&subSectionId=3`));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(payload); expect(mocks.gallery).toHaveBeenCalledWith('66615491', '2');
  });

  it('passes missing context to validation and preserves an actionable 400 response', async () => {
    mocks.gallery.mockRejectedValue(new ListingGalleryError('Missing or invalid shop and section context.', 400));
    const response = await GET(new Request(url)); expect(mocks.gallery).toHaveBeenCalledWith('', '');
    expect(response.status).toBe(400); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Missing or invalid shop and section context.' });
  });

  it('does not turn cross-shop or missing-section failures into a successful empty gallery', async () => {
    mocks.gallery.mockRejectedValue(new ListingGalleryError('Section not found for this shop.', 404));
    const response = await GET(new Request(`${url}?shopId=999&sectionId=2`));
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Section not found for this shop.' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('reports unexpected read failures as uncached server errors', async () => {
    mocks.gallery.mockRejectedValue(new Error('Database unavailable'));
    const response = await GET(new Request(`${url}?shopId=66615491&sectionId=2`));
    expect(response.status).toBe(500); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Database unavailable' });
  });
});
