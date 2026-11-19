import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), adjust: vi.fn() }));
vi.mock('@/lib/listing-thumbnail-gap', async (original) => {
  const actual = await original<typeof import('@/lib/listing-thumbnail-gap')>();
  return { ...actual, getListingThumbnailGap: mocks.get, adjustListingThumbnailGap: mocks.adjust };
});
import { ListingThumbnailGapError } from '@/lib/listing-thumbnail-gap';
import { GET, POST } from './route';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '3', listingId: '79' };
const baseUrl = 'http://localhost/api/shops/listings/editor/thumbnail-gap';
const version = 'a'.repeat(64);
function request(body: unknown) { return new Request(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ analysis: { eligible: true, reason: null }, thumbnailVersion: version, thumbnailIdentity: { fileName: 'thumbnail.png', updatedAt: null } });
  mocks.adjust.mockResolvedValue({ changed: false, analysis: { eligible: true, reason: null }, thumbnailVersion: version });
});

describe('listing thumbnail gap API', () => {
  it('loads analysis and the displayed-thumbnail identity for the exact listing context', async () => {
    const response = await GET(new Request(`${baseUrl}?${new URLSearchParams(context)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ analysis: { eligible: true, reason: null }, thumbnailVersion: version, thumbnailIdentity: { fileName: 'thumbnail.png', updatedAt: null } });
    expect(mocks.get).toHaveBeenCalledWith(context);
    expect(mocks.adjust).not.toHaveBeenCalled();
  });

  it('returns explicit nulls for a listing without a thumbnail', async () => {
    mocks.get.mockResolvedValue({ analysis: null, thumbnailVersion: null, thumbnailIdentity: null });
    const response = await GET(new Request(`${baseUrl}?${new URLSearchParams(context)}`));
    expect(await response.json()).toEqual({ analysis: null, thumbnailVersion: null, thumbnailIdentity: null });
  });

  it.each([{}, { ...context, shopId: 'no-shop' }, { ...context, listingId: '1.5' }, { ...context, subSectionId: '-1' }, { ...context, sectionId: 2 }, { ...context, listingId: '9007199254740993' }])('rejects invalid POST context before service calls: %j', async (body) => {
    const response = await POST(request({ ...body, gapPercent: 5, expectedThumbnailVersion: version }));
    expect(response.status).toBe(400);
    expect(mocks.adjust).not.toHaveBeenCalled();
  });

  it('rejects invalid GET context before source reads', async () => {
    const response = await GET(new Request(`${baseUrl}?shopId=66615491`));
    expect(response.status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('passes the strict numeric percentage and expected version to persistence unchanged', async () => {
    const response = await POST(request({ ...context, gapPercent: 5.5, expectedThumbnailVersion: version }));
    expect(response.status).toBe(200);
    expect(mocks.adjust).toHaveBeenCalledWith(context, 5.5, version);
    expect(await response.json()).toMatchObject({ changed: false, thumbnailVersion: version });
  });

  it('returns a committed changed result with the prepared editor DTO', async () => {
    mocks.adjust.mockResolvedValue({ changed: true, analysis: { eligible: true }, thumbnailVersion: 'b'.repeat(64), data: { thumbnail: { fileName: 'new.png' } } });
    const response = await POST(request({ ...context, gapPercent: 5, expectedThumbnailVersion: version }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: true, data: { thumbnail: { fileName: 'new.png' } } });
  });

  it('returns a displayable 409 for a stale thumbnail without claiming success', async () => {
    mocks.adjust.mockRejectedValue(new ListingThumbnailGapError('The thumbnail changed. Review and retry.', 409));
    const response = await POST(request({ ...context, gapPercent: 5, expectedThumbnailVersion: version }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'The thumbnail changed. Review and retry.' });
  });

  it('returns 400 for an image that cannot be decoded during GET analysis', async () => {
    mocks.get.mockRejectedValue(new Error('The thumbnail image could not be read.'));
    const response = await GET(new Request(`${baseUrl}?${new URLSearchParams(context)}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'The thumbnail image could not be read.' });
  });

  it.each([null, [], 'not an object'])('rejects malformed POST input %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.adjust).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    const response = await POST(new Request(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }));
    expect(response.status).toBe(400);
    expect(mocks.adjust).not.toHaveBeenCalled();
  });

  it('reports an unconfirmed database commit as unavailable rather than a completed adjustment', async () => {
    mocks.adjust.mockRejectedValue(new ListingThumbnailGapError('Reload before retrying.', 503));
    const response = await POST(request({ ...context, gapPercent: 5, expectedThumbnailVersion: version }));
    expect(response.status).toBe(503);
  });
});
