import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), listings: vi.fn(),
  read: vi.fn(), write: vi.fn(), mkdir: vi.fn(), unlink: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: db.query, $executeRaw: db.execute, $transaction: db.transaction,
  etsyListing: { findMany: db.listings } } }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: db.read, writeFile: db.write, mkdir: db.mkdir, unlink: db.unlink }));

import { createOurTemplateImage, getOurTemplateImage, getOurTemplateImages, testOurTemplateImage, updateOurTemplateImage } from '@/lib/our-template-images';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';

const sceneId = '10000000-0000-4000-8000-000000000001';
const tagId = (number: number) => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const configured = (): OurTemplateImageDefinition => ({ width: 100, height: 100, lightingMode: 'opaque', openings: [{
  id: 'opening', name: 'Frame', imageItemNumber: 1, ratio: 'iso-a1', orientation: 'portrait', placements: {},
  corners: { topLeft: { x: 20, y: 10 }, topRight: { x: 70, y: 15 }, bottomRight: { x: 75, y: 90 }, bottomLeft: { x: 25, y: 85 } },
}], foregroundMask: { version: 1, strokes: [{ mode: 'paint', size: 8, softness: 0.5, points: [{ x: 45, y: 45 }] }] } });
type Scene = { id: string; name: string; originalFileName: string; imagePath: string; whiteImagePath: string | null;
  blackImagePath: string | null; definition: OurTemplateImageDefinition; createdAt: Date; updatedAt: Date };
let scenes: Map<string, Scene>;
let assigned: Map<string, string[]>;
let catalogue: Array<{ id: string; name: string }>;
let png: Buffer;
let files: Map<string, Buffer>;
function statement(sql: TemplateStringsArray | { sql: string }) { return Array.isArray(sql) ? sql.join('') : (sql as { sql: string }).sql; }

beforeEach(async () => {
  vi.clearAllMocks();
  png = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ddddcc' } }).png().toBuffer();
  files = new Map([['scene.png', png]]);
  scenes = new Map([[sceneId, { id: sceneId, name: 'Room', originalFileName: 'Canva.png', imagePath: 'scene.png',
    whiteImagePath: null, blackImagePath: null, definition: configured(), createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }]]);
  assigned = new Map([[sceneId, [tagId(1), tagId(2)]]]);
  catalogue = Array.from({ length: 11 }, (_, i) => ({ id: tagId(i + 1), name: `Tag ${String(i + 1).padStart(2, '0')}` }));
  db.read.mockImplementation(async (filePath: string) => {
    const contents = files.get(filePath); if (!contents) throw new Error(`Missing scene file: ${filePath}`);
    return contents;
  });
  db.write.mockImplementation(async (filePath: string, contents: Buffer) => { files.set(filePath, contents); });
  db.unlink.mockImplementation(async (filePath: string) => { files.delete(filePath); });
  db.listings.mockResolvedValue([]);
  db.query.mockImplementation(async (sql, ...values) => {
    const text = statement(sql); const params = Array.isArray(sql) ? values : sql.values as string[];
    if (text.includes('FROM our_template_image_tag_links')) return params.flatMap((id: string) => (assigned.get(id) ?? []).map((tag) => ({
      templateImageId: id, ...catalogue.find(({ id }) => id === tag)!,
    })));
    if (text.includes('FROM our_template_image_tags')) return catalogue.filter(({ id }) => params.includes(id));
    if (text.includes('FROM our_template_images')) return structuredClone(text.includes('WHERE id') ? [scenes.get(params[0])].filter(Boolean) : [...scenes.values()]);
    if (text.includes('FROM our_template_image_definition_images')) return [];
    if (text.includes('FROM our_category_image_templates')) return [];
    throw new Error(`Unexpected tag persistence query: ${text}`);
  });
  db.execute.mockImplementation(async (sql, ...values) => {
    const text = statement(sql); const params = Array.isArray(sql) ? values : sql.values;
    if (text.includes('INSERT INTO our_template_images')) {
      const [id, name, originalFileName, imagePath, whiteImagePath, blackImagePath, definition, createdAt, updatedAt] = params;
      scenes.set(id, { id, name, originalFileName, imagePath, whiteImagePath, blackImagePath, definition: JSON.parse(definition), createdAt, updatedAt });
    } else if (text.includes('UPDATE our_template_images')) {
      const [name, originalFileName, imagePath, whiteImagePath, blackImagePath, definition, updatedAt, id] = params;
      Object.assign(scenes.get(id)!, { name, originalFileName, imagePath, whiteImagePath, blackImagePath, definition: JSON.parse(definition), updatedAt });
    } else if (text.includes('DELETE FROM our_template_image_tag_links')) assigned.set(params[0], []);
    else if (text.includes('INSERT INTO our_template_image_tag_links')) {
      for (let index = 0; index < params.length; index += 2) assigned.set(params[index], [...(assigned.get(params[index]) ?? []), params[index + 1]]);
    } else if (!text.includes('our_template_image_definitions') && !text.includes('our_template_image_definition_images')) throw new Error(`Unexpected tag persistence write: ${text}`);
    return 1;
  });
  db.transaction.mockImplementation(async (operation) => {
    const beforeScenes = structuredClone(scenes); const beforeAssigned = structuredClone(assigned);
    try { return await operation({ $executeRaw: db.execute }); }
    catch (error) { scenes = beforeScenes; assigned = beforeAssigned; throw error; }
  });
});

describe('template image tag assignment persistence', () => {
  function failTagHydration() {
    const query = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql, ...values) => {
      if (statement(sql).includes('FROM our_template_image_tag_links')) throw new Error('Tag hydration unavailable');
      return query(sql, ...values);
    });
  }

  it('preserves a newly committed scene and its file when post-commit tag hydration fails', async () => {
    failTagHydration();
    const body = new FormData(); body.set('name', 'New nursery'); body.set('definition', JSON.stringify(configured()));
    body.set('file', new File([new Uint8Array(png)], 'Canva.png', { type: 'image/png' }));
    body.set('tagIds', JSON.stringify([tagId(3)]));
    await expect(createOurTemplateImage(body)).rejects.toThrow('Tag hydration unavailable');
    const committed = [...scenes.values()].find(({ id }) => id !== sceneId)!;
    expect(committed).toBeDefined(); expect(assigned.get(committed.id)).toEqual([tagId(3)]);
    expect(files.has(committed.imagePath)).toBe(true);
    expect(db.unlink).not.toHaveBeenCalled();
  });

  it('preserves the committed replacement file when reloading its scene tags fails', async () => {
    failTagHydration();
    const body = new FormData(); body.set('file', new File([new Uint8Array(png)], 'Replacement.png', { type: 'image/png' }));
    await expect(updateOurTemplateImage(sceneId, body)).rejects.toThrow('Tag hydration unavailable');
    const committed = scenes.get(sceneId)!;
    expect(committed.imagePath).not.toBe('scene.png'); expect(committed.originalFileName).toBe('Replacement.png');
    expect(files.has(committed.imagePath)).toBe(true); expect(files.has('scene.png')).toBe(false);
    expect(db.unlink).toHaveBeenCalledExactlyOnceWith('scene.png');
  });

  it('rolls back the scene and removes staged files when tag persistence fails before commit', async () => {
    const execute = db.execute.getMockImplementation()!;
    db.execute.mockImplementation(async (sql, ...values) => {
      if (statement(sql).includes('INSERT INTO our_template_image_tag_links')) throw new Error('Tag link write failed');
      return execute(sql, ...values);
    });
    const body = new FormData(); body.set('name', 'Failed nursery'); body.set('definition', JSON.stringify(configured()));
    body.set('file', new File([new Uint8Array(png)], 'Canva.png', { type: 'image/png' }));
    body.set('tagIds', JSON.stringify([tagId(3)]));
    await expect(createOurTemplateImage(body)).rejects.toThrow('Tag link write failed');
    expect([...scenes.keys()]).toEqual([sceneId]); expect([...files.keys()]).toEqual(['scene.png']);
    expect(db.unlink).toHaveBeenCalledExactlyOnceWith(db.write.mock.calls[0][0]);
    expect(assigned.get(sceneId)).toEqual([tagId(1), tagId(2)]);
  });

  it('keeps the previous image and tags while removing a replacement that fails before commit', async () => {
    const execute = db.execute.getMockImplementation()!;
    db.execute.mockImplementation(async (sql, ...values) => {
      if (statement(sql).includes('INSERT INTO our_template_image_tag_links')) throw new Error('Tag link write failed');
      return execute(sql, ...values);
    });
    const body = new FormData(); body.set('tagIds', JSON.stringify([tagId(3)]));
    body.set('file', new File([new Uint8Array(png)], 'Replacement.png', { type: 'image/png' }));
    await expect(updateOurTemplateImage(sceneId, body)).rejects.toThrow('Tag link write failed');
    expect(scenes.get(sceneId)!.imagePath).toBe('scene.png'); expect([...files.keys()]).toEqual(['scene.png']);
    expect(db.unlink).toHaveBeenCalledExactlyOnceWith(db.write.mock.calls[0][0]);
    expect(assigned.get(sceneId)).toEqual([tagId(1), tagId(2)]);
  });

  it('returns catalogue tags with a saved scene and batches tags for the newest-first scene list', async () => {
    expect((await getOurTemplateImage(sceneId)).tags).toEqual(catalogue.slice(0, 2));
    db.query.mockClear();
    expect((await getOurTemplateImages())[0].tags).toEqual(catalogue.slice(0, 2));
    expect(db.query).toHaveBeenCalledTimes(3);
    expect(db.query.mock.calls.filter(([sql]) => statement(sql).includes('FROM our_template_image_tag_links'))).toHaveLength(1);
    expect(db.query.mock.calls.filter(([sql]) => statement(sql).includes('FROM our_template_image_definition_images'))).toHaveLength(1);
    expect(statement(db.query.mock.calls[0][0])).toContain('ORDER BY createdAt DESC, id DESC');
  });

  it('creates a scene and its tags in the same transaction and returns them on reopen', async () => {
    const body = new FormData(); body.set('name', 'Tagged nursery'); body.set('definition', JSON.stringify(configured()));
    body.set('file', new File([new Uint8Array(png)], 'Canva.png', { type: 'image/png' }));
    body.set('tagIds', JSON.stringify([tagId(3), tagId(5)]));
    const created = await createOurTemplateImage(body);
    expect(created.tags).toEqual([catalogue[2], catalogue[4]]);
    expect((await getOurTemplateImage(created.id)).tags).toEqual(created.tags);
    expect(created.foregroundMask).toEqual(configured().foregroundMask);
    expect(db.transaction).toHaveBeenCalledTimes(1); expect(db.write).toHaveBeenCalledTimes(1);
  });

  it('changes only tags without flagging local generation or Etsy sync, and preserves original dimensions, mask and file', async () => {
    const previous = structuredClone(scenes.get(sceneId)!);
    const body = new FormData(); body.set('tagIds', JSON.stringify([tagId(4), tagId(6)]));
    const updated = await updateOurTemplateImage(sceneId, body);
    expect(updated.tags).toEqual([catalogue[3], catalogue[5]]);
    expect(updated.foregroundMask).toEqual(previous.definition.foregroundMask);
    expect(updated.width).toBe(100); expect(updated.height).toBe(100);
    expect(updated.openings[0].corners).toEqual(previous.definition.openings[0].corners);
    expect(scenes.get(sceneId)!.imagePath).toBe(previous.imagePath);
    expect(scenes.get(sceneId)!.createdAt).toEqual(previous.createdAt);
    expect(db.listings).not.toHaveBeenCalled(); expect(db.write).not.toHaveBeenCalled(); expect(db.unlink).not.toHaveBeenCalled();
    expect(db.execute.mock.calls.map(([sql]) => statement(sql)).join('\n')).not.toMatch(/listingImagesRevision|imagesChanged|lastLocalChangeAt/);
  });

  it('preserves assigned tags when PATCH omits tagIds and clears them when the array is explicitly empty', async () => {
    const rename = new FormData(); rename.set('name', 'Renamed room');
    expect((await updateOurTemplateImage(sceneId, rename)).tags).toEqual(catalogue.slice(0, 2));
    expect(db.execute.mock.calls.some(([sql]) => statement(sql).includes('our_template_image_tag_links'))).toBe(false);
    const clear = new FormData(); clear.set('tagIds', '[]');
    expect((await updateOurTemplateImage(sceneId, clear)).tags).toEqual([]);
    expect(db.listings).not.toHaveBeenCalled();
  });

  it('rejects eleven tags or an unknown catalogue tag before changing the scene or tag links', async () => {
    const before = structuredClone(assigned);
    const tooMany = new FormData(); tooMany.set('tagIds', JSON.stringify(catalogue.map(({ id }) => id)));
    await expect(updateOurTemplateImage(sceneId, tooMany)).rejects.toThrow('no more than 10');
    const unknown = new FormData(); unknown.set('tagIds', JSON.stringify([tagId(999)]));
    await expect(updateOurTemplateImage(sceneId, unknown)).rejects.toThrow('no longer exists');
    expect(assigned).toEqual(before); expect(db.execute).not.toHaveBeenCalled(); expect(db.write).not.toHaveBeenCalled();
  });

  it('produces identical full-resolution Test output before and after a tag-only edit', async () => {
    const artwork = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#ee2200' } }).png().toBuffer();
    const body = new FormData(); body.set('artwork-1', new File([new Uint8Array(artwork)], 'sample.png', { type: 'image/png' }));
    const before = await testOurTemplateImage(sceneId, body);
    const tags = new FormData(); tags.set('tagIds', JSON.stringify([tagId(10)]));
    await updateOurTemplateImage(sceneId, tags);
    expect((await testOurTemplateImage(sceneId, body)).equals(before)).toBe(true);
  });
});
