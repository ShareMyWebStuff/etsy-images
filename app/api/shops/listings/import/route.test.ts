import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ templates: vi.fn(), importZip: vi.fn() }));
vi.mock('@/lib/listing-zip-import', async (original) => ({ ...await original<typeof import('@/lib/listing-zip-import')>(), getListingZipImportTemplates: mocks.templates, importListingZip: mocks.importZip }));
import { ListingZipImportError } from '@/lib/listing-zip-import';
import { GET, POST } from './route';
const url = 'http://localhost/api/shops/listings/import';
const context = { shopId: '66615491', sectionId: '2', subSectionId: '3' };
function request(values: Record<string, string> = context, hasFile = true) {
  // jsdom's FormData and Undici's streaming multipart reader use different Blob implementations.
  const form = new FormData(); for (const [key, value] of Object.entries(values)) form.set(key, value); form.set('templateId', '10');
  if (hasFile) form.set('file', new File(['zip'], 'archive.zip', { type: 'application/zip' }));
  const value = new Request(url, { method: 'POST' }); Object.defineProperty(value, 'formData', { value: async () => form }); return value;
}
beforeEach(() => { vi.resetAllMocks(); mocks.templates.mockResolvedValue({ templates: [{ id: '10', name: 'Living Room', templateType: 'single', itemCount: 1 }] }); mocks.importZip.mockResolvedValue({ data: { listings: [] }, importedCount: 2, listingIds: ['100', '101'] }); });
describe('ZIP listings import API', () => {
  it('loads fresh eligible templates for the full context', async () => {
    const response = await GET(new Request(`${url}?${new URLSearchParams(context)}`)); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(mocks.templates).toHaveBeenCalledWith(context);
  });
  it('passes multipart archive/template/context to the service and returns imported IDs and fresh table data', async () => {
    const response = await POST(request()); expect(response.status).toBe(200); expect(mocks.importZip).toHaveBeenCalledWith(context, '10', expect.any(File));
    expect(await response.json()).toEqual({ data: { listings: [] }, importedCount: 2, listingIds: ['100', '101'] });
  });
  it.each([{}, { ...context, shopId: 'no-shop' }, { ...context, sectionId: '-1' }, { ...context, subSectionId: '9007199254740993' }])('rejects malformed context before service calls: %j', async (values) => {
    expect((await POST(request(values))).status).toBe(400); expect((await GET(new Request(`${url}?${new URLSearchParams(values)}`))).status).toBe(400); expect(mocks.importZip).not.toHaveBeenCalled(); expect(mocks.templates).not.toHaveBeenCalled();
  });
  it('requires a file and rejects nonmultipart requests', async () => {
    expect((await POST(request(context, false))).status).toBe(400); expect((await POST(new Request(url, { method: 'POST', body: '{}' }))).status).toBe(400); expect(mocks.importZip).not.toHaveBeenCalled();
  });
  it.each([400, 409, 503])('returns actionable service errors with status %s', async (status) => {
    mocks.importZip.mockRejectedValue(new ListingZipImportError('CSV row 3: duplicate title.', status));
    const response = await POST(request()); expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: 'CSV row 3: duplicate title.' });
  });
});
