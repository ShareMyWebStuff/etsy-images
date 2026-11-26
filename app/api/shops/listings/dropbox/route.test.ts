import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findListing: vi.fn(), dropbox: vi.fn(), pdf: vi.fn(), groupedPdf: vi.fn(), zip: vi.fn(), refresh: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyListing: { findFirst: mocks.findListing } } }));
vi.mock('@/lib/dropbox-bundle', () => ({
  createOrUpdateDropbox: mocks.dropbox, createDropboxInstructionPdf: mocks.pdf,
  createGroupedDropboxInstructionPdf: mocks.groupedPdf, createDropboxZips: mocks.zip,
  DropboxBundleStateError: class extends Error { readonly status = 409; },
}));
vi.mock('@/lib/listing-editor', () => ({ getListingEditorData: mocks.refresh }));

import { POST } from './route';

const context = { shopId: '66615491', sectionId: '18', subSectionId: '30', listingId: '664' };
const actions = ['dropbox', 'pdf', 'grouped-pdf'] as const;
const handler = (action: typeof actions[number]) => ({ dropbox: mocks.dropbox, pdf: mocks.pdf, 'grouped-pdf': mocks.groupedPdf })[action];
function request(body: unknown) {
  return new Request('http://localhost/api/shops/listings/dropbox', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function expectNoWork() {
  for (const mock of [mocks.dropbox, mocks.pdf, mocks.groupedPdf, mocks.zip, mocks.refresh]) expect(mock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.findListing.mockResolvedValue({ ourCategory: { printsFrames: true, customisePrints: false, digitalDownload: false },
    productConfig: { digitalDownloadOverride: null } });
  mocks.refresh.mockResolvedValue({ context });
});

describe('listing editor Dropbox endpoint', () => {
  it.each(actions)('blocks physical-only %s before remote/storage work or DTO refresh', async action => {
    const response = await POST(request({ ...context, action }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining('only available for listings sold as digital downloads') });
    expectNoWork();
  });

  it.each(actions)('allows digital %s only after checking persisted settings and preserves legacy result fields', async action => {
    mocks.findListing.mockResolvedValue({ ourCategory: { printsFrames: true, customisePrints: false, digitalDownload: true },
      productConfig: { digitalDownloadOverride: null } });
    const result = { fileName: `${action}.pdf`, count: 3 };
    handler(action).mockResolvedValue(result);
    const response = await POST(request({ ...context, action }));
    expect(response.status).toBe(200);
    expect(handler(action)).toHaveBeenCalledExactlyOnceWith(context);
    expect(mocks.findListing.mock.invocationCallOrder[0]).toBeLessThan(handler(action).mock.invocationCallOrder[0]);
    expect(handler(action).mock.invocationCallOrder[0]).toBeLessThan(mocks.refresh.mock.invocationCallOrder[0]);
    expect(await response.json()).toEqual({ ...result, result, data: { context } });
    for (const other of actions.filter(candidate => candidate !== action)) expect(handler(other)).not.toHaveBeenCalled();
  });

  it('allows local ZIP work for physical-only listings without a remote-delivery policy query', async () => {
    mocks.zip.mockResolvedValue({ files: 2 });
    const response = await POST(request({ ...context, action: 'zip' }));
    expect(response.status).toBe(200);
    expect(mocks.zip).toHaveBeenCalledExactlyOnceWith(context);
    expect(mocks.findListing).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(context);
    for (const action of actions) expect(handler(action)).not.toHaveBeenCalled();
  });

  it('rejects an explicitly disabled listing override before creating Dropbox', async () => {
    mocks.findListing.mockResolvedValue({ ourCategory: { printsFrames: true, customisePrints: false, digitalDownload: true },
      productConfig: { digitalDownloadOverride: false } });
    expect((await POST(request({ ...context, action: 'dropbox' }))).status).toBe(400);
    expectNoWork();
  });

  it('returns 404 for an out-of-scope listing without invoking any delivery work', async () => {
    mocks.findListing.mockResolvedValue(null);
    expect((await POST(request({ ...context, action: 'pdf' }))).status).toBe(404);
    expectNoWork();
  });

  it('rejects missing context and unknown actions before any sales lookup or work', async () => {
    expect((await POST(request({ action: 'dropbox' }))).status).toBe(400);
    expect((await POST(request({ ...context, action: 'unknown' }))).status).toBe(400);
    expect(mocks.findListing).not.toHaveBeenCalled();expectNoWork();
  });

  it('fails closed on a database error before any delivery or refresh', async () => {
    mocks.findListing.mockRejectedValue(new Error('Sales settings unavailable'));
    const response = await POST(request({ ...context, action: 'dropbox' }));
    expect(response.status).toBe(500);expect(await response.json()).toEqual({ error: 'Sales settings unavailable' });
    expectNoWork();
  });
});
