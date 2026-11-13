import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getImage } = vi.hoisted(() => ({ getImage: vi.fn() }));
vi.mock('@/lib/our-categories', () => ({ getOurCategoryTemplateImage: getImage }));

import { GET } from './route';

describe('template image response', () => {
  beforeEach(() => vi.resetAllMocks());

  it('serves templates with Unicode original filenames instead of returning a misleading 404', async () => {
    getImage.mockResolvedValue({
      contents: Buffer.from('original image bytes'),
      contentType: 'image/png',
      fileName: 'How to Print Children’s Wall Art.png',
    });

    const response = await GET(new Request('http://localhost/api/our-categories/templates/108/image'), {
      params: Promise.resolve({ templateId: '108' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Disposition')).toContain('Children_s');
    expect(response.headers.get('Content-Disposition')).toContain('Children%E2%80%99s');
    expect(await response.text()).toBe('original image bytes');
    expect(getImage).toHaveBeenCalledWith('108', false);
  });

  it('keeps image preview requests and filenames working', async () => {
    getImage.mockResolvedValue({ contents: Buffer.from('preview'), contentType: 'image/webp', fileName: 'print.png' });
    const response = await GET(new Request('http://localhost/api/our-categories/templates/108/image?preview=1'), {
      params: Promise.resolve({ templateId: '108' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(getImage).toHaveBeenCalledWith('108', true);
  });

  it('reports storage failures when an image really cannot be loaded', async () => {
    getImage.mockRejectedValue(new Error('S3 object not found: template.png'));
    const response = await GET(new Request('http://localhost/api/our-categories/templates/108/image'), {
      params: Promise.resolve({ templateId: '108' }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'S3 object not found: template.png' });
  });
});
