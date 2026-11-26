import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getImage, getStored } = vi.hoisted(() => ({ getImage: vi.fn(), getStored: vi.fn() }));
vi.mock('@/lib/our-template-images', () => ({ getOurTemplateImageFile: getImage, getStoredOurTemplateImage: getStored }));

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
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(getStored).not.toHaveBeenCalled();
  });

  it('serves the lightweight WebP for preview=1 and caches the versioned URL privately', async () => {
    getImage.mockResolvedValue(Buffer.from('small WebP bytes'));
    const response = await GET(request('?preview=1&v=2026-11-19T12%3A00%3A00.000Z'), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(await response.text()).toBe('small WebP bytes');
    expect(getImage).toHaveBeenCalledExactlyOnceWith(id, true);
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(getStored).not.toHaveBeenCalled();
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

  it.each(['?download=1', '?download=1&preview=1&v=old-version'])('downloads the original PNG once using its uploaded filename: %s', async (query) => {
    getStored.mockResolvedValue({ originalFileName: 'Original room.png' });
    const original = Buffer.from([137, 80, 78, 71, 13, 10]); getImage.mockResolvedValue(original);
    const response = await GET(request(query), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Disposition')).toContain('attachment; filename="Original room.png"');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
    expect(getStored).toHaveBeenCalledExactlyOnceWith(id);
    expect(getImage).toHaveBeenCalledExactlyOnceWith(id, false);
  });

  it('keeps Unicode filenames downloadable while stripping header control characters', async () => {
    getStored.mockResolvedValue({ originalFileName: 'Children\u2019s "Room"\r\n.png' });
    getImage.mockResolvedValue(Buffer.from('original'));
    const response = await GET(request('?download=1'), context());
    expect(response.status).toBe(200);
    const disposition = response.headers.get('Content-Disposition')!;
    expect(disposition).toContain('attachment; filename="Children_s _Room_.png"');
    expect(disposition).toContain("filename*=UTF-8''Children%E2%80%99s%20%22Room%22.png");
    expect(disposition).not.toMatch(/[\r\n]/);
  });

  it.each(['', ' \r\n\u0000 '])('uses an id-based PNG filename when the stored name is empty after sanitizing', async (originalFileName) => {
    getStored.mockResolvedValue({ originalFileName }); getImage.mockResolvedValue(Buffer.from('original'));
    const response = await GET(request('?download=1'), context());
    expect(response.headers.get('Content-Disposition')).toContain(`attachment; filename="${id}.png"`);
  });

  it('does not download unless download=1 was explicitly requested', async () => {
    getImage.mockResolvedValue(Buffer.from('preview'));
    const response = await GET(request('?download=0&preview=1'), context());
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(getImage).toHaveBeenCalledExactlyOnceWith(id, true); expect(getStored).not.toHaveBeenCalled();
  });

  it('returns a missing-scene error without reading or attaching an image', async () => {
    getStored.mockRejectedValue(new Error('Template image not found.'));
    const response = await GET(request('?download=1'), context());
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Template image not found.' });
    expect(response.headers.get('Content-Disposition')).toBeNull(); expect(getImage).not.toHaveBeenCalled();
  });

  it('reports an original storage failure as JSON instead of an attachment', async () => {
    getStored.mockResolvedValue({ originalFileName: 'Room.png' }); getImage.mockRejectedValue(new Error('Original PNG missing.'));
    const response = await GET(request('?download=1'), context());
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Original PNG missing.' });
    expect(response.headers.get('Content-Disposition')).toBeNull();
  });
});
