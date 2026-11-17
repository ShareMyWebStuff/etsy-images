import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pins: vi.fn(), count: vi.fn(), groups: vi.fn(), boards: vi.fn(), listings: vi.fn(), keys: vi.fn(), create: vi.fn(), update: vi.fn(), pin: vi.fn(), save: vi.fn(), source: vi.fn(), generate: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  pinterestPin: { findMany: mocks.pins, count: mocks.count, groupBy: mocks.groups, create: mocks.create, update: mocks.update, findUnique: mocks.pin, updateMany: mocks.save },
  pinterestBoard: { findMany: mocks.boards },
  etsyListing: { findMany: mocks.listings },
} }));
vi.mock('@/lib/pinterest/creative-storage', () => ({ loadPinCreativeStorageKeys: mocks.keys }));
vi.mock('@/lib/pinterest/pins', () => ({ deletePin: vi.fn(), publishPin: mocks.publish }));
vi.mock('@/lib/pinterest/bedrock-copy', () => ({ generatePinterestDescription: mocks.generate }));
vi.mock('@/lib/pinterest/description-service', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/pinterest/description-service')>(), loadPinterestDescriptionSource: mocks.source }));
import { GET, PATCH, POST } from './route';

const privatePin = { id: 7, listingId: 42, status: 'DRAFT', creativeStorageKey: '.pinterest-creatives/private/key.png' };
const storedPin = { ...privatePin, boardId: 1, pinterestPinId: null, description: 'Saved product description.', destinationUrl: 'https://www.etsy.com/listing/123/woodland', creativeType: 'product_detail', updatedAt: new Date('2026-11-16T10:00:00Z') };
const context = { subject: 'Fox', boardName: 'Woodland', destinationType: 'physical', listingTitle: 'Woodland print', productDescription: 'A fox illustration', creativeType: 'STANDARD', physicalOptions: { framed: true, unframed: true } };

function mutationRequest(method: string, body: object) {
  return new Request('http://localhost/api/pinterest/pins', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pins.mockResolvedValue([
    privatePin,
    { id: 8, listingId: 43, status: 'DRAFT', creativeStorageKey: null },
  ]);
  mocks.keys.mockResolvedValue(new Map([[7, '.pinterest-creatives/private/key.png']]));
  mocks.count.mockResolvedValue(2);
  mocks.groups.mockResolvedValue([{ boardId: 1, status: 'DRAFT', _count: { _all: 2 } }]);
  mocks.boards.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  mocks.listings.mockResolvedValue([]);
  mocks.source.mockResolvedValue({ context, title: 'Woodland print', destinationUrl: storedPin.destinationUrl });
  mocks.generate.mockResolvedValue('A woodland fox print for a cosy nursery.');
  mocks.pin.mockResolvedValue(storedPin);
  mocks.save.mockResolvedValue({ count: 1 });
  mocks.create.mockResolvedValue(privatePin);
  mocks.update.mockResolvedValue({ ...privatePin, title: 'Updated title' });
  mocks.publish.mockResolvedValue({ ...privatePin, status: 'PUBLISHED', pinterestPinId: 'remote-123' });
});

describe('Pinterest draft review data', () => {
  it('exposes preview links and dedicated creative flags without leaking storage keys', async () => {
    const response = await GET(new Request('http://localhost/api/pinterest/pins?status=DRAFT'));
    expect(await response.json()).toMatchObject({ data: [
      { id: 7, listingId: 42, status: 'DRAFT', previewUrl: '/api/pinterest/pins/7/image', hasDedicatedCreative: true },
      { id: 8, listingId: 43, status: 'DRAFT', previewUrl: '/api/pinterest/pins/8/image', hasDedicatedCreative: false },
    ], pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 } });
    expect(mocks.keys).toHaveBeenCalledWith([7, 8]);
    expect(mocks.pins).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'DRAFT' } }));
  });

  it('paginates beyond the old 300-Pin cap with stable ordering and exact filtered totals', async () => {
    mocks.count.mockResolvedValue(405);
    const response = await GET(new Request('http://localhost/api/pinterest/pins?page=4&pageSize=100&boardId=10&status=PAUSED'));
    const result = await response.json();

    expect(result.pagination).toEqual({ page: 4, pageSize: 100, total: 405, totalPages: 5 });
    expect(mocks.pins).toHaveBeenCalledWith(expect.objectContaining({
      where: { boardId: 10, status: 'PAUSED' }, skip: 300, take: 100,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
    expect(mocks.count).toHaveBeenCalledWith({ where: { boardId: 10, status: 'PAUSED' } });
  });

  it('returns global per-board counts independently of the selected board, status and page', async () => {
    mocks.groups.mockResolvedValue([
      { boardId: 1, status: 'DRAFT', _count: { _all: 45 } },
      { boardId: 1, status: 'PAUSED', _count: { _all: 107 } },
      { boardId: 2, status: 'SCHEDULED', _count: { _all: 600 } },
    ]);
    mocks.boards.mockResolvedValue([{ id: 2 }, { id: 1 }, { id: 3 }]);
    const response = await GET(new Request('http://localhost/api/pinterest/pins?boardId=1&status=DRAFT&pageSize=1'));
    const result = await response.json();

    expect(result.boardCounts).toEqual([
      { boardId: 1, total: 152, draft: 45, paused: 107, scheduled: 0, publishing: 0, published: 0, failed: 0 },
      { boardId: 2, total: 600, draft: 0, paused: 0, scheduled: 600, publishing: 0, published: 0, failed: 0 },
      { boardId: 3, total: 0, draft: 0, paused: 0, scheduled: 0, publishing: 0, published: 0, failed: 0 },
    ]);
    expect(mocks.groups).toHaveBeenCalledWith({ by: ['boardId', 'status'], _count: { _all: true } });
  });

  it('keeps an empty result navigable with one empty page', async () => {
    mocks.pins.mockResolvedValue([]);
    mocks.count.mockResolvedValue(0);
    const response = await GET(new Request('http://localhost/api/pinterest/pins?boardId=2'));
    expect(await response.json()).toMatchObject({ data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } });
  });

  it.each(['page=0', 'page=-1', 'page=1.5', 'page=999999999', 'pageSize=101', 'pageSize=all', 'boardId=0', 'status=UNKNOWN'])('rejects invalid pagination or filtering before reading Pins: %s', async query => {
    const response = await GET(new Request(`http://localhost/api/pinterest/pins?${query}`));
    expect(response.status).toBe(400);
    expect(mocks.pins).not.toHaveBeenCalled();
    expect(mocks.groups).not.toHaveBeenCalled();
  });

  it('preserves the separate listing picker response', async () => {
    const response = await GET(new Request('http://localhost/api/pinterest/pins?mode=listings'));
    expect(await response.json()).toEqual({ data: [] });
    expect(mocks.listings).toHaveBeenCalled();
    expect(mocks.pins).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('strips the private field from a newly created draft returned by a regenerated Prisma client', async () => {
    const response = await POST(mutationRequest('POST', { listingId: 42, imageId: 8, boardId: 1, saveDraft: true }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: 7, listingId: 42, status: 'DRAFT' } });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(privatePin.creativeStorageKey).toBe('.pinterest-creatives/private/key.png');
  });

  it.each(['existing', 'new'])('strips the private field when publishing an %s Pin', async (mode) => {
    const body = mode === 'existing' ? { action: 'publish', id: 7 } : { listingId: 42, imageId: 8, boardId: 1, publishNow: true };
    const response = await POST(mutationRequest('POST', body));
    expect(response.status).toBe(mode === 'existing' ? 200 : 201);
    expect(await response.json()).toEqual({ data: { id: 7, listingId: 42, status: 'PUBLISHED', pinterestPinId: 'remote-123' } });
    expect(mocks.publish).toHaveBeenCalledWith(7);
    expect(mocks.generate).toHaveBeenCalledTimes(mode === 'new' ? 1 : 0);
  });

  it('strips the private field from updated Pin responses', async () => {
    const response = await PATCH(mutationRequest('PATCH', { id: 7, title: 'Updated title' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: 7, listingId: 42, status: 'DRAFT', title: 'Updated title' } });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 }, data: expect.objectContaining({ title: 'Updated title' }) }));
  });
});

describe('Bedrock descriptions when adding a Pin', () => {
  const draft = { listingId: 42, imageId: 8, boardId: 1, saveDraft: true };

  it('generates once and stores the validated description before creating a draft', async () => {
    const response = await POST(mutationRequest('POST', draft));
    expect(response.status).toBe(201);
    expect(mocks.source).toHaveBeenCalledWith(42, 1, undefined, undefined, true);
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(context);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ description: 'A woodland fox print for a cosy nursery.', destinationUrl: storedPin.destinationUrl, status: 'DRAFT', scheduledAt: null }) });
    expect(mocks.generate.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
  });

  it('keeps supplied copy and never invokes Bedrock', async () => {
    const description = '🌿'.repeat(499) + '.';
    expect((await POST(mutationRequest('POST', { ...draft, description }))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ description }) });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('preserves URL-less draft creation, including manually supplied copy', async () => {
    mocks.source.mockResolvedValue({ context, title: 'Unsynced fox artwork', destinationUrl: null });
    const description = 'A woodland fox print for a cosy nursery.';
    expect((await POST(mutationRequest('POST', { ...draft, description }))).status).toBe(201);
    expect(mocks.source).toHaveBeenCalledWith(42, 1, undefined, undefined, true);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ destinationUrl: null, description, status: 'DRAFT' }) });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('requires a verified destination when creating a scheduled Pin', async () => {
    await POST(mutationRequest('POST', { ...draft, saveDraft: false, scheduledAt: '2026-12-01T10:00:00Z' }));
    expect(mocks.source).toHaveBeenCalledWith(42, 1, undefined, undefined, false);
  });

  it.each(['', '  ', 'x'.repeat(501), '🌿'.repeat(501), null, 42])('rejects invalid supplied copy without spending an AWS request (%s)', async (description) => {
    expect((await POST(mutationRequest('POST', { ...draft, description }))).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('leaves no Pin or scheduled job behind if Bedrock fails', async () => {
    mocks.generate.mockRejectedValue(new Error('AWS Bedrock access was denied.'));
    const response = await POST(mutationRequest('POST', { ...draft, saveDraft: false, scheduledAt: '2026-12-01T10:00:00Z' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'AWS Bedrock access was denied.' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('validates the generated candidate at the API boundary without slicing it', async () => {
    mocks.generate.mockResolvedValue('x'.repeat(501));
    expect((await POST(mutationRequest('POST', draft))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects invalid scheduling input before loading context or calling AWS', async () => {
    expect((await POST(mutationRequest('POST', { ...draft, saveDraft: false, scheduledAt: 'bad' }))).status).toBe(400);
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});

describe('regenerating a saved Pin description for review', () => {
  it('uses the saved destination and creative type and returns a candidate without saving or publishing', async () => {
    const response = await POST(mutationRequest('POST', { action: 'regenerate-description', id: 7 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: 7, description: 'A woodland fox print for a cosy nursery.' } });
    expect(mocks.source).toHaveBeenCalledWith(42, 1, storedPin.destinationUrl, 'product_detail', false);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('can preview a regenerated description for an unsynced draft without changing its destination', async () => {
    mocks.pin.mockResolvedValue({ ...storedPin, destinationUrl: null });
    mocks.source.mockResolvedValue({ context, title: 'Unsynced fox artwork', destinationUrl: null });
    expect((await POST(mutationRequest('POST', { action: 'regenerate-description', id: 7 }))).status).toBe(200);
    expect(mocks.source).toHaveBeenCalledWith(42, 1, null, 'product_detail', true);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(['SCHEDULED', 'PUBLISHING', 'PUBLISHED'])('blocks regeneration for %s Pins before an AWS request', async (status) => {
    mocks.pin.mockResolvedValue({ ...storedPin, status });
    expect((await POST(mutationRequest('POST', { action: 'regenerate-description', id: 7 }))).status).toBe(409);
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('blocks a remote Pin even if its local status still says DRAFT', async () => {
    mocks.pin.mockResolvedValue({ ...storedPin, pinterestPinId: 'remote-7' });
    expect((await POST(mutationRequest('POST', { action: 'regenerate-description', id: 7 }))).status).toBe(409);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('returns a useful failure without replacing the saved text', async () => {
    mocks.generate.mockRejectedValue(new Error('AWS Bedrock did not finish.'));
    const response = await POST(mutationRequest('POST', { action: 'regenerate-description', id: 7 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'AWS Bedrock did not finish.' });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('saving reviewed Pin descriptions', () => {
  const body = { id: 7, description: '  A revised woodland print description.  ', expectedDescription: storedPin.description };

  it.each(['DRAFT', 'PAUSED', 'FAILED'])('saves only the description for an unpublished %s Pin', async (status) => {
    const row = { ...storedPin, status, scheduledAt: '2026-12-01T10:00:00Z', campaignId: 5 };
    mocks.pin.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, description: body.description.trim() });
    const response = await PATCH(mutationRequest('PATCH', body));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ status, scheduledAt: row.scheduledAt, campaignId: 5, description: body.description.trim() });
    expect(data.creativeStorageKey).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledWith({
      where: { id: 7, status: { in: ['DRAFT', 'PAUSED', 'FAILED'] }, pinterestPinId: null, description: storedPin.description, updatedAt: storedPin.updatedAt },
      data: { description: body.description.trim() },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each(['SCHEDULED', 'PUBLISHING', 'PUBLISHED'])('rejects edits for a %s Pin', async (status) => {
    mocks.pin.mockResolvedValue({ ...storedPin, status });
    expect((await PATCH(mutationRequest('PATCH', body))).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('rejects edits to an already remote Pin', async () => {
    mocks.pin.mockResolvedValue({ ...storedPin, pinterestPinId: 'remote-7' });
    expect((await PATCH(mutationRequest('PATCH', body))).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(['', 'x'.repeat(501), '🌿'.repeat(501), null])('rejects invalid manual descriptions without mutating the Pin (%s)', async (description) => {
    expect((await PATCH(mutationRequest('PATCH', { ...body, description }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('requires the original copy and detects another editor’s changes', async () => {
    expect((await PATCH(mutationRequest('PATCH', { id: 7, description: body.description }))).status).toBe(409);
    mocks.pin.mockResolvedValue({ ...storedPin, description: 'Someone else saved this.' });
    expect((await PATCH(mutationRequest('PATCH', body))).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('detects a concurrent save or publishing claim after reading', async () => {
    mocks.save.mockResolvedValue({ count: 0 });
    const response = await PATCH(mutationRequest('PATCH', body));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'This Pin changed while you were editing. Refresh the page and reopen Review before saving.' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('cannot combine description edits with a scheduling or title change', async () => {
    expect((await PATCH(mutationRequest('PATCH', { ...body, status: 'SCHEDULED' }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
