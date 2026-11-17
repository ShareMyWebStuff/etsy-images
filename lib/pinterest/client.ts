import { apiBase, getAccessToken } from './auth';
import { PinterestApiError } from './types';

export class PinterestRequestUncertainError extends Error {
  constructor(options?: ErrorOptions) {
    super('Pinterest may have created this Pin, but the result could not be confirmed. Check Pinterest before retrying to avoid duplicates.', options);
    this.name = 'PinterestRequestUncertainError';
  }
}

export async function pinterestRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getAccessToken();
  const method = (init.method ?? 'GET').toUpperCase();
  const createsPin = method === 'POST' && path.split('?')[0] === '/pins';
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000), headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }, cache: 'no-store' });
  } catch (error) {
    if (createsPin) throw new PinterestRequestUncertainError({ cause: error });
    throw error;
  }
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; }
    catch (error) {
      if (createsPin) throw new PinterestRequestUncertainError({ cause: error });
      throw error;
    }
  }
  const body = await response.json().catch(() => ({})) as { message?: string; code?: number };
  const wait = Number(response.headers.get('retry-after') ?? 0);
  if (createsPin && response.status >= 500) throw new PinterestRequestUncertainError();
  const safeRead = method === 'GET' || method === 'HEAD';
  // A rate-limit rejection is safe to retry. A failed write may already have taken effect.
  if (retry && (response.status === 429 || (safeRead && response.status >= 500))) {
    await new Promise((resolve) => setTimeout(resolve, Math.min((wait || 1) * 1000, 5000)));
    return pinterestRequest<T>(path, init, false);
  }
  throw new PinterestApiError(body.message ?? `Pinterest API request failed (${response.status}).`, response.status, body.code, wait || undefined);
}
