import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn(),
  createChild: vi.fn(), removeChild: vi.fn(), impact: vi.fn() }));
vi.mock('@/lib/our-template-image-definitions', () => ({ getOurTemplateImageDefinitions: mocks.list, createOurTemplateImageDefinition: mocks.create,
  getOurTemplateImageDefinition: mocks.get, updateOurTemplateImageDefinition: mocks.update, deleteOurTemplateImageDefinition: mocks.remove,
  createOurTemplateImageDefinitionImage: mocks.createChild, deleteOurTemplateImageDefinitionImage: mocks.removeChild,
  getOurTemplateImageDefinitionDeletionImpact: mocks.impact }));
import { GET, POST } from './route';
import { GET as getDefinition, PATCH, DELETE as deleteDefinition } from './[id]/route';
import { POST as createChild } from './[id]/images/route';
import { DELETE as deleteChild } from './[id]/images/[sceneId]/route';
import { GET as getImpact } from './[id]/impact/route';
const id = '10000000-0000-4000-8000-000000000001', sceneId = '10000000-0000-4000-8000-000000000002';
const context = () => ({ params: Promise.resolve({ id }) });
beforeEach(() => vi.resetAllMocks());
describe('template image definition API', () => {
  it('lists and creates named definitions independently of image upload', async () => {
    const definition = { id, name: 'Gallery', mode: 'both', images: [] }; mocks.list.mockResolvedValue([definition]); mocks.create.mockResolvedValue(definition);
    expect(await (await GET()).json()).toEqual({ definitions: [definition] });
    const response = await POST(new Request('http://localhost/api/our-template-image-definitions', { method: 'POST', body: JSON.stringify({ name: 'Gallery', mode: 'both' }) }));
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ definition });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ name: 'Gallery', mode: 'both' }); expect(mocks.createChild).not.toHaveBeenCalled();
  });
  it('returns creation validation errors without a successful definition response', async () => {
    mocks.create.mockRejectedValue(new Error('Choose No areas, Both, or Combined.'));
    const response = await POST(new Request('http://localhost/api/our-template-image-definitions', { method: 'POST', body: JSON.stringify({ name: 'Gallery', mode: 'invalid' }) }));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Choose No areas, Both, or Combined.' });
  });
  it('loads and renames a definition with the scoped parent ID', async () => {
    mocks.get.mockResolvedValue({ id, images: [] }); mocks.update.mockResolvedValue({ id, name: 'Renamed' });
    expect((await (await getDefinition(new Request('http://localhost'), context())).json()).definition.id).toBe(id);
    const response = await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) }), context());
    expect(response.status).toBe(200); expect(mocks.update).toHaveBeenCalledExactlyOnceWith(id, { name: 'Renamed' });
  });
  it('passes multipart child uploads into their parent context without replacing other children', async () => {
    const form = new FormData(); form.set('variantSlot', 'landscape'); form.set('definition', '{"openings":[]}');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Room.png', { type: 'image/png' }));
    mocks.createChild.mockResolvedValue({ image: { id: sceneId }, definition: { id } });
    const request = new Request('http://localhost', { method: 'POST' });
    vi.spyOn(request, 'formData').mockResolvedValue(form);
    const response = await createChild(request, context());
    expect(response.status).toBe(201); expect(mocks.createChild.mock.calls[0][0]).toBe(id);
    const posted = mocks.createChild.mock.calls[0][1] as FormData; expect(posted.get('variantSlot')).toBe('landscape');
    expect(await (posted.get('file') as File).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });
  it('detaches a child using both parent and image IDs, without invoking whole-parent deletion', async () => {
    mocks.removeChild.mockResolvedValue({ deletedId: sceneId, definitionId: id });
    const definition = { id, name: 'Still saved parent', mode: 'both', images: [] }; mocks.get.mockResolvedValue(definition);
    const response = await deleteChild(new Request('http://localhost', { method: 'DELETE' }), { params: Promise.resolve({ id, sceneId }) });
    expect(response.status).toBe(200); expect(mocks.removeChild).toHaveBeenCalledExactlyOnceWith(id, sceneId); expect(mocks.remove).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ deletedId: sceneId, definitionId: id, definition });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(id);
  });
  it('reports successful deletion truthfully when only the refreshed definition cannot be loaded', async () => {
    mocks.removeChild.mockResolvedValue({ deletedId: sceneId, definitionId: id }); mocks.get.mockRejectedValue(new Error('Database read unavailable'));
    const response = await deleteChild(new Request('http://localhost', { method: 'DELETE' }), { params: Promise.resolve({ id, sceneId }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ deletedId: sceneId, definitionId: id,
      refreshError: expect.stringMatching(/image was deleted.*Reload this page.*Database read unavailable/) });
    expect(mocks.removeChild).toHaveBeenCalledTimes(1); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('provides aggregate impact counts and invokes parent deletion only for the requested definition', async () => {
    const impact = { affectedTemplateCount: 2, affectedImageTemplateCount: 3, affectedListingCount: 4 }; mocks.impact.mockResolvedValue(impact);
    expect(await (await getImpact(new Request('http://localhost'), context())).json()).toEqual({ impact });
    mocks.remove.mockResolvedValue({ deletedId: id }); await deleteDefinition(new Request('http://localhost', { method: 'DELETE' }), context());
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(id);
  });
  it('reports missing definitions and failed child detachment as errors', async () => {
    mocks.get.mockRejectedValue(new Error('Template image definition not found.'));
    expect((await getDefinition(new Request('http://localhost'), context())).status).toBe(404);
    mocks.removeChild.mockRejectedValue(new Error('This image does not belong to the selected definition.'));
    expect((await deleteChild(new Request('http://localhost'), { params: Promise.resolve({ id, sceneId }) })).status).toBe(400);
  });
});
