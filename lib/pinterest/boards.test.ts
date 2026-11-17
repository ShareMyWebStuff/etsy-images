import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinterestApiError } from './types';

const mocks = vi.hoisted(() => ({ board: vi.fn(), upsert: vi.fn(), deletePins: vi.fn(), api: vi.fn(), connection: vi.fn(), exclusions: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  pinterestBoard: { findUnique: mocks.board, upsert: mocks.upsert },
  pinterestPin: { deleteMany: mocks.deletePins },
  pinterestConnection: { findUnique: mocks.connection },
} }));
vi.mock('./client', () => ({ pinterestRequest: mocks.api }));
vi.mock('./board-environments', () => ({ loadExcludedSandboxBoardIds: mocks.exclusions }));
import { assertPinterestBoardAvailable, clearBoard, syncBoards } from './boards';

const board = { id: 1, pinterestBoardId: '12345', name: 'Woodland' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PINTEREST_ENVIRONMENT', 'production');
  mocks.board.mockResolvedValue(board);
  mocks.deletePins.mockResolvedValue({ count: 0 });
  mocks.connection.mockResolvedValue({ accountId: 'connected-account', environment: 'production' });
  mocks.exclusions.mockResolvedValue(new Set());
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('current-connection Pinterest board checks', () => {
  it('requires the exact requested ID from a read on the active API connection', async () => {
    const remote = { id: '12345', name: 'Woodland' };
    mocks.api.mockResolvedValue(remote);
    await expect(assertPinterestBoardAvailable(board)).resolves.toEqual(remote);
    expect(mocks.api.mock.calls).toEqual([['/boards/12345', { method: 'GET' }]]);
  });

  it.each([null, undefined, { pinterestBoardId: '' }])('rejects a missing local board or link before accessing Pinterest', async (local) => {
    await expect(assertPinterestBoardAvailable(local)).rejects.toThrow('not available to the current connection');
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it.each([null, {}, { id: '98765', name: 'Another board' }])('rejects missing or mismatched board responses', async (remote) => {
    mocks.api.mockResolvedValue(remote);
    await expect(assertPinterestBoardAvailable(board)).rejects.toThrow('not available to the current connection');
  });

  it.each([403, 404])('provides a connection-specific error for unavailable HTTP %s boards', async (status) => {
    mocks.api.mockRejectedValue(new PinterestApiError('Unavailable board', status));
    await expect(assertPinterestBoardAvailable(board)).rejects.toThrow('Sync boards or reconnect Pinterest');
  });

  it('preserves unrelated request failures rather than treating them as a missing board', async () => {
    const error = new PinterestApiError('Rate limited', 429);
    mocks.api.mockRejectedValue(error);
    await expect(assertPinterestBoardAvailable(board)).rejects.toBe(error);
  });

  it('rejects a known sandbox board in production before any remote request', async () => {
    mocks.exclusions.mockResolvedValue(new Set(['12345']));
    await expect(assertPinterestBoardAvailable(board)).rejects.toThrow('created in the sandbox');
    expect(mocks.connection).toHaveBeenCalledWith({ where: { id: 1 }, select: { accountId: true, environment: true } });
    expect(mocks.exclusions).toHaveBeenCalledWith('connected-account', 'production');
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('keeps sandbox availability checks unchanged', async () => {
    vi.stubEnv('PINTEREST_ENVIRONMENT', 'sandbox');
    mocks.exclusions.mockResolvedValue(new Set(['12345']));
    mocks.api.mockResolvedValue({ id: '12345', name: 'Woodland' });
    await expect(assertPinterestBoardAvailable(board)).resolves.toEqual({ id: '12345', name: 'Woodland' });
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.exclusions).not.toHaveBeenCalled();
  });

  it('does not apply another connection environment\'s account exclusions', async () => {
    mocks.connection.mockResolvedValue({ accountId: 'connected-account', environment: 'sandbox' });
    mocks.api.mockResolvedValue({ id: '12345', name: 'Woodland' });
    await assertPinterestBoardAvailable(board);
    expect(mocks.exclusions).toHaveBeenCalledWith(null, 'production');
  });
});

describe('syncing production boards', () => {
  it('excludes known sandbox IDs on every remote page while retaining fresh same-topic boards', async () => {
    mocks.exclusions.mockResolvedValue(new Set(['old-bugs', 'old-safari']));
    mocks.api.mockResolvedValueOnce({ items: [{ id: 'old-bugs', name: 'Bugs', privacy: 'PUBLIC' }, { id: 'fresh-bugs', name: 'Bugs Wall Art', description: 'Physical prints', privacy: 'PUBLIC', pin_count: 1 }], bookmark: 'next-page' })
      .mockResolvedValueOnce({ items: [{ id: 'old-safari', name: 'Safari', privacy: 'PUBLIC' }, { id: 'fresh-safari', name: 'Safari Wall Art' }], bookmark: null });
    await expect(syncBoards()).resolves.toBe(2);
    expect(mocks.api.mock.calls).toEqual([['/boards?page_size=100'], ['/boards?page_size=100&bookmark=next-page']]);
    expect(mocks.upsert.mock.calls.map(([input]) => input.where.pinterestBoardId)).toEqual(['fresh-bugs', 'fresh-safari']);
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ create: { name: 'Bugs Wall Art', description: 'Physical prints', privacy: 'PUBLIC', pinCount: 1 }, update: { name: 'Bugs Wall Art', description: 'Physical prints' } });
    expect(mocks.exclusions.mock.invocationCallOrder[0]).toBeLessThan(mocks.api.mock.invocationCallOrder[0]);
  });

  it('does not exclude boards when using the sandbox API', async () => {
    vi.stubEnv('PINTEREST_ENVIRONMENT', 'sandbox');
    mocks.exclusions.mockResolvedValue(new Set(['12345']));
    mocks.api.mockResolvedValue({ items: [{ id: '12345', name: 'Woodland' }], bookmark: null });
    await expect(syncBoards()).resolves.toBe(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.exclusions).not.toHaveBeenCalled();
  });

  it.each(['availability', 'sync'])('blocks %s when the registry cannot be safely loaded', async (operation) => {
    const error = new Error('The Pinterest board environment registry is invalid.');
    mocks.exclusions.mockRejectedValue(error);
    await expect(operation === 'sync' ? syncBoards() : assertPinterestBoardAvailable(board)).rejects.toBe(error);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe('clearing a Pinterest board', () => {
  it('does not list or delete Pins for an excluded sandbox board in production', async () => {
    mocks.exclusions.mockResolvedValue(new Set(['12345']));
    await expect(clearBoard(1)).rejects.toThrow('created in the sandbox');
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.deletePins).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unavailable board before listing or deleting remote Pins or local records', async () => {
    mocks.api.mockRejectedValue(new PinterestApiError('Board not found', 404));
    await expect(clearBoard(1)).rejects.toThrow('not available to the current connection');
    expect(mocks.api.mock.calls).toEqual([['/boards/12345', { method: 'GET' }]]);
    expect(mocks.deletePins).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('checks the board, walks every Pin page, and then clears remote and local Pins', async () => {
    mocks.api.mockResolvedValueOnce({ id: '12345', name: 'Woodland' })
      .mockResolvedValueOnce({ items: [], bookmark: 'page2' })
      .mockResolvedValueOnce({ items: [{ id: 'pin1' }, { id: 'pin2' }], bookmark: null })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ items: [], bookmark: null });
    mocks.deletePins.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 3 });
    await expect(clearBoard(1)).resolves.toEqual({ deletedFromPinterest: 2, deletedLocalOnly: 3 });
    expect(mocks.api.mock.calls).toEqual([
      ['/boards/12345', { method: 'GET' }],
      ['/boards/12345/pins?page_size=100'],
      ['/boards/12345/pins?page_size=100&bookmark=page2'],
      ['/pins/pin1', { method: 'DELETE' }], ['/pins/pin2', { method: 'DELETE' }], ['/boards?page_size=100'],
    ]);
    expect(mocks.deletePins.mock.calls).toEqual([
      [{ where: { pinterestPinId: 'pin1' } }], [{ where: { pinterestPinId: 'pin2' } }], [{ where: { boardId: 1 } }],
    ]);
    expect(mocks.api.mock.invocationCallOrder[0]).toBeLessThan(mocks.deletePins.mock.invocationCallOrder[0]);
  });
});
