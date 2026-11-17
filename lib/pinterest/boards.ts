import { prisma } from '@/lib/prisma';
import { pinterestRequest } from './client';
import { environment } from './auth';
import { loadExcludedSandboxBoardIds } from './board-environments';
import { PinterestApiError, type PinterestBoardApi, type PinterestPage } from './types';

async function excludedProductionBoards() {
  const env = environment();
  if (env !== 'production') return new Set<string>();
  const connection = await prisma.pinterestConnection.findUnique({ where: { id: 1 }, select: { accountId: true, environment: true } });
  return loadExcludedSandboxBoardIds(connection?.environment === env ? connection.accountId : null, env);
}

/** Checks this board through the active connection before changing remote resources. */
export async function assertPinterestBoardAvailable(board: { pinterestBoardId: string } | null | undefined) {
  const unavailable = 'This Pinterest board is not available to the current connection. Sync boards or reconnect Pinterest before trying again.';
  if (!board?.pinterestBoardId?.trim()) throw new Error(unavailable);
  if ((await excludedProductionBoards()).has(board.pinterestBoardId)) {
    throw new Error('This Pinterest board is not available in production because it was created in the sandbox. Use its production replacement.');
  }
  let remote: PinterestBoardApi;
  try {
    remote = await pinterestRequest<PinterestBoardApi>(`/boards/${encodeURIComponent(board.pinterestBoardId)}`, { method: 'GET' });
  } catch (error) {
    if (error instanceof PinterestApiError && (error.status === 403 || error.status === 404)) throw new Error(unavailable);
    throw error;
  }
  if (!remote || remote.id !== board.pinterestBoardId) throw new Error(unavailable);
  return remote;
}

export async function syncBoards() {
  const excluded = await excludedProductionBoards();
  let bookmark: string | null | undefined; const boards: PinterestBoardApi[] = [];
  do { const query = bookmark ? `?page_size=100&bookmark=${encodeURIComponent(bookmark)}` : '?page_size=100'; const page = await pinterestRequest<PinterestPage<PinterestBoardApi>>(`/boards${query}`); boards.push(...page.items); bookmark = page.bookmark; } while (bookmark);
  const availableBoards = boards.filter((board) => !excluded.has(board.id));
  await Promise.all(availableBoards.map((board) => prisma.pinterestBoard.upsert({ where: { pinterestBoardId: board.id }, create: { pinterestBoardId: board.id, name: board.name, description: board.description, privacy: board.privacy ?? 'PUBLIC', pinCount: board.pin_count, lastSyncedAt: new Date() }, update: { name: board.name, description: board.description, privacy: board.privacy ?? 'PUBLIC', pinCount: board.pin_count, lastSyncedAt: new Date() } })));
  return availableBoards.length;
}

export async function clearBoard(boardId: number) {
  const board = await prisma.pinterestBoard.findUnique({ where: { id: boardId } });
  if (!board) throw new Error('Board not found.');
  await assertPinterestBoardAvailable(board);

  let bookmark: string | null | undefined;
  const remotePinIds: string[] = [];
  do {
    const query = bookmark ? `?page_size=100&bookmark=${encodeURIComponent(bookmark)}` : '?page_size=100';
    const page = await pinterestRequest<PinterestPage<{ id: string }>>(`/boards/${encodeURIComponent(board.pinterestBoardId)}/pins${query}`);
    remotePinIds.push(...page.items.map((pin) => pin.id));
    bookmark = page.bookmark;
  } while (bookmark);

  for (const pinterestPinId of remotePinIds) {
    await pinterestRequest<void>(`/pins/${encodeURIComponent(pinterestPinId)}`, { method: 'DELETE' });
    await prisma.pinterestPin.deleteMany({ where: { pinterestPinId } });
  }

  const local = await prisma.pinterestPin.deleteMany({ where: { boardId } });
  await syncBoards();
  return { deletedFromPinterest: remotePinIds.length, deletedLocalOnly: local.count };
}
export function suggestedBoards(sectionNames: string[]) { return [...new Set(sectionNames.map((name) => name.replace(/\bWall Art\b/i, '').trim()).filter(Boolean))].sort().map((name) => ({ name: `${name} Nursery Prints`, description: `Printable ${name.toLowerCase()} wall art and coordinated nursery decor ideas.` })); }
