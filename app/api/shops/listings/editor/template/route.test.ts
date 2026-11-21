import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ options: vi.fn(), assign: vi.fn() }));
vi.mock('@/lib/listing-template-assignment', async (original) => ({ ...await original<typeof import('@/lib/listing-template-assignment')>(),
  getListingTemplateOptions: mocks.options, assignListingTemplate: mocks.assign }));
import { ListingTemplateAssignmentError } from '@/lib/listing-template-assignment';
import { GET, PUT } from './route';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '3', listingId: '79' };
const url = 'http://localhost/api/shops/listings/editor/template';
const request = (body: unknown) => new Request(url, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { vi.resetAllMocks(); mocks.options.mockResolvedValue({ templates: [{ id: '20', name: 'Nursery', templateType: 'single', itemCount: 1 }], currentTemplateId: '10' }); mocks.assign.mockResolvedValue({ listing: { id: '79' } }); });

describe('listing template assignment API', () => {
  it('loads fresh choices for the exact listing context', async () => {
    const response = await GET(new Request(`${url}?${new URLSearchParams(context)}`));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ currentTemplateId: '10', templates: [{ id: '20' }] }); expect(mocks.options).toHaveBeenCalledWith(context);
  });
  it('saves the selected ID and returns the refreshed editor DTO', async () => {
    const response = await PUT(request({ ...context, templateId: '20' }));
    expect(response.status).toBe(200); expect(mocks.assign).toHaveBeenCalledWith(context, '20'); expect(await response.json()).toEqual({ data: { listing: { id: '79' } } });
  });
  it.each([{}, { ...context, shopId: 'bad' }, { ...context, sectionId: '-1' }, { ...context, listingId: '9007199254740993' }])('rejects invalid full context %j before service calls', async (body) => {
    expect((await PUT(request({ ...body, templateId: '20' }))).status).toBe(400); expect(mocks.assign).not.toHaveBeenCalled();
    expect((await GET(new Request(`${url}?${new URLSearchParams(body as Record<string, string>)}`))).status).toBe(400); expect(mocks.options).not.toHaveBeenCalled();
  });
  it.each([null, [], 'invalid'])('rejects malformed body %j', async (body) => { expect((await PUT(request(body))).status).toBe(400); expect(mocks.assign).not.toHaveBeenCalled(); });
  it('rejects malformed JSON', async () => { expect((await PUT(new Request(url, { method: 'PUT', body: '{' }))).status).toBe(400); expect(mocks.assign).not.toHaveBeenCalled(); });
  it.each([404, 409, 503])('preserves expected service error status %s', async (status) => {
    mocks.assign.mockRejectedValue(new ListingTemplateAssignmentError('Reload and retry.', status));
    const response = await PUT(request({ ...context, templateId: '20' })); expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: 'Reload and retry.' });
  });
});
