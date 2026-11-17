import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ token: vi.fn(), fetch: vi.fn() }));
vi.mock('./auth', () => ({ apiBase: () => 'https://api.pinterest.com/v5', getAccessToken: mocks.token }));
import { pinterestRequest, PinterestRequestUncertainError } from './client';

beforeEach(() => { vi.resetAllMocks(); mocks.token.mockResolvedValue('test-token'); vi.stubGlobal('fetch', mocks.fetch); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Pinterest request retries', () => {
  it('retries a failed read once', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(Response.json({ message: 'Temporary failure' }, { status: 503 })).mockResolvedValueOnce(Response.json({ id: '123' }));
    const result = pinterestRequest('/boards/123');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({ id: '123' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][1].signal).toBeDefined();
  });

  it('does not blindly repeat Pin creation after an HTTP 500', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ message: 'Unknown result' }, { status: 500 }));
    await expect(pinterestRequest('/pins', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(PinterestRequestUncertainError);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['network', 'unreadable success'])('flags %s as uncertain without creating the Pin again', async (failure) => {
    if (failure === 'network') mocks.fetch.mockRejectedValue(new TypeError('Connection reset'));
    else mocks.fetch.mockResolvedValue(new Response('invalid JSON', { status: 201 }));
    await expect(pinterestRequest('/pins', { method: 'POST', body: '{}' })).rejects.toThrow('Check Pinterest before retrying');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry other writes on server failures', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ message: 'Temporary failure' }, { status: 503 }));
    await expect(pinterestRequest('/boards', { method: 'POST', body: '{}' })).rejects.toThrow('Temporary failure');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('can retry a definite rate-limit rejection once before Pin creation', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(Response.json({ message: 'Rate limited' }, { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(Response.json({ id: '456' }));
    const result = pinterestRequest('/pins', { method: 'POST', body: '{}' });
    await vi.advanceTimersByTimeAsync(1999);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ id: '456' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a definite bad request distinct from an uncertain publication', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ message: 'Invalid description' }, { status: 400 }));
    await expect(pinterestRequest('/pins', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 400, message: 'Invalid description' });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
