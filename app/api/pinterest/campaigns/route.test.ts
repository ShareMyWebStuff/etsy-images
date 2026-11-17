import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pins: vi.fn(), schedule: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { pinterestPin: { findMany: mocks.pins } } }));
vi.mock('@/lib/pinterest/scheduling', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/pinterest/scheduling')>(), schedulePinterestPins: mocks.schedule,
}));
import { PinterestSchedulingError } from '@/lib/pinterest/scheduling';
import { POST } from './route';

const selected = { action: 'schedule-selected', name: 'Woodland launch', boardId: 10, pinIds: [7, 8], startDate: '2026-11-17', pinsPerDay: 2, timeZone: 'Europe/London' };
function request(body: object) {
  return new Request('http://localhost/api/pinterest/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pins.mockResolvedValue([{ id: 7 }, { id: 8 }]);
  mocks.schedule.mockResolvedValue({ id: 20, name: 'Woodland launch', status: 'ACTIVE', scheduledCount: 2 });
});

describe('scheduling selected Pinterest Pins', () => {
  it('passes only the explicit selected IDs to the reusable service', async () => {
    const response = await POST(request(selected));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { id: 20, status: 'ACTIVE', scheduledCount: 2 } });
    const { action: _action, ...expected } = selected;
    expect(mocks.schedule).toHaveBeenCalledWith(expected);
    expect(mocks.pins).not.toHaveBeenCalled();
  });

  it('preserves legacy drafts-only selection while using fresh timezone-aware scheduling', async () => {
    const response = await POST(request({ name: 'Woodland launch', boardId: 10, startDate: '2026-11-17', pinsPerDay: 2 }));
    expect(response.status).toBe(201);
    expect(mocks.pins).toHaveBeenCalledWith({
      where: { boardId: 10, status: 'DRAFT', scheduledAt: null, campaignId: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true },
    });
    expect(mocks.schedule).toHaveBeenCalledWith({ name: 'Woodland launch', boardId: 10, pinIds: [7, 8], startDate: '2026-11-17', pinsPerDay: 2, timeZone: 'Europe/London' });
  });

  it('reports an empty legacy selection without creating a campaign', async () => {
    mocks.pins.mockResolvedValue([]);
    expect((await POST(request({ name: 'Launch', boardId: 10, startDate: '2026-11-17' }))).status).toBe(400);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('returns a state conflict without falling back to another set of Pins', async () => {
    mocks.schedule.mockRejectedValue(new PinterestSchedulingError('A selected Pin changed while scheduling.', 409));
    const response = await POST(request(selected));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'A selected Pin changed while scheduling.' });
    expect(mocks.pins).not.toHaveBeenCalled();
  });

  it.each([{ action: 'publish-all' }, { name: '' }, { boardId: 0 }, { startDate: '' }])('rejects an incomplete or unsupported request: %j', async change => {
    const response = await POST(request({ ...selected, ...change }));
    expect(response.status).toBe(400);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
