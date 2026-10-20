export function validateOurCategoryTemplateOrder(value: unknown, existingIds: number[]) {
  if (!Array.isArray(value)) throw new Error('The image-template order is missing.');
  const requestedIds = value.map((item) => {
    const id = typeof item === 'string' && /^\d+$/.test(item) ? Number(item) : item;
    if (!Number.isSafeInteger(id) || (id as number) <= 0) throw new Error('The image-template order contains an invalid template id.');
    return id as number;
  });
  if (requestedIds.length !== existingIds.length || new Set(requestedIds).size !== requestedIds.length) {
    throw new Error('The image-template order must contain every template exactly once.');
  }
  const existing = new Set(existingIds);
  if (requestedIds.some((id) => !existing.has(id))) {
    throw new Error('The image-template order contains a template from another category.');
  }
  return requestedIds;
}
