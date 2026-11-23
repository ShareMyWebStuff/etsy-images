import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ remove: vi.fn(), reload: vi.fn() }));
vi.mock('@/lib/local-listings', () => ({ createLocalListing: vi.fn(), updateLocalListing: vi.fn(), deleteListing: mocks.remove }));
vi.mock('@/lib/listing-table', () => ({ getSubSectionListingsPageData: mocks.reload }));
import { DELETE } from './route';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '7', listingId: '79' };
const data = { shop: { id: '66615491', shopName: 'Shop' }, section: { id: '2', sectionName: 'Art' },
  subSection: { id: '7', name: 'Seasons' }, listings: [{ id: '80' }] };
function request(body: Record<string, unknown> = context) {
  return new Request('http://localhost/api/shops/listings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => { vi.resetAllMocks(); mocks.remove.mockResolvedValue(undefined); mocks.reload.mockResolvedValue(data); });

describe('listing DELETE result and optional table refresh', () => {
  it('acknowledges the deleted listing and refreshes the actual target subsection', async () => {
    const response = await DELETE(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ deletedId: '79', data });
    expect(mocks.remove).toHaveBeenCalledWith('66615491', '2', '7', '79');
    expect(mocks.reload).toHaveBeenCalledWith('66615491', '2', '7');
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.reload.mock.invocationCallOrder[0]);
  });

  it('reports a committed deletion as success when reloading the table throws', async () => {
    mocks.reload.mockRejectedValue(new Error('Database refresh unavailable'));
    const response = await DELETE(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ deletedId: '79', data: null,
      refreshError: 'The listing was deleted, but the listings table could not be refreshed. Reload this section.' });
    expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it('reports the same truthful success when the deleted listing context no longer has table data', async () => {
    mocks.reload.mockResolvedValue(null);
    const response = await DELETE(request());
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ deletedId: '79', data: null, refreshError: expect.stringMatching(/listing was deleted/) });
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it.each(['shopId', 'sectionId', 'subSectionId', 'listingId'])('keeps existing required-context validation for %s', async (missing) => {
    const body: Record<string, unknown> = { ...context }; delete body[missing];
    const response = await DELETE(request(body));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: `Missing ${missing}.` });
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.reload).not.toHaveBeenCalled();
  });

  it('preserves actual deletion failures without attempting a table reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.remove.mockRejectedValue(new Error('Cannot delete this listing because it exists on Etsy.'));
    const response = await DELETE(request());
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: 'Cannot delete this listing because it exists on Etsy.' });
    expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.reload).not.toHaveBeenCalled();
  });
});
