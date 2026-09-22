import { afterEach, describe, expect, it, vi } from 'vitest';

import { getEtsyAuthorizationUrl, getEtsyOAuthConnectionStatus } from '@/lib/etsy-oauth';

describe('Etsy accounting OAuth scope', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('requests transactions_r alongside the existing listing and shop scopes', () => {
    vi.stubEnv('ETSY_KEYSTRING', 'test-key');
    vi.stubEnv('ETSY_REDIRECT_URI', 'https://example.test/api/etsy/callback');
    const url = getEtsyAuthorizationUrl({
      request: new Request('https://example.test/api/etsy/connect'),
      state: 'state',
      codeChallenge: 'challenge',
    });
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(expect.arrayContaining([
      'listings_r',
      'listings_w',
      'shops_r',
      'shops_w',
      'transactions_r',
    ]));
  });

  it('requires declared transaction scope for environment-provided tokens', async () => {
    vi.stubEnv('ETSY_ACCESS_TOKEN', 'token');
    vi.stubEnv('ETSY_ACCESS_TOKEN_SCOPES', 'listings_r shops_r');
    await expect(getEtsyOAuthConnectionStatus()).resolves.toMatchObject({ connected: true, hasTransactionsScope: false });
    vi.stubEnv('ETSY_ACCESS_TOKEN_SCOPES', 'listings_r shops_r transactions_r');
    await expect(getEtsyOAuthConnectionStatus()).resolves.toMatchObject({ connected: true, hasTransactionsScope: true });
  });
});
