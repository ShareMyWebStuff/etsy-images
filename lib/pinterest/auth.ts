import { randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { decryptSecret, encryptSecret } from './crypto';
import type { PinterestAccount, PinterestEnvironment } from './types';

export const PINTEREST_SCOPES = ['boards:read', 'boards:write', 'pins:read', 'pins:write', 'user_accounts:read'] as const;

export function environment(): PinterestEnvironment {
  return process.env.PINTEREST_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production';
}
export function apiBase(env = environment()) { return env === 'sandbox' ? 'https://api-sandbox.pinterest.com/v5' : 'https://api.pinterest.com/v5'; }
export function redirectUri() { return process.env.PINTEREST_REDIRECT_URI ?? 'http://localhost:3002/api/pinterest/callback'; }
function credentials() {
  const id = process.env.PINTEREST_APP_ID;
  const secret = process.env.PINTEREST_APP_SECRET;
  if (!id || !secret) throw new Error('PINTEREST_APP_ID and PINTEREST_APP_SECRET must be configured.');
  return { id, secret };
}
export function createOAuthState() { return randomBytes(32).toString('base64url'); }
export function validOAuthState(expected: string, received: string) {
  const a = Buffer.from(expected); const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function authorizationUrl(state: string) {
  const { id } = credentials();
  const url = new URL('https://www.pinterest.com/oauth/');
  url.searchParams.set('client_id', id); url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', PINTEREST_SCOPES.join(',')); url.searchParams.set('state', state);
  return url;
}
type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; refresh_token_expires_at?: number; scope?: string };
async function tokenRequest(values: Record<string, string>, env: PinterestEnvironment) {
  const { id, secret } = credentials();
  const response = await fetch(`${apiBase(env)}/oauth/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values), cache: 'no-store' });
  const data = await response.json().catch(() => ({})) as TokenResponse & { message?: string };
  if (!response.ok) throw new Error(data.message ?? `Pinterest OAuth failed (${response.status}).`);
  return data;
}
function expiry(seconds?: number) { return seconds ? new Date(Date.now() + seconds * 1000) : null; }
function refreshExpiry(token: TokenResponse) {
  return token.refresh_token_expires_at ? new Date(token.refresh_token_expires_at * 1000) : expiry(token.refresh_token_expires_in);
}
export async function exchangeCode(code: string) {
  const env = environment();
  const token = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), continuous_refresh: 'true' }, env);
  const accountResponse = await fetch(`${apiBase(env)}/user_account`, { headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store' });
  if (!accountResponse.ok) throw new Error('Pinterest connected, but the account profile could not be read.');
  const account = await accountResponse.json() as PinterestAccount;
  const previous = await prisma.pinterestConnection.findUnique({ where: { id: 1 } });
  const sameConnection = previous?.environment === env && previous.accountId === account.id;
  const retainedRefreshToken = sameConnection ? previous.refreshTokenEncrypted : null;
  const data = {
    accountId: account.id,
    username: account.username,
    accessTokenEncrypted: encryptSecret(token.access_token),
    refreshTokenEncrypted: token.refresh_token ? encryptSecret(token.refresh_token) : retainedRefreshToken,
    accessTokenExpiresAt: expiry(token.expires_in),
    refreshTokenExpiresAt: token.refresh_token
      ? refreshExpiry(token)
      : retainedRefreshToken ? previous!.refreshTokenExpiresAt : null,
    scopes: token.scope?.split(/[ ,]+/) ?? [...PINTEREST_SCOPES],
    environment: env,
  };
  return prisma.pinterestConnection.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: { ...data, connectedAt: new Date(), lastSuccessfulApiTestAt: null, lastError: null },
  });
}
export async function getAccessToken() {
  const env = environment();
  const connection = await prisma.pinterestConnection.findUnique({ where: { id: 1 } });
  if (!connection) throw new Error('Pinterest is not connected.');
  if (connection.environment !== env) throw new Error(`Pinterest is connected to ${connection.environment}, but this application is using ${env}. Reconnect Pinterest for ${env} before continuing.`);
  if (!connection.accessTokenExpiresAt || connection.accessTokenExpiresAt.getTime() > Date.now() + 5 * 60_000) return decryptSecret(connection.accessTokenEncrypted);
  if (!connection.refreshTokenEncrypted) throw new Error('Pinterest access expired. Reconnect the account.');
  const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decryptSecret(connection.refreshTokenEncrypted) }, env);
  const updated = await prisma.pinterestConnection.updateMany({
    where: {
      id: connection.id,
      environment: env,
      accountId: connection.accountId,
      accessTokenEncrypted: connection.accessTokenEncrypted,
      refreshTokenEncrypted: connection.refreshTokenEncrypted,
    },
    data: {
      accessTokenEncrypted: encryptSecret(token.access_token),
      refreshTokenEncrypted: token.refresh_token ? encryptSecret(token.refresh_token) : connection.refreshTokenEncrypted,
      accessTokenExpiresAt: expiry(token.expires_in),
      refreshTokenExpiresAt: refreshExpiry(token) ?? (token.refresh_token ? null : connection.refreshTokenExpiresAt),
      scopes: token.scope?.split(/[ ,]+/) ?? [...PINTEREST_SCOPES],
      lastError: null,
    },
  });
  if (updated.count !== 1) throw new Error('The Pinterest connection changed while access was refreshing. Retry the request, or reconnect Pinterest before continuing.');
  return token.access_token;
}
