import { apiBase, getAccessToken } from './auth';
import { PinterestApiError } from './types';

export async function pinterestRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }, cache: 'no-store' });
  if (response.ok) return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  const body = await response.json().catch(() => ({})) as { message?: string; code?: number };
  const wait = Number(response.headers.get('retry-after') ?? 0);
  if (retry && (response.status === 429 || response.status >= 500)) {
    await new Promise((resolve) => setTimeout(resolve, Math.min((wait || 1) * 1000, 5000)));
    return pinterestRequest<T>(path, init, false);
  }
  throw new PinterestApiError(body.message ?? `Pinterest API request failed (${response.status}).`, response.status, body.code, wait || undefined);
}
