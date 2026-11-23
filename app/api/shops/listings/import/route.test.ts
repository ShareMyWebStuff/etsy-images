import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ templates: vi.fn(), bulkImport: vi.fn(), start: vi.fn(), get: vi.fn(), image: vi.fn(), action: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/listing-zip-import', async (original) => ({ ...await original<typeof import('@/lib/listing-zip-import')>(), getListingZipImportTemplates: mocks.templates, importListingZip: mocks.bulkImport }));
vi.mock('@/lib/listing-zip-review', () => ({ startListingZipReview: mocks.start, getListingZipReview: mocks.get,
  getListingZipReviewImage: mocks.image, actOnListingZipReview: mocks.action, closeListingZipReview: mocks.close }));
import { ListingZipImportError } from '@/lib/listing-zip-import';
import { DELETE, GET, POST } from './route';
import { defaultNativeListingPrintCropDraft, listingPrintCropDraftForSave } from '@/lib/listing-print-crops';
const url = 'http://localhost/api/shops/listings/import';
const context = { shopId: '66615491', sectionId: '2', subSectionId: '3' };
const sessionId = '21ea628a-8038-4b91-870b-7f0910c03137';
const cropSettings = listingPrintCropDraftForSave(defaultNativeListingPrintCropDraft(800, 1000));
const review = { sessionId, templateName: 'Frames', cursor: 0, total: 2, insertedCount: 0, skippedCount: 0,
  expiresAt: '2026-11-21T10:30:00Z', current: { index: 0, rowNumber: 2, title: 'Bunny', description: 'Rabbit',
    relativeFilename: 'bunny.png', originalFileName: 'bunny.png', width: 800, height: 1000, orientation: 'portrait', error: null } };
function multipart(values: Record<string, string> = context, hasFile = true) {
  // jsdom and Undici use different Blob implementations; supply the parsed form directly.
  const form = new FormData(); for (const [key, value] of Object.entries(values)) form.set(key, value); form.set('templateId', '10');
  if (hasFile) form.set('file', new File(['zip'], 'archive.zip', { type: 'application/zip' }));
  const value = new Request(url, { method: 'POST' }); Object.defineProperty(value, 'formData', { value: async () => form }); return value;
}
function action(values: Record<string, unknown> = {}, method = 'POST') {
  return new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...context, sessionId, rowIndex: 0, action: 'insert', ...values }) });
}
function query(values: Record<string, string> = {}) { return new Request(`${url}?${new URLSearchParams({ ...context, sessionId, ...values })}`); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.templates.mockResolvedValue({ templates: [{ id: '10', name: 'Living Room', templateType: 'single', itemCount: 1 }] });
  mocks.start.mockResolvedValue({ review }); mocks.get.mockResolvedValue({ review }); mocks.image.mockResolvedValue(Buffer.from('webp bytes'));
  mocks.action.mockResolvedValue({ review: { ...review, cursor: 1, insertedCount: 1 }, data: { listings: [] } }); mocks.close.mockResolvedValue(undefined);
});

describe('ZIP listings review API', () => {
  it('keeps the existing context-scoped template catalogue GET', async () => {
    const response = await GET(new Request(`${url}?${new URLSearchParams(context)}`));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(mocks.templates).toHaveBeenCalledWith(context);
  });
  it('prepares a multipart ZIP exactly once and never invokes the old bulk creation path', async () => {
    const response = await POST(multipart()); expect(response.status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith(context, '10', expect.any(File)); expect(mocks.bulkImport).not.toHaveBeenCalled(); expect(mocks.action).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ review }); expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('returns current private review state', async () => {
    const response = await GET(query({ action: 'review' })); expect(response.status).toBe(200); expect(await response.json()).toEqual({ review });
    expect(mocks.get).toHaveBeenCalledWith(context, sessionId); expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('awaits the authoritative session read before sending a review response', async () => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockReturnValue(new Promise((complete) => { resolve = complete; }));
    let settled = false;
    const response = GET(query({ action: 'review' })).then((value) => { settled = true; return value; });
    await Promise.resolve(); expect(settled).toBe(false);
    resolve({ review: { ...review, cursor: 1, insertedCount: 1 } });
    expect(await (await response).json()).toMatchObject({ review: { cursor: 1, insertedCount: 1 } });
  });
  it('serves only an on-demand WebP preview with private no-store headers', async () => {
    const response = await GET(query({ action: 'image', rowIndex: '0' })); expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp'); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('webp bytes'); expect(mocks.image).toHaveBeenCalledWith(context, sessionId, 0); expect(mocks.action).not.toHaveBeenCalled();
  });
  it.each(['insert', 'skip'])('passes an explicit sequential %s action without uploading the ZIP again', async (rowAction) => {
    const response = await POST(action({ action: rowAction })); expect(response.status).toBe(200);
    if (rowAction === 'insert') expect(mocks.action).toHaveBeenCalledWith(context, sessionId, 0, rowAction, undefined);
    else expect(mocks.action).toHaveBeenCalledWith(context, sessionId, 0, rowAction);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.bulkImport).not.toHaveBeenCalled();
  });
  it('forwards the selected Set Size draft unchanged for transactional Insert validation', async () => {
    expect((await POST(action({ cropSettings }))).status).toBe(200);
    expect(mocks.action).toHaveBeenCalledWith(context, sessionId, 0, 'insert', JSON.parse(JSON.stringify(cropSettings)));
  });
  it('delegates invalid or missing retry crops to the session so committed Inserts remain recoverable', async () => {
    mocks.action.mockRejectedValueOnce(new ListingZipImportError('CSV row 2: The Set Size crops are invalid.', 400));
    const response = await POST(action({ cropSettings: null }));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: expect.stringContaining('Set Size') });
    expect(mocks.action).toHaveBeenCalledWith(context, sessionId, 0, 'insert', null);
  });
  it('returns a completed review despite an optional table refresh failure', async () => {
    mocks.action.mockResolvedValue({ review: { ...review, cursor: 1, insertedCount: 1 }, data: null, refreshError: 'Refresh the page to see the inserted listing.' });
    const response = await POST(action()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ review: { cursor: 1, insertedCount: 1 }, data: null, refreshError: expect.any(String) });
  });
  it('closes the session through DELETE without creating listings', async () => {
    const response = await DELETE(action({}, 'DELETE')); expect(response.status).toBe(200); expect(await response.json()).toEqual({ closed: true });
    expect(mocks.close).toHaveBeenCalledWith(context, sessionId); expect(mocks.action).not.toHaveBeenCalled(); expect(mocks.bulkImport).not.toHaveBeenCalled();
  });
  it.each([{}, { ...context, shopId: 'no-shop' }, { ...context, sectionId: '-1' }, { ...context, subSectionId: '9007199254740993' }])('rejects malformed context before preparation: %j', async (values) => {
    expect((await POST(multipart(values))).status).toBe(400); expect((await GET(new Request(`${url}?${new URLSearchParams(values)}`))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.templates).not.toHaveBeenCalled(); expect(mocks.bulkImport).not.toHaveBeenCalled();
  });
  it.each([{ rowIndex: -1 }, { rowIndex: 1.2 }, { rowIndex: '0' }, { action: 'insert-all' }, { sessionId: '../../unsafe' }])('rejects malformed JSON actions: %j', async (values) => {
    expect((await POST(action(values))).status).toBe(400); expect(mocks.action).not.toHaveBeenCalled();
  });
  it.each(['', '-1', '1.2', 'NaN'])('rejects invalid preview row %s', async (rowIndex) => {
    expect((await GET(query({ action: 'image', rowIndex }))).status).toBe(400); expect(mocks.image).not.toHaveBeenCalled();
  });
  it('requires a file, valid JSON objects and a supported GET action', async () => {
    expect((await POST(multipart(context, false))).status).toBe(400);
    expect((await POST(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' }))).status).toBe(400);
    expect((await POST(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' }))).status).toBe(400);
    expect((await GET(query({ action: 'insert' }))).status).toBe(400); expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([400, 409, 410, 429, 503])('preserves actionable service status %s', async (status) => {
    mocks.start.mockRejectedValue(new ListingZipImportError('Choose the ZIP again.', status)); const response = await POST(multipart());
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: 'Choose the ZIP again.' });
  });
  it('returns session expiry as 410 for state, image, Insert and close requests', async () => {
    const error = new ListingZipImportError('This ZIP review expired. Choose the ZIP again.', 410);
    mocks.get.mockImplementation(() => { throw error; }); mocks.image.mockRejectedValue(error); mocks.action.mockRejectedValue(error); mocks.close.mockRejectedValue(error);
    for (const request of [GET(query({ action: 'review' })), GET(query({ action: 'image', rowIndex: '0' })), POST(action()), DELETE(action({}, 'DELETE'))]) {
      const response = await request; expect(response.status).toBe(410); expect(await response.json()).toMatchObject({ error: expect.stringMatching(/Choose the ZIP again/) });
    }
  });
});
