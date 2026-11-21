import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/our-template-image-tags', () => ({ getTemplateImageTags: mocks.get, createTemplateImageTag: mocks.create }));
import { GET, POST } from './route';

beforeEach(() => vi.resetAllMocks());
describe('template image tag catalogue API', () => {
  it('returns the catalogue for editor selection and gallery filtering', async () => {
    const tags = [{ id: 'tag-id', name: 'Nursery' }]; mocks.get.mockResolvedValue(tags);
    expect(await (await GET()).json()).toEqual({ tags });
  });
  it('returns a newly created or existing normalized tag to the client', async () => {
    const tag = { id: 'tag-id', name: 'Nursery' }; mocks.create.mockResolvedValue(tag);
    const response = await POST(new Request('http://localhost/api/our-template-image-tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ' NURSERY ' }),
    }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ tag });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(' NURSERY ');
  });
  it('returns a clear validation error for an invalid new name', async () => {
    mocks.create.mockRejectedValue(new Error('Enter a tag name of 1 to 100 characters.'));
    const response = await POST(new Request('http://localhost/api/our-template-image-tags', { method: 'POST', body: JSON.stringify({ name: '' }) }));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Enter a tag name of 1 to 100 characters.' });
  });
  it('reports catalogue loading failures', async () => {
    mocks.get.mockRejectedValue(new Error('Tags are unavailable.'));
    const response = await GET(); expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Tags are unavailable.' });
  });
});
