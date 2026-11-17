export function publicationKey(listingId: number, imageId: number | null, boardId: number, scheduledAt?: Date | null) {
  return [listingId, imageId ?? 'cover', boardId, scheduledAt?.toISOString() ?? 'draft'].join(':');
}
export function spreadSchedule(start: Date, count: number, pinsPerDay: number) {
  const slots = [9, 13, 18, 21];
  return Array.from({ length: count }, (_, index) => { const day = Math.floor(index / pinsPerDay); const date = new Date(start); date.setDate(date.getDate() + day); date.setHours(slots[index % Math.min(pinsPerDay, slots.length)] ?? 12, 0, 0, 0); return date; });
}
