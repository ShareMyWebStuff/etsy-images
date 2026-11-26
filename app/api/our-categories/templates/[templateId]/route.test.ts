import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateSlot } = vi.hoisted(() => ({ updateSlot: vi.fn() }));
vi.mock('@/lib/our-categories', () => ({ updateOurCategoryImageTemplateOrientation: updateSlot,
  OurCategoryTemplateConflictError: class OurCategoryTemplateConflictError extends Error {},
}));
import { OurCategoryTemplateConflictError } from '@/lib/our-categories';
import { PATCH } from './route';
const params = { params: Promise.resolve({ templateId: '10' }) };

describe('orientation slot PATCH', () => {
  beforeEach(() => vi.resetAllMocks());
  it('returns the refreshed image role and passes each slot mapping intact', async () => {
    const input = { orientation: 'landscape', ourTemplateImageId: 'scene-id', itemMapping: { 1: 3 } };
    updateSlot.mockResolvedValue({ id: '10', orientationVariants: { landscape: input } });
    const result = await PATCH(new Request('http://localhost/api/our-categories/templates/10', { method: 'PATCH', body: JSON.stringify(input) }), params);
    expect(result.status).toBe(200); expect(updateSlot).toHaveBeenCalledExactlyOnceWith('10', input);
    expect((await result.json()).template.id).toBe('10');
  });
  it('returns a conflict requiring reload when a simultaneous role update wins', async () => {
    updateSlot.mockRejectedValue(new OurCategoryTemplateConflictError('This image role changed. Refresh.'));
    const result = await PATCH(new Request('http://localhost/api/our-categories/templates/10', { method: 'PATCH', body: '{}' }), params);
    expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: 'This image role changed. Refresh.' });
  });
  it('reports incompatible scene validation as a client error', async () => {
    updateSlot.mockRejectedValue(new Error('Choose a portrait scene.'));
    const result = await PATCH(new Request('http://localhost/api/our-categories/templates/10', { method: 'PATCH', body: '{}' }), params);
    expect(result.status).toBe(400);
  });
});
