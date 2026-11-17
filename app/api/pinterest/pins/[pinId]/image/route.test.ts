import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pin: vi.fn(), media: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { pinterestPin: { findUnique: mocks.pin } } }));
vi.mock('@/lib/pinterest/pins', () => ({ imageMediaSource: mocks.media }));
import { GET } from './route';

function request(pinId: string) {
  return GET(new Request(`http://localhost/api/pinterest/pins/${pinId}/image`), { params: Promise.resolve({ pinId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pin.mockResolvedValue({ listingId: 42, imageId: 8 });
  mocks.media.mockResolvedValue({ source_type: 'image_base64', content_type: 'image/png', data: Buffer.from('actual creative bytes').toString('base64') });
});

describe('Pin image preview', () => {
  it('returns the exact creative PNG without altering it or writing metadata', async () => {
    const response = await request('7');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('actual creative bytes'));
    expect(mocks.media).toHaveBeenCalledWith(42, 8, 7);
    expect(mocks.pin).toHaveBeenCalledWith({ where: { id: 7 }, select: { listingId: true, imageId: true } });
  });

  it('redirects to the original image when a Pin has no dedicated creative', async () => {
    mocks.media.mockResolvedValue({ source_type: 'image_url', url: 'https://example.com/original.png' });
    const response = await request('7');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://example.com/original.png');
  });

  it.each(['0', '-7', '7.5', '07', '7abc', '9007199254740992'])('rejects invalid Pin ID %s before database access', async (pinId) => {
    expect((await request(pinId)).status).toBe(400);
    expect(mocks.pin).not.toHaveBeenCalled();
    expect(mocks.media).not.toHaveBeenCalled();
  });

  it('returns not found for an unknown Pin', async () => {
    mocks.pin.mockResolvedValue(null);
    expect((await request('7')).status).toBe(404);
    expect(mocks.media).not.toHaveBeenCalled();
  });

  it('does not reveal private storage paths or serve a substitute when the creative cannot be read', async () => {
    mocks.media.mockRejectedValue(new Error('S3 missing .pinterest-creatives/private/path.png'));
    const response = await request('7');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'The Pin image is unavailable.' });
  });
});
