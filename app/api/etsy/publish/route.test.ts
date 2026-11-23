import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ data: vi.fn(), publish: vi.fn(), inactive: vi.fn() }));
vi.mock('@/lib/sync-to-etsy', () => ({
  getSyncToEtsyData: mocks.data, publishOneListing: mocks.publish, makeOneListingInactive: mocks.inactive,
}));
import { POST } from './route';

beforeEach(() => { vi.resetAllMocks(); mocks.data.mockResolvedValue({ localSections: [], sections: [] }); });
const request = (body: unknown) => new Request('http://localhost/api/etsy/publish', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('selected Etsy product publication API', () => {
  it.each([undefined, [], ['invalid']])('rejects a missing or invalid product selection: %j', async (variants) => {
    const result = await POST(request({ listingId: '80', variants }));
    expect(result.status).toBe(400);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.inactive).not.toHaveBeenCalled();
  });

  it('reactivates only the selected digital product', async () => {
    expect((await POST(request({ listingId: '80', variants: ['download'] }))).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith('80', ['download']);
    expect(mocks.inactive).not.toHaveBeenCalled();
  });

  it('deactivates only the selected print product', async () => {
    expect((await POST(request({ listingId: '80', action: 'inactive', variants: ['print'] }))).status).toBe(200);
    expect(mocks.inactive).toHaveBeenCalledWith('80', ['print']);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('requires a fresh synced-draft eligibility check for section publication', async () => {
    expect((await POST(request({ listingId: '80', variants: ['print', 'download'], requireSyncedDrafts: true }))).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith('80', ['print', 'download'], { requireSyncedDrafts: true });
  });

  it('preserves the individual publication call when the optional guard is false', async () => {
    expect((await POST(request({ listingId: '80', variants: ['download'], requireSyncedDrafts: false }))).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith('80', ['download']);
  });

  it.each(['true', 1, null, {}])('rejects a nonboolean strict publication flag: %j', async (requireSyncedDrafts) => {
    expect((await POST(request({ listingId: '80', variants: ['download'], requireSyncedDrafts }))).status).toBe(400);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.inactive).not.toHaveBeenCalled();
    expect(mocks.data).not.toHaveBeenCalled();
  });

  it('returns a stale-draft guard failure without reloading or publishing another product', async () => {
    const message = 'The selected Etsy drafts are no longer ready to publish. Refresh the page.';
    mocks.publish.mockRejectedValueOnce(new Error(message));
    const result = await POST(request({ listingId: '80', variants: ['download'], requireSyncedDrafts: true }));
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ error: message });
    expect(mocks.data).not.toHaveBeenCalled();
    expect(mocks.inactive).not.toHaveBeenCalled();
  });
});
