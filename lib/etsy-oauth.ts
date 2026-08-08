import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export type EtsyTokens = {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  expires_at: number;
};

const tokenFilePath = path.join(process.cwd(), '.etsy-tokens.json');

function base64Url(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());

  return { verifier, challenge };
}

export function createState() {
  return base64Url(crypto.randomBytes(32));
}

export function getEtsyKeystring() {
  const keystring = process.env.ETSY_KEYSTRING ?? process.env.ETSY_API_KEY;

  if (!keystring) {
    throw new Error('Missing ETSY_KEYSTRING environment variable.');
  }

  return keystring;
}

export function getRedirectUri(request: Request) {
  return process.env.ETSY_REDIRECT_URI ?? new URL('/api/etsy/callback', request.url).toString();
}

export function getEtsyAuthorizationUrl(params: {
  request: Request;
  state: string;
  codeChallenge: string;
}) {
  const url = new URL('https://www.etsy.com/oauth/connect');

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', getEtsyKeystring());
  url.searchParams.set('redirect_uri', getRedirectUri(params.request));
  url.searchParams.set('scope', 'listings_r listings_w listings_d shops_r shops_w');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return url;
}

async function postTokenRequest(body: URLSearchParams) {
  const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Etsy token request failed ${response.status} ${response.statusText}: ${responseText}`);
  }

  return JSON.parse(responseText) as Omit<EtsyTokens, 'expires_at'>;
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: getEtsyKeystring(),
    redirect_uri: params.redirectUri,
    code: params.code,
    code_verifier: params.codeVerifier,
  });

  return saveTokens(await postTokenRequest(body));
}

export async function refreshTokens(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: getEtsyKeystring(),
    refresh_token: refreshToken,
  });

  return saveTokens(await postTokenRequest(body));
}

export async function saveTokens(tokens: Omit<EtsyTokens, 'expires_at'>) {
  const savedTokens: EtsyTokens = {
    ...tokens,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };

  await fs.writeFile(tokenFilePath, `${JSON.stringify(savedTokens, null, 2)}\n`, 'utf8');

  return savedTokens;
}

export async function readSavedTokens() {
  try {
    const file = await fs.readFile(tokenFilePath, 'utf8');
    return JSON.parse(file) as EtsyTokens;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function getValidEtsyAccessToken() {
  const envAccessToken = process.env.ETSY_ACCESS_TOKEN;

  if (envAccessToken) {
    return envAccessToken;
  }

  const savedTokens = await readSavedTokens();

  if (!savedTokens) {
    throw new Error('Connect Etsy before loading draft listings. No Etsy OAuth token is saved locally.');
  }

  if (Date.now() < savedTokens.expires_at - 60_000) {
    return savedTokens.access_token;
  }

  const refreshedTokens = await refreshTokens(savedTokens.refresh_token);
  return refreshedTokens.access_token;
}
