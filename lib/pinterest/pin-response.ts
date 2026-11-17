/** Keeps private creative locations on the server, including with regenerated Prisma clients. */
export function sanitizePinResponse<T extends object>(pin: T): Omit<T, 'creativeStorageKey'> {
  const { creativeStorageKey: _storageKey, ...safePin } = pin as T & { creativeStorageKey?: unknown };
  return safePin;
}
