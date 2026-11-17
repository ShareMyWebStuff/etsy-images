import { createHash } from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ETSY_LISTINGS_DIRECTORY } from '@/lib/config';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query, $executeRaw: mocks.execute } }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read }));

import { attachPinCreativeStorageKey, loadPinCreativeStorageKeys, readPinCreative, validatePinCreativeStorageKey } from './creative-storage';

const bytes = Buffer.from('immutable creative PNG bytes');
const digest = createHash('sha256').update(bytes).digest('hex');
const key = `.pinterest-creatives/42/${digest}.png`;
const db = { $queryRaw: mocks.query, $executeRaw: mocks.execute };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.execute.mockResolvedValue(1);
  mocks.read.mockResolvedValue(bytes);
});

describe('dedicated Pin creative storage', () => {
  it('accepts only the immutable PNG key for the owning listing', () => {
    expect(validatePinCreativeStorageKey(key, 42)).toBe(key);
    expect(() => validatePinCreativeStorageKey(key, 43)).toThrow('does not belong');
  });

  it.each([
    '../42/image.png', `.pinterest-creatives/42/../${digest}.png`, `.pinterest-creatives/42/${digest}.png?raw=1`,
    `.pinterest-creatives/042/${digest}.png`, `.pinterest-creatives/0/${digest}.png`,
    `.pinterest-creatives/42/${digest}.jpg`, `.pinterest-creatives/42/${digest.toUpperCase()}.png`,
    `.pinterest-creatives\\42\\${digest}.png`, `.pinterest-creatives/42/${digest}.png/extra`,
    `https://example.com/.pinterest-creatives/42/${digest}.png`,
  ])('rejects malformed or escaping storage key %s', (invalid) => {
    expect(() => validatePinCreativeStorageKey(invalid, 42)).toThrow('does not belong');
  });

  it('loads a batch through bound raw SQL and excludes Pins without dedicated creatives', async () => {
    mocks.query.mockResolvedValue([{ id: 1, listingId: 42, creativeStorageKey: key }, { id: 2, listingId: 43, creativeStorageKey: null }]);
    expect(await loadPinCreativeStorageKeys([1, 2, 1])).toEqual(new Map([[1, key]]));
    const query = mocks.query.mock.calls[0][0];
    expect(query.sql).toContain('SELECT id, listingId, creativeStorageKey');
    expect(query.values).toEqual([1, 2]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('does not query an empty batch and rejects an invalid ID before accessing the database', async () => {
    expect(await loadPinCreativeStorageKeys([])).toEqual(new Map());
    await expect(loadPinCreativeStorageKeys([0])).rejects.toThrow('valid Pin');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects a stored key belonging to a different listing instead of falling back', async () => {
    mocks.query.mockResolvedValue([{ id: 1, listingId: 43, creativeStorageKey: key }]);
    await expect(loadPinCreativeStorageKeys([1])).rejects.toThrow('does not belong');
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('attaches using the supplied transaction and guards the listing, draft status and unpublished state', async () => {
    await attachPinCreativeStorageKey(db, 7, 42, key);
    const [sql, ...values] = mocks.execute.mock.calls[0];
    expect(sql.join('')).toContain("AND status = 'DRAFT' AND pinterestPinId IS NULL");
    expect(sql.join('')).toContain('WHERE id =');
    expect(sql.join('')).toContain('AND listingId =');
    expect(values).toEqual([key, 7, 42]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('accepts an unchanged key only after confirming the same unpublished draft still owns it', async () => {
    mocks.execute.mockResolvedValue(0);
    mocks.query.mockResolvedValue([{ id: 7 }]);
    await attachPinCreativeStorageKey(db, 7, 42, key);
    const [sql, ...values] = mocks.query.mock.calls[0];
    expect(sql.join('')).toContain("AND status = 'DRAFT'");
    expect(sql.join('')).toContain('pinterestPinId IS NULL AND creativeStorageKey =');
    expect(values).toEqual([7, 42, key]);
  });

  it('rejects a stale or non-draft attachment and never retries without its guards', async () => {
    mocks.execute.mockResolvedValue(0);
    await expect(attachPinCreativeStorageKey(db, 7, 42, key)).rejects.toThrow('unpublished draft for the same listing');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched listing before attempting an attachment', async () => {
    await expect(attachPinCreativeStorageKey(db, 7, 43, key)).rejects.toThrow('does not belong');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reads the exact immutable bytes from the dedicated storage prefix without writes', async () => {
    await expect(readPinCreative(key, 42)).resolves.toEqual(bytes);
    expect(mocks.read).toHaveBeenCalledWith(path.join(ETSY_LISTINGS_DIRECTORY, '.pinterest-creatives', '42', `${digest}.png`));
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(['missing', 'changed'])('rejects %s creative contents without revealing the private path', async (failure) => {
    if (failure === 'missing') mocks.read.mockRejectedValue(new Error(`S3 missing ${key}`));
    else mocks.read.mockResolvedValue(Buffer.from('different bytes'));
    await expect(readPinCreative(key, 42)).rejects.toThrow('The Pin creative image is unavailable.');
    await expect(readPinCreative(key, 42)).rejects.not.toThrow(digest);
  });
});
