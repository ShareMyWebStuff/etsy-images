import { prisma } from '@/lib/prisma';
import { pinterestRequest } from './client';
import type { PinterestBoardApi, PinterestPage } from './types';

export async function syncBoards() {
  let bookmark: string | null | undefined; const boards: PinterestBoardApi[] = [];
  do { const query = bookmark ? `?page_size=100&bookmark=${encodeURIComponent(bookmark)}` : '?page_size=100'; const page = await pinterestRequest<PinterestPage<PinterestBoardApi>>(`/boards${query}`); boards.push(...page.items); bookmark = page.bookmark; } while (bookmark);
  await Promise.all(boards.map((board) => prisma.pinterestBoard.upsert({ where: { pinterestBoardId: board.id }, create: { pinterestBoardId: board.id, name: board.name, description: board.description, privacy: board.privacy ?? 'PUBLIC', pinCount: board.pin_count, lastSyncedAt: new Date() }, update: { name: board.name, description: board.description, privacy: board.privacy ?? 'PUBLIC', pinCount: board.pin_count, lastSyncedAt: new Date() } })));
  return boards.length;
}

export async function clearBoard(boardId: number) {
  const board = await prisma.pinterestBoard.findUnique({ where: { id: boardId } });
  if (!board) throw new Error('Board not found.');

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
