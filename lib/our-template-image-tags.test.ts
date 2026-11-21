import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query, $executeRaw: mocks.execute } }));

import { assertTemplateImageTagsExist, createTemplateImageTag, getTagsForTemplateImages, getTemplateImageTags,
  normalizeTemplateImageTagName, saveTemplateImageTagIds, templateImageTagIdsFromForm } from '@/lib/our-template-image-tags';

const first = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const sceneId = '10000000-0000-4000-8000-000000000001';
beforeEach(() => vi.resetAllMocks());

describe('template image tag catalogue and selection', () => {
  it('normalizes whitespace and uses a case-insensitive key while preserving the entered display name', () => {
    expect(normalizeTemplateImageTagName('  Living\t Room \n')).toEqual({ name: 'Living Room', normalizedName: 'living room' });
    expect(normalizeTemplateImageTagName('LIVING ROOM').normalizedName).toBe('living room');
  });
  it.each([undefined, null, 42, '', ' \t ', 'a'.repeat(101)])('rejects an invalid tag name: %s', async (name) => {
    await expect(createTemplateImageTag(name)).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('returns the existing tag for differently cased or spaced duplicate additions using an atomic unique-name upsert', async () => {
    mocks.query.mockResolvedValue([{ id: first, name: 'Living Room' }]);
    expect(await createTemplateImageTag(' Living  Room ')).toEqual({ id: first, name: 'Living Room' });
    expect(await createTemplateImageTag('LIVING\tROOM')).toEqual({ id: first, name: 'Living Room' });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    for (const call of mocks.execute.mock.calls) {
      expect(call[0].join('')).toContain('ON DUPLICATE KEY UPDATE');
      expect(call[3]).toBe('living room');
    }
  });
  it('lists catalogue tags alphabetically with a stable id tie-breaker', async () => {
    mocks.query.mockResolvedValue([{ id: first, name: 'Nursery' }]);
    expect(await getTemplateImageTags()).toEqual([{ id: first, name: 'Nursery' }]);
    expect(mocks.query.mock.calls[0][0].join('')).toContain('ORDER BY name ASC, id ASC');
  });
  it('distinguishes an omitted selection from an explicit clear and accepts ten unique tags', () => {
    expect(templateImageTagIdsFromForm(new FormData())).toBeUndefined();
    const body = new FormData(); body.set('tagIds', '[]'); expect(templateImageTagIdsFromForm(body)).toEqual([]);
    const ids = Array.from({ length: 10 }, (_, i) => `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    body.set('tagIds', JSON.stringify(ids)); expect(templateImageTagIdsFromForm(body)).toEqual(ids);
  });
  it.each(['not json', '{}', '[null]', '["bad-id"]', JSON.stringify([first, first]),
    JSON.stringify(Array.from({ length: 11 }, (_, i) => `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)),
  ])('rejects malformed, duplicate or excessive tag selections', (value) => {
    const body = new FormData(); body.set('tagIds', value);
    expect(() => templateImageTagIdsFromForm(body)).toThrow();
  });
  it('rejects references to missing catalogue tags', async () => {
    mocks.query.mockResolvedValue([{ id: first }]);
    await expect(assertTemplateImageTagsExist([first, second])).rejects.toThrow('no longer exists');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('loads scene tags in one joined query and retains empty arrays for untagged scenes', async () => {
    mocks.query.mockResolvedValue([{ templateImageId: sceneId, id: first, name: 'Nursery' }]);
    const other = '10000000-0000-4000-8000-000000000002';
    const grouped = await getTagsForTemplateImages([sceneId, other]);
    expect(grouped.get(sceneId)).toEqual([{ id: first, name: 'Nursery' }]); expect(grouped.get(other)).toEqual([]);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0].values).toEqual([sceneId, other]);
  });
  it('replaces only the selected scene tag links through the supplied transaction', async () => {
    const execute = vi.fn();
    await saveTemplateImageTagIds({ $executeRaw: execute }, sceneId, [first, second]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toBe(sceneId);
    expect(execute.mock.calls[1][0].values).toEqual([sceneId, first, sceneId, second]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
