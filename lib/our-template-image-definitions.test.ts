import path from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), outputs: vi.fn(), deleteRoles: vi.fn(),
  read: vi.fn(), write: vi.fn(), mkdir: vi.fn(), unlink: vi.fn(), preview: vi.fn(), listings: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query, $executeRaw: mocks.execute, $transaction: mocks.transaction,
  ourCategoryImageTemplate: { deleteMany: mocks.deleteRoles }, etsyListing: { findMany: mocks.listings } } }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, writeFile: mocks.write, mkdir: mocks.mkdir, unlink: mocks.unlink, readImagePreview: mocks.preview }));
vi.mock('@/lib/our-categories', () => ({ removeOurCategoryImageTemplateOutputs: mocks.outputs }));
import { prisma } from '@/lib/prisma';
import { createOurTemplateImageDefinition, createOurTemplateImageDefinitionImage, deleteOurTemplateImageDefinition,
  deleteOurTemplateImageDefinitionImage, getOurTemplateImageDefinition, getOurTemplateImageDefinitionDeletionImpact,
  getOurTemplateImageDefinitions, updateOurTemplateImageDefinition } from '@/lib/our-template-image-definitions';
import { getOurTemplateImage, renderSavedOurTemplateImage, testOurTemplateImage, updateOurTemplateImage, type SceneReferenceRow } from '@/lib/our-template-images';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';
import type { TemplateImageDefinitionMode, TemplateImageVariantSlot } from '@/lib/our-template-image-definition-types';
const a = '10000000-0000-4000-8000-000000000001', b = '10000000-0000-4000-8000-000000000002', pair = '10000000-0000-4000-8000-000000000003';
const empty = '10000000-0000-4000-8000-000000000004';
type Parent = { id: string; name: string; mode: TemplateImageDefinitionMode; createdAt: Date; updatedAt: Date };
type Link = { definitionId: string; variantSlot: TemplateImageVariantSlot; sceneId: string };
type Scene = { id: string; name: string; originalFileName: string; imagePath: string; whiteImagePath: string | null; blackImagePath: string | null;
  definition: OurTemplateImageDefinition | string; createdAt: Date; updatedAt: Date };
let parents: Map<string, Parent>, scenes: Map<string, Scene>, links: Link[], roles: SceneReferenceRow[], files: Map<string, Buffer>;
let png: Buffer, failDelete: boolean;
function definition(orientation: 'portrait' | 'landscape' = 'portrait'): OurTemplateImageDefinition {
  return { width: 100, height: 100, lightingMode: 'opaque', openings: [{ id: 'one', name: 'One', imageItemNumber: 1, ratio: '4x5', orientation,
    placements: {}, corners: { topLeft: { x: 20, y: 10 }, topRight: { x: 80, y: 10 }, bottomRight: { x: 80, y: 90 }, bottomLeft: { x: 20, y: 90 } } }] };
}
function parent(id: string, mode: TemplateImageDefinitionMode = 'both'): Parent { return { id, name: `Definition ${id}`, mode,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }; }
function scene(id: string, configured = definition()): Scene { return { id, name: 'Room image', originalFileName: 'Original.png', imagePath: path.join('storage', id, 'original.png'),
  whiteImagePath: null, blackImagePath: null, definition: configured, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }; }
function sqlData(sql: TemplateStringsArray | { sql: string; values: unknown[] }, values: unknown[]) {
  return Array.isArray(sql) ? { text: sql.join(''), values } : { text: (sql as { sql: string }).sql, values: (sql as { values: unknown[] }).values };
}
function form(configured: OurTemplateImageDefinition, parentId?: string, variantSlot?: TemplateImageVariantSlot) {
  const body = new FormData(); body.set('name', 'Room image'); body.set('definition', JSON.stringify(configured));
  body.set('file', new File([new Uint8Array(png)], 'Original.png', { type: 'image/png' }));
  if (parentId) body.set('parentDefinitionId', parentId); if (variantSlot) body.set('variantSlot', variantSlot); return body;
}
function addUnshared() {
  const current = scene(empty); current.whiteImagePath = path.join('storage', empty, 'white.png'); current.blackImagePath = path.join('storage', empty, 'black.png');
  scenes.set(empty, current); links.push({ definitionId: empty, variantSlot: 'portrait', sceneId: empty });
  roles.push({ id: 40, categoryId: 4, ourTemplateImageId: empty, linkedSourceImageTemplateId: null, templateImageDefinitionId: empty });
  for (const filePath of [current.imagePath, current.whiteImagePath, current.blackImagePath]) { files.set(filePath, png); files.set(`preview:${filePath}`, Buffer.from(`preview ${filePath}`)); }
  return current;
}
beforeEach(async () => {
  vi.clearAllMocks(); failDelete = false;
  png = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#887766' } }).png().toBuffer();
  parents = new Map([a, b, pair, empty].map((id) => [id, parent(id)]));
  scenes = new Map([[a, scene(a)], [b, scene(b, definition('landscape'))]]);
  links = [{ definitionId: a, variantSlot: 'portrait', sceneId: a }, { definitionId: b, variantSlot: 'landscape', sceneId: b },
    { definitionId: pair, variantSlot: 'portrait', sceneId: a }, { definitionId: pair, variantSlot: 'landscape', sceneId: b }];
  roles = [{ id: 10, categoryId: 1, ourTemplateImageId: null, linkedSourceImageTemplateId: null, templateImageDefinitionId: pair },
    { id: 20, categoryId: 2, ourTemplateImageId: null, linkedSourceImageTemplateId: 10, templateImageDefinitionId: pair },
    { id: 30, categoryId: 3, ourTemplateImageId: a, linkedSourceImageTemplateId: null, templateImageDefinitionId: a }];
  files = new Map([...scenes.values()].flatMap((row) => [[row.imagePath, png] as [string, Buffer], [`preview:${row.imagePath}`, Buffer.from(`preview ${row.id}`)] as [string, Buffer]]));
  mocks.query.mockImplementation(async (sql, ...args) => {
    const { text, values } = sqlData(sql, args);
    if (text.includes('FROM our_template_image_tag_links')) return [];
    if (text.includes('FROM our_template_image_definition_images association')) return links.filter((link) => values.includes(link.sceneId)).map((link) => ({ ...link, mode: parents.get(link.definitionId)!.mode }));
    if (text.includes('FROM our_template_image_definitions')) return text.includes('WHERE id') ? [...parents.values()].filter((row) => row.id === values[0]) : [...parents.values()];
    if (text.includes('FROM our_template_image_definition_images')) {
      if (text.includes('WHERE definitionId')) return links.filter((link) => link.definitionId === values[0] && (!text.includes('AND variantSlot') || link.variantSlot === values[1]));
      if (text.includes('WHERE sceneId IN')) return links.filter((link) => values.includes(link.sceneId));
      if (text.includes('WHERE sceneId =')) return links.filter((link) => link.sceneId === values[0] && (!text.includes('definitionId <>') || link.definitionId !== values[1]));
      return links;
    }
    if (text.includes('FROM our_template_images')) return text.includes('WHERE id') ? [...scenes.values()].filter((row) => row.id === values[0]) : [...scenes.values()];
    if (text.includes('FROM our_category_image_templates')) return roles;
    throw new Error(`Unexpected query: ${text}`);
  });
  mocks.execute.mockImplementation(async (sql, ...args) => {
    const { text, values: v } = sqlData(sql, args);
    if (text.includes('INSERT INTO our_template_image_definitions')) parents.set(String(v[0]), { ...parent(String(v[0]), v[2] as TemplateImageDefinitionMode), name: String(v[1]), createdAt: v[3] as Date, updatedAt: v[4] as Date });
    else if (text.includes('INSERT INTO our_template_images')) scenes.set(String(v[0]), { id: String(v[0]), name: String(v[1]), originalFileName: String(v[2]), imagePath: String(v[3]), whiteImagePath: v[4] as string | null,
      blackImagePath: v[5] as string | null, definition: String(v[6]), createdAt: v[7] as Date, updatedAt: v[8] as Date });
    else if (text.includes('INSERT INTO our_template_image_definition_images')) {
      if (links.some((link) => link.definitionId === v[0] && link.variantSlot === v[1])) throw new Error('Duplicate slot');
      links.push({ definitionId: String(v[0]), variantSlot: v[1] as TemplateImageVariantSlot, sceneId: String(v[2]) });
    } else if (text.includes('UPDATE our_template_images SET name')) {
      const row = scenes.get(String(v[7])); if (!row || row.updatedAt.getTime() !== new Date(v[8] as Date).getTime()) return 0;
      Object.assign(row, { name: v[0], originalFileName: v[1], imagePath: v[2], whiteImagePath: v[3], blackImagePath: v[4], definition: v[5], updatedAt: v[6] });
    } else if (text.includes('UPDATE our_template_image_definitions SET name')) Object.assign(parents.get(String(v[2]))!, { name: v[0], updatedAt: v[1] });
    else if (text.includes('UPDATE our_template_image_definitions SET updatedAt')) parents.get(String(v[1]))!.updatedAt = v[0] as Date;
    else if (text.includes('DELETE FROM our_template_image_definition_images')) links = links.filter((link) => link.definitionId !== v[0] || text.includes('AND sceneId') && link.sceneId !== v[1]);
    else if (text.includes('DELETE FROM our_template_images')) { if (failDelete) throw new Error('Database deletion failed'); scenes.delete(String(v[0])); links = links.filter((link) => link.sceneId !== v[0]); }
    else if (text.includes('DELETE FROM our_template_image_definitions')) parents.delete(String(v[0]));
    else if (text.includes('SET orientationVariants')) roles.find((role) => role.id === v[1])!.orientationVariants = JSON.parse(String(v[0]));
    else if (text.includes('SET ourTemplateImageId = NULL')) { const row = roles.find((role) => role.id === v[0]); if (row && row.ourTemplateImageId === v[1]) row.ourTemplateImageId = null; }
    return 1;
  });
  mocks.transaction.mockImplementation(async (operation) => {
    const snapshot = { parents: structuredClone(parents), scenes: structuredClone(scenes), links: structuredClone(links), roles: structuredClone(roles) };
    try { return await operation(prisma); } catch (error) { ({ parents, scenes, links, roles } = snapshot); throw error; }
  });
  mocks.deleteRoles.mockImplementation(async ({ where }) => { roles = roles.filter((role) => !where.id.in.includes(role.id)); return { count: where.id.in.length }; });
  mocks.outputs.mockImplementation(async (ids, mutate) => mocks.transaction((transaction: typeof prisma) => mutate(transaction, ids)));
  mocks.listings.mockImplementation(async ({ where }) => where.ourCategoryId.in.map((id: number) => ({ id: id * 100 })));
  mocks.read.mockImplementation(async (filePath: string) => { const value = files.get(filePath); if (value) return value;
    throw Object.assign(new Error('Missing file'), { code: 'ENOENT' }); });
  mocks.write.mockImplementation(async (filePath: string, value: Buffer) => { files.set(filePath, value); files.set(`preview:${filePath}`, Buffer.from(`preview ${filePath}`)); });
  mocks.unlink.mockImplementation(async (filePath: string) => { files.delete(filePath); files.delete(`preview:${filePath}`); });
});

describe('global template image definitions', () => {
  it('creates a named empty parent without writing S3, and keeps its type immutable', async () => {
    const result = await createOurTemplateImageDefinition({ name: '  Gallery wall  ', mode: 'combined' });
    expect(result).toMatchObject({ name: 'Gallery wall', mode: 'combined', images: [] });
    expect(mocks.write).not.toHaveBeenCalled();
    expect((await updateOurTemplateImageDefinition(result.id, { name: 'Renamed gallery' })).name).toBe('Renamed gallery');
    await expect(updateOurTemplateImageDefinition(result.id, { name: 'Invalid', mode: 'both' })).rejects.toThrow(/cannot be changed/);
  });
  it('returns context-specific child metadata while canonical scene lookup remains stable', async () => {
    const result = await getOurTemplateImageDefinition(pair);
    expect(result.images.map((image) => [image.id, image.parentDefinitionId, image.variantSlot])).toEqual([[a, pair, 'portrait'], [b, pair, 'landscape']]);
    expect((await getOurTemplateImage(a)).parentDefinitionId).toBe(a);
    expect((await getOurTemplateImageDefinitions()).find((definition) => definition.id === empty)?.images).toEqual([]);
    expect(await getOurTemplateImageDefinitionDeletionImpact(pair)).toEqual({ affectedTemplateCount: 2, affectedImageTemplateCount: 2, affectedListingCount: 2 });
  });
  it('saves and renders a No areas image as the unchanged original PNG without artwork', async () => {
    parents.get(empty)!.mode = 'no-areas';
    const { image } = await createOurTemplateImageDefinitionImage(empty, form({ ...definition(), openings: [] }, empty, 'single'));
    expect(image).toMatchObject({ parentDefinitionId: empty, variantSlot: 'single', artworkItemCount: 0, artworkItems: [], openings: [] });
    expect((await renderSavedOurTemplateImage(image.id, new Map())).equals(png)).toBe(true);
    expect((await testOurTemplateImage(image.id, new FormData())).equals(png)).toBe(true);
  });
  it('rejects mismatched Both and invalid Combined images before writing any assets', async () => {
    await expect(createOurTemplateImageDefinitionImage(empty, form(definition('landscape'), empty, 'portrait'))).rejects.toThrow(/portrait orientation/);
    parents.get(empty)!.mode = 'combined';
    const mixed = definition(); mixed.openings.push({ ...mixed.openings[0], id: 'two', orientation: 'landscape' });
    await expect(createOurTemplateImageDefinitionImage(empty, form(mixed, empty, 'single'))).rejects.toThrow(/cannot be used for both/);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('persists a valid Combined image with repeated areas but only two distinct artwork items', async () => {
    parents.get(empty)!.mode = 'combined'; const mixed = definition();
    mixed.openings.push({ ...mixed.openings[0], id: 'two' }, { ...mixed.openings[0], id: 'three', orientation: 'landscape', imageItemNumber: 3 });
    const { image } = await createOurTemplateImageDefinitionImage(empty, form(mixed, empty, 'single'));
    expect(image.artworkItems).toEqual([{ imageItemNumber: 1, orientation: 'portrait' }, { imageItemNumber: 3, orientation: 'landscape' }]);
    expect(image.artworkItemCount).toBe(2);
    const body = new FormData(); body.set('artwork-1', new File([new Uint8Array(png)], 'portrait.png'));
    body.set('artwork-3', new File([new Uint8Array(png)], 'wrong-landscape.png'));
    await expect(testOurTemplateImage(image.id, body)).rejects.toThrow(/Artwork item 3/);
  });
  it('does not replace an occupied slot or leave its newly uploaded files behind', async () => {
    const previousPaths = [...files.keys()];
    await expect(createOurTemplateImageDefinitionImage(a, form(definition(), a, 'portrait'))).rejects.toThrow(/already filled/);
    expect([...files.keys()]).toEqual(previousPaths); expect(scenes.size).toBe(2); expect(links).toHaveLength(4);
  });
  it('validates all shared-definition contexts before editing a child', async () => {
    links.find((link) => link.definitionId === pair && link.sceneId === a)!.variantSlot = 'landscape';
    const body = new FormData(); body.set('name', 'Same scene'); body.set('definition', JSON.stringify(definition()));
    await expect(updateOurTemplateImage(a, body)).rejects.toThrow(/landscape orientation/);
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('detaches a shared child from one parent while retaining its assets, opposite child and parent roles', async () => {
    const paths = [...files.keys()]; await deleteOurTemplateImageDefinitionImage(pair, a);
    expect(parents.has(pair)).toBe(true); expect(scenes.has(a)).toBe(true); expect(roles.map((role) => role.id)).toEqual([10, 20, 30]);
    expect(links.filter((link) => link.definitionId === pair)).toEqual([{ definitionId: pair, variantSlot: 'landscape', sceneId: b }]);
    expect([...files.keys()]).toEqual(paths); expect(mocks.outputs).toHaveBeenCalledWith([10, 20], expect.any(Function));
  });
  it('deletes a parent and linked roles without touching children still shared by their canonical parents', async () => {
    const paths = [...files.keys()]; await deleteOurTemplateImageDefinition(pair);
    expect(parents.has(pair)).toBe(false); expect(parents.has(a)).toBe(true); expect(parents.has(b)).toBe(true);
    expect([...scenes.keys()]).toEqual([a, b]); expect(roles.map((role) => role.id)).toEqual([30]); expect([...files.keys()]).toEqual(paths);
    expect(mocks.outputs).toHaveBeenCalledWith([10, 20], expect.any(Function), { deleteRoleFiles: true });
    expect(mocks.deleteRoles.mock.calls.map(([input]) => input.where.id.in)).toEqual([[20], [10]]);
  });
  it('removes all unshared original/lighting PNGs and previews when detaching the final child, keeping its empty parent and roles', async () => {
    const current = addUnshared(); await deleteOurTemplateImageDefinitionImage(empty, empty);
    expect(parents.has(empty)).toBe(true); expect(scenes.has(empty)).toBe(false); expect(roles.some((role) => role.id === 40)).toBe(true);
    expect((await getOurTemplateImageDefinition(empty)).images).toEqual([]);
    for (const filePath of [current.imagePath, current.whiteImagePath!, current.blackImagePath!]) { expect(files.has(filePath)).toBe(false); expect(files.has(`preview:${filePath}`)).toBe(false); }
    expect(files.has(scenes.get(a)!.imagePath)).toBe(true);
  });
  it('restores source PNGs/previews and leaves the definition retryable if source cleanup fails', async () => {
    const current = addUnshared(); const unlink = mocks.unlink.getMockImplementation()!;
    mocks.unlink.mockImplementation(async (filePath: string) => {
      if (filePath === current.whiteImagePath) throw new Error('S3 removal failed');
      return unlink(filePath);
    });
    await expect(deleteOurTemplateImageDefinitionImage(empty, empty)).rejects.toThrow('S3 removal failed');
    expect(parents.has(empty)).toBe(true); expect(scenes.has(empty)).toBe(true); expect(links.some((link) => link.definitionId === empty)).toBe(true);
    for (const filePath of [current.imagePath, current.whiteImagePath!, current.blackImagePath!]) { expect(files.get(filePath)?.equals(png)).toBe(true); expect(files.has(`preview:${filePath}`)).toBe(true); }
    mocks.unlink.mockImplementation(unlink); await deleteOurTemplateImageDefinitionImage(empty, empty); expect(scenes.has(empty)).toBe(false);
  });
  it('restores all unshared assets and relational references if the atomic database mutation fails', async () => {
    const current = addUnshared(); failDelete = true;
    await expect(deleteOurTemplateImageDefinition(empty)).rejects.toThrow('Database deletion failed');
    expect(parents.has(empty)).toBe(true); expect(scenes.has(empty)).toBe(true); expect(roles.some((role) => role.id === 40)).toBe(true);
    expect(links.some((link) => link.sceneId === empty)).toBe(true);
    for (const filePath of [current.imagePath, current.whiteImagePath!, current.blackImagePath!]) { expect(files.get(filePath)?.equals(png)).toBe(true); expect(files.has(`preview:${filePath}`)).toBe(true); }
  });
  it('retains unshared source assets used by an outside legacy direct reference when deleting their canonical parent', async () => {
    const current = addUnshared(); roles.push({ id: 90, categoryId: 9, ourTemplateImageId: empty, linkedSourceImageTemplateId: null, templateImageDefinitionId: null });
    await deleteOurTemplateImageDefinition(empty);
    expect(parents.has(empty)).toBe(false); expect(scenes.has(empty)).toBe(true);
    expect(roles.find((role) => role.id === 90)?.ourTemplateImageId).toBe(empty); expect(roles.some((role) => role.id === 40)).toBe(false);
    for (const filePath of [current.imagePath, current.whiteImagePath!, current.blackImagePath!]) { expect(files.get(filePath)?.equals(png)).toBe(true); expect(files.has(`preview:${filePath}`)).toBe(true); }
    expect((await renderSavedOurTemplateImage(empty, new Map([[1, { contents: png }]]))).length).toBeGreaterThan(0);
  });
  it('keeps a legacy JSON-slot reference and its assets working when its final definition association is detached', async () => {
    const current = addUnshared(), variants = { portrait: { ourTemplateImageId: empty }, landscape: { ourTemplateImageId: b } };
    roles.push({ id: 90, categoryId: 9, ourTemplateImageId: null, orientationVariants: variants, linkedSourceImageTemplateId: null });
    await deleteOurTemplateImageDefinitionImage(empty, empty);
    expect(scenes.has(empty)).toBe(true); expect(parents.has(empty)).toBe(true); expect((await getOurTemplateImageDefinition(empty)).images).toEqual([]);
    expect(roles.find((role) => role.id === 90)?.orientationVariants).toEqual(variants); expect(files.has(current.imagePath)).toBe(true);
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it('ignores stale old direct and slot columns when another definition is authoritative', async () => {
    const current = addUnshared(); roles.push({ id: 90, categoryId: 9, templateImageDefinitionId: a, ourTemplateImageId: empty,
      orientationVariants: { portrait: { ourTemplateImageId: empty } }, linkedSourceImageTemplateId: null });
    await deleteOurTemplateImageDefinition(empty);
    expect(scenes.has(empty)).toBe(false); expect(files.has(current.imagePath)).toBe(false);
    expect(roles.find((role) => role.id === 90)?.templateImageDefinitionId).toBe(a); expect(scenes.has(a)).toBe(true);
  });
  it.each(['direct', 'slot'] as const)('aborts and restores files if a concurrent legacy %s reference appears after the storage snapshot', async (mode) => {
    const current = addUnshared();
    mocks.outputs.mockImplementationOnce(async (ids, mutate) => {
      roles.push({ id: 90, categoryId: 9, ourTemplateImageId: mode === 'direct' ? empty : null,
        orientationVariants: mode === 'slot' ? { portrait: { ourTemplateImageId: empty } } : null, linkedSourceImageTemplateId: null });
      return mocks.transaction((transaction: typeof prisma) => mutate(transaction, ids));
    });
    await expect(deleteOurTemplateImageDefinition(empty)).rejects.toThrow('linked to another template while deleting');
    expect(parents.has(empty)).toBe(true); expect(scenes.has(empty)).toBe(true); expect(links.some((link) => link.sceneId === empty)).toBe(true);
    expect(roles.some((role) => role.id === 90)).toBe(true); expect(roles.some((role) => role.id === 40)).toBe(true);
    for (const filePath of [current.imagePath, current.whiteImagePath!, current.blackImagePath!]) { expect(files.get(filePath)?.equals(png)).toBe(true); expect(files.has(`preview:${filePath}`)).toBe(true); }
    expect(mocks.query.mock.calls.some(([sql]) => sqlData(sql, []).text.includes('templateImageDefinitionId IS NULL') && sqlData(sql, []).text.includes('FOR UPDATE'))).toBe(true);
  });
  it('advances child and parent CAS versions even when consecutive saves happen in the same millisecond', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00.000Z'));
    try {
      const first = new FormData(); first.set('name', 'First rename'); await updateOurTemplateImage(a, first);
      expect(scenes.get(a)!.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.001Z');
      const second = new FormData(); second.set('name', 'Second rename'); await updateOurTemplateImage(a, second);
      expect(scenes.get(a)!.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.002Z');
      await updateOurTemplateImageDefinition(empty, { name: 'First parent name' }); await updateOurTemplateImageDefinition(empty, { name: 'Second parent name' });
      expect(parents.get(empty)!.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.002Z');
    } finally { clock.mockRestore(); }
  });
  it('reports a committed parent creation clearly if reloading its details fails', async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql, ...values) => {
      if (sqlData(sql, values).text.includes('FROM our_template_image_definitions')) throw new Error('Hydration unavailable');
      return query(sql, ...values);
    });
    await expect(createOurTemplateImageDefinition({ name: 'Committed parent', mode: 'both' })).rejects.toThrow('definition was created');
    expect([...parents.values()].some((row) => row.name === 'Committed parent')).toBe(true); expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it('preserves committed child files and gives reload guidance if only the refreshed parent DTO fails', async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql, ...values) => {
      if (scenes.size > 2 && sqlData(sql, values).text.includes('FROM our_template_image_definitions')) throw new Error('Hydration unavailable');
      return query(sql, ...values);
    });
    await expect(createOurTemplateImageDefinitionImage(empty, form(definition(), empty, 'portrait'))).rejects.toThrow('template image was saved');
    const committed = [...scenes.values()].find((row) => row.id !== a && row.id !== b)!;
    expect(committed).toBeDefined(); expect(files.has(committed.imagePath)).toBe(true);
    expect(links.some((link) => link.sceneId === committed.id && link.definitionId === empty)).toBe(true); expect(mocks.unlink).not.toHaveBeenCalled();
  });
});
