import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), board: vi.fn(), pins: vi.fn(), create: vi.fn(), update: vi.fn(), keys: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('./creative-storage', () => ({ loadPinCreativeStorageKeys: mocks.keys }));
import { buildPinterestSchedule, schedulePinterestPins } from './scheduling';

const tx = { pinterestBoard: { findUnique: mocks.board }, pinterestPin: { findMany: mocks.pins, updateMany: mocks.update }, pinterestCampaign: { create: mocks.create } };
const input = { name: 'Woodland launch', boardId: 10, pinIds: [7, 8], startDate: '2026-11-17', pinsPerDay: 2, timeZone: 'Europe/London' };
function pin(id = 7) {
  const listingId = id + 35;
  return {
    id, listingId, boardId: 10, imageId: id + 74, status: 'PAUSED', pinterestPinId: null, publishedAt: null,
    description: 'A woodland nursery print with a gentle animal character.',
    destinationUrl: `https://www.etsy.com/listing/${1000 + id}/old-slug`,
    updatedAt: new Date('2026-11-15T12:00:00Z'), scheduledAt: new Date('2026-08-01T09:00:00Z'), campaignId: null,
    listing: {
      etsyId: String(1000 + id), etsyDownloadId: String(2000 + id), etsyCustomisedId: null,
      state: 'active', etsyDownloadState: 'active', etsyCustomisedState: null,
      images: [{ id: id + 74, urlFullxFull: 'https://i.etsystatic.com/real-image.png', localFileName: null }],
      subSection: null,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-16T12:00:00Z').getTime());
  mocks.transaction.mockImplementation(async callback => callback(tx));
  mocks.board.mockResolvedValue({ id: 10 });
  mocks.pins.mockResolvedValue([pin(), pin(8)]);
  mocks.keys.mockResolvedValue(new Map());
  mocks.create.mockImplementation(async ({ data }) => ({ id: 20, ...data }));
  mocks.update.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.restoreAllMocks());

describe('London Pinterest calendar slots', () => {
  it('starts fresh tomorrow in the requested deterministic order', () => {
    expect(buildPinterestSchedule('2026-11-17', 5, 2).map(date => date.toISOString())).toEqual([
      '2026-11-17T09:00:00.000Z', '2026-11-17T13:00:00.000Z',
      '2026-11-18T09:00:00.000Z', '2026-11-18T13:00:00.000Z', '2026-11-19T09:00:00.000Z',
    ]);
  });

  it('keeps 09:00 and 13:00 local when Britain enters daylight saving time', () => {
    expect(buildPinterestSchedule('2027-03-27', 4, 2).map(date => date.toISOString())).toEqual([
      '2027-03-27T09:00:00.000Z', '2027-03-27T13:00:00.000Z', '2027-03-28T08:00:00.000Z', '2027-03-28T12:00:00.000Z',
    ]);
  });

  it('keeps local slots when Britain leaves daylight saving time', () => {
    expect(buildPinterestSchedule('2027-10-30', 4, 2).map(date => date.toISOString())).toEqual([
      '2027-10-30T08:00:00.000Z', '2027-10-30T12:00:00.000Z', '2027-10-31T09:00:00.000Z', '2027-10-31T13:00:00.000Z',
    ]);
  });

  it('uses all four daily slots and crosses leap day safely', () => {
    expect(buildPinterestSchedule('2028-02-29', 5, 4).map(date => date.toISOString())).toEqual([
      '2028-02-29T09:00:00.000Z', '2028-02-29T13:00:00.000Z', '2028-02-29T18:00:00.000Z', '2028-02-29T21:00:00.000Z', '2028-03-01T09:00:00.000Z',
    ]);
  });

  it.each(['2026-02-29', '2026-11-31', '17/11/2026', '2026-11-17T09:00:00Z', ''])('rejects invalid calendar date %s', startDate => {
    expect(() => buildPinterestSchedule(startDate, 2, 2)).toThrow();
  });

  it.each([0, 5, 1.5])('rejects invalid daily frequency %s', perDay => {
    expect(() => buildPinterestSchedule('2026-11-17', 2, perDay)).toThrow('between 1 and 4');
  });
});

describe('scheduling explicit ready Pins', () => {
  it('creates an active campaign and replaces only the selected Pins’ old dates while preserving their content', async () => {
    const result = await schedulePinterestPins(input);

    expect(result).toMatchObject({ id: 20, status: 'ACTIVE', scheduledCount: 2, pinIds: [7, 8], firstScheduledAt: new Date('2026-11-17T09:00:00Z'), lastScheduledAt: new Date('2026-11-17T13:00:00Z') });
    expect(mocks.pins).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [7, 8] } } }));
    expect(mocks.keys).toHaveBeenCalledWith([7, 8], tx);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: 'ACTIVE', startDate: new Date('2026-11-17T09:00:00Z'), endDate: new Date('2026-11-17T13:00:00Z'),
      configuration: { boardId: 10, timeZone: 'Europe/London', startDate: '2026-11-17', slots: [9, 13], pinIds: [7, 8] },
    }) });
    const first = mocks.update.mock.calls[0][0];
    expect(first.where).toMatchObject({ id: 7, boardId: 10, listingId: 42, status: { in: ['DRAFT', 'PAUSED', 'FAILED'] }, pinterestPinId: null, publishedAt: null, updatedAt: pin().updatedAt, description: pin().description });
    expect(first.data).toEqual({ campaignId: 20, status: 'SCHEDULED', scheduledAt: new Date('2026-11-17T09:00:00Z'), error: null, publicationKey: '42:81:10:2026-11-17T09:00:00.000Z' });
    expect(first.data).not.toHaveProperty('description');
    expect(first.data).not.toHaveProperty('destinationUrl');
    expect(first.data).not.toHaveProperty('creativeStorageKey');
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('preserves explicit selection order even if database rows return in another order', async () => {
    mocks.pins.mockResolvedValue([pin(8), pin()]);
    await schedulePinterestPins(input);
    expect(mocks.update.mock.calls.map(([{ where, data }]) => [where.id, data.scheduledAt.toISOString()])).toEqual([
      [7, '2026-11-17T09:00:00.000Z'], [8, '2026-11-17T13:00:00.000Z'],
    ]);
  });

  it.each(['DRAFT', 'PAUSED', 'FAILED'])('accepts an unpublished %s Pin', async status => {
    mocks.pins.mockResolvedValue([{ ...pin(), status }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).resolves.toMatchObject({ scheduledCount: 1 });
  });

  it.each(['SCHEDULED', 'PUBLISHING', 'PUBLISHED'])('does not replace an existing %s Pin', async status => {
    mocks.pins.mockResolvedValue([{ ...pin(), status }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).rejects.toThrow('Only unpublished');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([{ pinterestPinId: 'remote-7' }, { publishedAt: new Date('2026-11-15T09:00:00Z') }, { boardId: 9 }])('rejects published history or another board: %j', async change => {
    mocks.pins.mockResolvedValue([{ ...pin(), ...change }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).rejects.toThrow('Only unpublished');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['', 'x'.repeat(501), '🌿'.repeat(501)])('rejects an invalid saved description before campaign creation', async description => {
    mocks.pins.mockResolvedValue([{ ...pin(), description }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([null, 'https://www.etsy.com/listing/999/another-artwork', 'https://etsy.com.example.com/listing/1007/fox'])('rejects missing or mismatched destination %s', async destinationUrl => {
    mocks.pins.mockResolvedValue([{ ...pin(), destinationUrl }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).rejects.toThrow('Etsy destination');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('accepts a changed slug or locale for the exact active digital destination', async () => {
    mocks.pins.mockResolvedValue([{ ...pin(), destinationUrl: 'https://www.etsy.com/uk/listing/2007/new-slug?ref=pinterest' }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).resolves.toMatchObject({ scheduledCount: 1 });
  });

  it('does not schedule an inactive Etsy destination or an ambiguous mapping', async () => {
    mocks.pins.mockResolvedValue([{ ...pin(), listing: { ...pin().listing, state: 'inactive' } }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).rejects.toThrow('active Etsy listing');
    mocks.pins.mockResolvedValue([{ ...pin(), listing: { ...pin().listing, etsyDownloadId: '1007' } }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).rejects.toThrow('Etsy destination');
  });

  it('accepts a dedicated creative without a surviving original image', async () => {
    mocks.pins.mockResolvedValue([{ ...pin(), listing: { ...pin().listing, images: [] } }]);
    mocks.keys.mockResolvedValue(new Map([[7, '.pinterest-creatives/42/verified.png']]));
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).resolves.toMatchObject({ scheduledCount: 1 });
  });

  it('accepts an owned local source image with listing storage context without reading S3', async () => {
    mocks.pins.mockResolvedValue([{ ...pin(), listing: {
      ...pin().listing,
      images: [{ id: 81, urlFullxFull: null, localFileName: 'template-142.png' }],
      subSection: { shopSection: { shop: { id: 1 } } },
    } }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).resolves.toMatchObject({ scheduledCount: 1 });
  });

  it('accepts the first owned image for a Pin that uses its listing cover', async () => {
    mocks.pins.mockResolvedValue([{ ...pin(), imageId: null }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).resolves.toMatchObject({ scheduledCount: 1 });
    expect(mocks.update.mock.calls[0][0].data.publicationKey).toBe('42:cover:10:2026-11-17T09:00:00.000Z');
  });

  it('rejects a source image belonging to another listing or with no usable content', async () => {
    mocks.pins.mockResolvedValue([{ ...pin(), imageId: 999 }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).rejects.toThrow('no usable image');
    mocks.pins.mockResolvedValue([{ ...pin(), listing: { ...pin().listing, images: [{ id: 81, urlFullxFull: null, localFileName: null }] } }]);
    await expect(schedulePinterestPins({ ...input, pinIds: [7] })).rejects.toThrow('no usable source image');
  });

  it('rejects concurrent editing or a worker claim and leaves the transaction to roll back', async () => {
    mocks.update.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(schedulePinterestPins(input)).rejects.toThrow('Nothing was scheduled');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[1][0].where.updatedAt).toEqual(pin(8).updatedAt);
  });

  it('rejects a missing board or deleted selection', async () => {
    mocks.board.mockResolvedValue(null);
    await expect(schedulePinterestPins(input)).rejects.toThrow('board not found');
    mocks.board.mockResolvedValue({ id: 10 });
    mocks.pins.mockResolvedValue([pin()]);
    await expect(schedulePinterestPins(input)).rejects.toThrow('no longer exist');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    { pinIds: [] }, { pinIds: [7, 7] }, { pinIds: [0] }, { startDate: '2026-11-01' }, { startDate: '2026-11-16' }, { timeZone: 'UTC' },
  ])('rejects invalid selection or stale schedule before opening a transaction: %j', async change => {
    await expect(schedulePinterestPins({ ...input, ...change })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
