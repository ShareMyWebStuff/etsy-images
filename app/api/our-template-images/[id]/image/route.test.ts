import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getImage } = vi.hoisted(() => ({ getImage: vi.fn() }));
vi.mock('@/lib/our-template-images', () => ({ getOurTemplateImageFile: getImage }));

import { GET } from './route';

const id = '10000000-0000-4000-8000-000000000001';
const context = () => ({ params: Promise.resolve({ id }) });
const request = (query = '') => new Request(`http://localhost/api/our-template-images/${id}/image${query}`);

beforeEach(() => vi.resetAllMocks());

describe('saved template image original and browsing preview responses', () => {
  it('serves the full original PNG by default and revalidates unversioned requests', async () => {
    getImage.mockResolvedValue(Buffer.from('original PNG bytes'));
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(await response.text()).toBe('original PNG bytes');
    expect(getImage).toHaveBeenCalledExactlyOnceWith(id, false);
  });

  it('serves the lightweight WebP for preview=1 and caches the versioned URL privately', async () => {
    getImage.mockResolvedValue(Buffer.from('small WebP bytes'));
    const response = await GET(request('?preview=1&v=2026-11-19T12%3A00%3A00.000Z'), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(await response.text()).toBe('small WebP bytes');
    expect(getImage).toHaveBeenCalledExactlyOnceWith(id, true);
  });

  it.each(['?preview=1', '?preview=1&v=', '?preview=1&v=%20'])('revalidates an unversioned browsing preview: %s', async (query) => {
    getImage.mockResolvedValue(Buffer.from('small WebP bytes'));
    const response = await GET(request(query), context());
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('keeps versioned full-resolution image requests as PNG', async () => {
    getImage.mockResolvedValue(Buffer.from('original PNG bytes'));
    const response = await GET(request('?v=2026-11-19T12%3A00%3A00.000Z'), context());
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(getImage).toHaveBeenCalledExactlyOnceWith(id, false);
  });

  it('reports a preview storage failure without disguising the result as a successful image', async () => {
    getImage.mockRejectedValue(new Error('The stored preview could not be read.'));
    const response = await GET(request('?preview=1'), context());
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'The stored preview could not be read.' });
  });
});
