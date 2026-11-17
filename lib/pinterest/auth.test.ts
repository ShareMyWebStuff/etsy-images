import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { pinterestConnection: {
  findUnique: mocks.findUnique,
  upsert: mocks.upsert,
  updateMany: mocks.updateMany,
} } }));
vi.mock('./crypto', () => ({ encryptSecret: mocks.encrypt, decryptSecret: mocks.decrypt }));

import { exchangeCode, getAccessToken } from './auth';

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    accountId: 'account-1',
    environment: 'production',
    accessTokenEncrypted: 'encrypted:old-access',
    refreshTokenEncrypted: 'encrypted:old-refresh',
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function codeResponses(token: Record<string, unknown>, accountId = 'account-1') {
  mocks.fetch
    .mockResolvedValueOnce(jsonResponse(token))
    .mockResolvedValueOnce(jsonResponse({ id: accountId, username: 'shop-owner' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PINTEREST_ENVIRONMENT', 'production');
  vi.stubEnv('PINTEREST_APP_ID', 'test-app');
  vi.stubEnv('PINTEREST_APP_SECRET', 'test-secret');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.encrypt.mockImplementation((value: string) => `encrypted:${value}`);
  mocks.decrypt.mockImplementation((value: string) => value.replace(/^encrypted:/, ''));
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Pinterest access token environment and refresh safety', () => {
  it('returns a current token only from the configured environment', async () => {
    mocks.findUnique.mockResolvedValue(connection());

    expect(await getAccessToken()).toBe('old-access');

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { stored: 'sandbox', configured: 'production', expired: false },
    { stored: 'sandbox', configured: 'production', expired: true },
    { stored: 'production', configured: 'sandbox', expired: false },
    { stored: 'production', configured: 'sandbox', expired: true },
  ])('rejects $stored credentials while configured for $configured (expired: $expired)', async ({ stored, configured, expired }) => {
    vi.stubEnv('PINTEREST_ENVIRONMENT', configured);
    mocks.findUnique.mockResolvedValue(connection({
      environment: stored,
      ...(expired ? { accessTokenExpiresAt: new Date(0) } : {}),
    }));

    await expect(getAccessToken()).rejects.toThrow(`Reconnect Pinterest for ${configured}`);

    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('refreshes against the matching endpoint and preserves an unrotated refresh token and expiry', async () => {
    const previous = connection({ environment: 'sandbox', accessTokenExpiresAt: new Date(0) });
    vi.stubEnv('PINTEREST_ENVIRONMENT', 'sandbox');
    mocks.findUnique.mockResolvedValue(previous);
    mocks.fetch.mockResolvedValue(jsonResponse({ access_token: 'new-access', expires_in: 3600 }));

    expect(await getAccessToken()).toBe('new-access');

    expect(mocks.fetch).toHaveBeenCalledWith('https://api-sandbox.pinterest.com/v5/oauth/token', expect.objectContaining({ method: 'POST' }));
    const body = mocks.fetch.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1,
        environment: 'sandbox',
        accountId: 'account-1',
        accessTokenEncrypted: 'encrypted:old-access',
        refreshTokenEncrypted: 'encrypted:old-refresh',
      },
      data: expect.objectContaining({
        accessTokenEncrypted: 'encrypted:new-access',
        refreshTokenEncrypted: previous.refreshTokenEncrypted,
        refreshTokenExpiresAt: previous.refreshTokenExpiresAt,
      }),
    });
  });

  it('stores rotated refresh credentials and their expiry', async () => {
    mocks.findUnique.mockResolvedValue(connection({ accessTokenExpiresAt: new Date(0) }));
    mocks.fetch.mockResolvedValue(jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', refresh_token_expires_at: 2_000_000_000 }));

    await getAccessToken();

    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      refreshTokenEncrypted: 'encrypted:new-refresh', refreshTokenExpiresAt: new Date(2_000_000_000_000),
    }) }));
  });

  it('rejects a stale refresh when another connection replaced the credentials', async () => {
    mocks.findUnique.mockResolvedValue(connection({ accessTokenExpiresAt: new Date(0) }));
    mocks.fetch.mockResolvedValue(jsonResponse({ access_token: 'stale-access', refresh_token: 'stale-refresh' }));
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(getAccessToken()).rejects.toThrow(/connection changed.*Retry.*reconnect/i);

    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({
      id: 1,
      environment: 'production',
      accountId: 'account-1',
      accessTokenEncrypted: 'encrypted:old-access',
      refreshTokenEncrypted: 'encrypted:old-refresh',
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe('Pinterest authorization code connection replacement', () => {
  it.each([
    { storedEnvironment: 'sandbox', previousAccount: 'account-1', nextAccount: 'account-1' },
    { storedEnvironment: 'production', previousAccount: 'account-1', nextAccount: 'account-2' },
    { storedEnvironment: 'sandbox', previousAccount: 'account-1', nextAccount: 'account-2' },
  ])('clears old refresh credentials on an environment/account switch: $storedEnvironment $previousAccount to $nextAccount', async ({ storedEnvironment, previousAccount, nextAccount }) => {
    mocks.findUnique.mockResolvedValue(connection({ environment: storedEnvironment, accountId: previousAccount }));
    codeResponses({ access_token: 'new-access', expires_in: 3600, refresh_token_expires_in: 7200 }, nextAccount);

    await exchangeCode('authorization-code');

    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: expect.objectContaining({ accountId: nextAccount, environment: 'production', refreshTokenEncrypted: null, refreshTokenExpiresAt: null }),
      update: expect.objectContaining({ accountId: nextAccount, environment: 'production', accessTokenEncrypted: 'encrypted:new-access', refreshTokenEncrypted: null, refreshTokenExpiresAt: null, lastSuccessfulApiTestAt: null }),
    });
    expect(mocks.findUnique.mock.invocationCallOrder[0]).toBeLessThan(mocks.upsert.mock.invocationCallOrder[0]);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it('retains the refresh token and expiry only when reconnecting the same account in the same environment', async () => {
    const previous = connection();
    mocks.findUnique.mockResolvedValue(previous);
    codeResponses({ access_token: 'new-access', expires_in: 3600 });

    await exchangeCode('authorization-code');

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({
      refreshTokenEncrypted: previous.refreshTokenEncrypted,
      refreshTokenExpiresAt: previous.refreshTokenExpiresAt,
    }) }));
  });

  it('uses a new refresh token when an account switch returns one', async () => {
    mocks.findUnique.mockResolvedValue(connection({ environment: 'sandbox' }));
    codeResponses({ access_token: 'new-access', refresh_token: 'new-refresh', refresh_token_expires_at: 2_000_000_000 }, 'account-2');

    await exchangeCode('authorization-code');

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({
      accountId: 'account-2', environment: 'production', refreshTokenEncrypted: 'encrypted:new-refresh', refreshTokenExpiresAt: new Date(2_000_000_000_000),
    }) }));
  });

  it('clears a previous refresh expiry when a new refresh token has no expiry metadata', async () => {
    mocks.findUnique.mockResolvedValue(connection());
    codeResponses({ access_token: 'new-access', refresh_token: 'new-refresh' });

    await exchangeCode('authorization-code');

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({
      refreshTokenEncrypted: 'encrypted:new-refresh', refreshTokenExpiresAt: null,
    }) }));
  });

  it('creates a first connection without orphaned refresh expiry metadata', async () => {
    mocks.findUnique.mockResolvedValue(null);
    codeResponses({ access_token: 'new-access', refresh_token_expires_in: 7200 });

    await exchangeCode('authorization-code');

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      refreshTokenEncrypted: null, refreshTokenExpiresAt: null,
    }) }));
  });
});
