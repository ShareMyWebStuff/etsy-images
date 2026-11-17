import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ board: vi.fn(), remove: vi.fn(), available: vi.fn(), sync: vi.fn(), api: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { pinterestBoard: { findUnique: mocks.board, delete: mocks.remove } } }));
vi.mock('@/lib/pinterest/client', () => ({ pinterestRequest: mocks.api }));
vi.mock('@/lib/pinterest/boards', () => ({ assertPinterestBoardAvailable: mocks.available, syncBoards: mocks.sync, clearBoard: vi.fn(), suggestedBoards: vi.fn() }));
import { DELETE, PATCH } from './route';

const board = { id: 1, pinterestBoardId: '12345', name: 'Woodland', pinCount: 0, _count: { pins: 0 } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.board.mockResolvedValue(board);
  mocks.available.mockResolvedValue({ id: '12345', name: 'Woodland' });
});

describe('remote board mutations', () => {
  it('checks the active connection before updating a board', async () => {
    const request = new Request('http://localhost/api/pinterest/boards', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 1, name: 'New name' }) });
    expect((await PATCH(request)).status).toBe(200);
    expect(mocks.available).toHaveBeenCalledWith(board);
    expect(mocks.api).toHaveBeenCalledWith('/boards/12345', { method: 'PATCH', body: JSON.stringify({ name: 'New name' }) });
    expect(mocks.available.mock.invocationCallOrder[0]).toBeLessThan(mocks.api.mock.invocationCallOrder[0]);
  });

  it('checks the active connection before deleting an empty board', async () => {
    expect((await DELETE(new Request('http://localhost/api/pinterest/boards?id=1'))).status).toBe(200);
    expect(mocks.available).toHaveBeenCalledWith(board);
    expect(mocks.api).toHaveBeenCalledWith('/boards/12345', { method: 'DELETE' });
    expect(mocks.available.mock.invocationCallOrder[0]).toBeLessThan(mocks.api.mock.invocationCallOrder[0]);
    expect(mocks.api.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
  });

  it.each(['PATCH', 'DELETE'])('does not mutate a remote or local board when unavailable during %s', async (method) => {
    mocks.available.mockRejectedValue(new Error('This Pinterest board is not available to the current connection.'));
    const request = new Request('http://localhost/api/pinterest/boards?id=1', { method,
      ...(method === 'PATCH' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 1, name: 'New name' }) } : {}),
    });
    const response = await (method === 'PATCH' ? PATCH(request) : DELETE(request));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'This Pinterest board is not available to the current connection.' });
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
