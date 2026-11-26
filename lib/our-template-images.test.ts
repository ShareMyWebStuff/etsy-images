import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), listings: vi.fn(),
  read: vi.fn(), preview: vi.fn(), write: vi.fn(), mkdir: vi.fn(), unlink: vi.fn(), deleteTemplate: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query, $executeRaw: mocks.execute,
  $transaction: mocks.transaction, etsyListing: { findMany: mocks.listings } } }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, readImagePreview: mocks.preview, writeFile: mocks.write, mkdir: mocks.mkdir, unlink: mocks.unlink }));
vi.mock('@/lib/our-categories', () => ({ deleteOurCategoryImageTemplate: mocks.deleteTemplate }));

import { createOurTemplateImage, deleteOurTemplateImage, dependentSceneReferences, getOurTemplateImage, getOurTemplateImageDeletionImpact,
  getOurTemplateImageFile, getOurTemplateImages, testOurTemplateImage, updateOurTemplateImage, type SceneReferenceRow } from '@/lib/our-template-images';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';

const id = '10000000-0000-4000-8000-000000000001';
const configured = (): OurTemplateImageDefinition => ({ width: 100, height: 100, lightingMode: 'opaque', openings: [{
  id: 'first', name: 'First frame', imageItemNumber: 1, ratio: 'iso-a1', orientation: 'portrait', placements: {},
  corners: { topLeft: { x: 20, y: 10 }, topRight: { x: 70, y: 15 }, bottomRight: { x: 75, y: 90 }, bottomLeft: { x: 25, y: 85 } },
}] });
let scene: { id: string; name: string; originalFileName: string; imagePath: string; whiteImagePath: null; blackImagePath: null;
  definition: OurTemplateImageDefinition; createdAt: Date; updatedAt: Date };
let references: SceneReferenceRow[];
function statement(sql: TemplateStringsArray | { sql?: string }) { return Array.isArray(sql) ? sql.join('') : (sql as { sql?: string }).sql ?? ''; }
function form(next = configured()) { const body = new FormData(); body.set('name', 'Room scene'); body.set('definition', JSON.stringify(next)); return body; }

beforeEach(async () => {
  vi.clearAllMocks();
  scene = { id, name: 'Room scene', originalFileName: 'Canva.png', imagePath: 'D:/Etsy/EtsyListings/scene.png',
    whiteImagePath: null, blackImagePath: null, definition: configured(), createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') };
  references = [
    { id: 10, categoryId: 1, ourTemplateImageId: id, linkedSourceImageTemplateId: null },
    { id: 20, categoryId: 2, ourTemplateImageId: null, linkedSourceImageTemplateId: 10 },
    { id: 30, categoryId: 3, ourTemplateImageId: null, linkedSourceImageTemplateId: 20 },
    { id: 40, categoryId: 4, ourTemplateImageId: 'another-scene', linkedSourceImageTemplateId: null },
  ];
  mocks.read.mockResolvedValue(await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ffffff' } }).png().toBuffer());
  mocks.query.mockImplementation(async (sql) => statement(sql).includes('FROM our_template_image_tag_links') ? []
    : statement(sql).includes('FROM our_template_images') ? [scene] : references);
  mocks.listings.mockResolvedValue([{ id: 101 }, { id: 202 }, { id: 303 }]);
  mocks.transaction.mockImplementation(async (operation) => operation({ $executeRaw: mocks.execute }));
  mocks.execute.mockResolvedValue(1);
});

describe('saved template image browsing files', () => {
  it('returns the unchanged full PNG by default', async () => {
    const original = await mocks.read(scene.imagePath); mocks.read.mockClear();
    const storedDefinition = structuredClone(scene.definition);
    expect(await getOurTemplateImageFile(id)).toBe(original);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(scene.imagePath);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(scene.definition).toEqual(storedDefinition);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('reads the existing lightweight storage preview without changing source dimensions or openings', async () => {
    const preview = Buffer.from('stored small WebP'); mocks.preview.mockResolvedValue(preview);
    const storedDefinition = structuredClone(scene.definition);
    expect(await getOurTemplateImageFile(id, true)).toBe(preview);
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(scene.imagePath);
    expect(mocks.read).not.toHaveBeenCalled();
    expect((await getOurTemplateImage(id)).openings).toEqual(storedDefinition.openings);
    expect(scene.definition).toEqual(storedDefinition);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('keeps Test rendering on the full original after a lightweight browsing request', async () => {
    mocks.preview.mockResolvedValue(Buffer.from('stored small WebP'));
    await getOurTemplateImageFile(id, true);
    const artwork = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#ee2200' } }).png().toBuffer();
    const body = new FormData(); body.set('artwork-1', new File([new Uint8Array(artwork)], 'sample.png', { type: 'image/png' }));
    const result = await testOurTemplateImage(id, body);
    expect((await sharp(result).metadata()).width).toBe(scene.definition.width);
    expect((await sharp(result).metadata()).height).toBe(scene.definition.height);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(scene.imagePath);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe('Keep in front scene mask storage', () => {
  function maskedDefinition(): OurTemplateImageDefinition {
    return { ...configured(), foregroundMask: { version: 1, strokes: [
      { mode: 'paint', size: 24, softness: 0.35, points: [{ x: 35, y: 40 }, { x: 44, y: 45 }, { x: 50, y: 50 }] },
      { mode: 'erase', size: 8, softness: 0.6, points: [{ x: 44, y: 45 }, { x: 46, y: 47 }] },
      { mode: 'paint', size: 12, softness: 0, points: [{ x: 60, y: 65 }] },
    ] } };
  }
  function persistUpdates() {
    mocks.execute.mockImplementation(async (sql, ...values) => {
      if (statement(sql).includes('UPDATE our_template_images')) {
        scene.name = values[0]; scene.definition = JSON.parse(values[5]);
      }
      return 1;
    });
  }

  function smartDefinition(): OurTemplateImageDefinition {
    return { ...configured(), foregroundMask: { version: 1, strokes: [
      { mode: 'paint', size: 1, softness: 0, points: [], region: { width: 25, height: 25, runs: [
        [137, 2, 200], [162, 2, 255], [187, 2, 255],
        ...Array.from({ length: 10 }, (_, index): [number, number, number] => [(index + 8) * 25 + 8, 6, 255]),
      ] } },
      { mode: 'erase', size: 6, softness: 0.2, points: [{ x: 44, y: 44 }, { x: 45, y: 45 }] },
    ] } };
  }

  it('restores a compact smart selection and its later eraser correction after saving and reopening', async () => {
    persistUpdates();
    const next = smartDefinition();
    const saved = await updateOurTemplateImage(id, form(next));
    const reopened = await getOurTemplateImage(id);
    expect(saved.foregroundMask).toEqual(next.foregroundMask);
    expect(reopened.foregroundMask).toEqual(next.foregroundMask);
    const fitted = { ...reopened, openings: reopened.openings.map((opening) => ({ ...opening, ratio: '4x5' as const })) };
    await updateOurTemplateImage(id, form(fitted));
    expect((await getOurTemplateImage(id)).foregroundMask).toEqual(next.foregroundMask);
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('retains a smart selection when creating a scene without storing separate mask assets', async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ffffff' } }).png().toBuffer();
    mocks.execute.mockImplementation(async (sql, ...values) => {
      if (statement(sql).includes('INSERT INTO our_template_images')) {
        scene.id = values[0]; scene.name = values[1]; scene.definition = JSON.parse(values[6]);
      }
      return 1;
    });
    const next = smartDefinition(); const body = form(next);
    body.set('file', new File([new Uint8Array(png)], 'smart-room.png', { type: 'image/png' }));
    expect((await createOurTemplateImage(body)).foregroundMask).toEqual(next.foregroundMask);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it('invalidates the affected followers for a smart-selection change while leaving a rename clean', async () => {
    persistUpdates(); scene.definition = smartDefinition();
    const next = smartDefinition(); next.foregroundMask!.strokes[0].region!.runs[0][2] = 120;
    await updateOurTemplateImage(id, form(next));
    const updates = mocks.execute.mock.calls.filter(([sql]) => statement(sql).includes('listingImagesRevision'));
    expect(updates).toHaveLength(1); expect(updates[0][0].values).toEqual([101, 202, 303]);
    mocks.execute.mockClear(); mocks.listings.mockClear();
    const rename = new FormData(); rename.set('name', 'Smart nursery');
    const renamed = await updateOurTemplateImage(id, rename);
    expect(renamed.foregroundMask).toEqual(next.foregroundMask);
    expect(mocks.listings).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.map(([sql]) => statement(sql)).join('\n')).not.toMatch(/listingImagesRevision|imagesChanged|lastLocalChangeAt/);
  });

  it.each([
    { width: 0, height: 25, runs: [] },
    { width: 1537, height: 1, runs: [[0, 1, 255]] },
    { width: 25.5, height: 25, runs: [[0, 1, 255]] },
    { width: 25, height: 10, runs: [[0, 1, 255]] },
    { width: 25, height: 25, runs: [[-1, 1, 255]] },
    { width: 25, height: 25, runs: [[0.5, 1, 255]] },
    { width: 25, height: 25, runs: [[0, 0, 255]] },
    { width: 25, height: 25, runs: [[0, 1, 256]] },
    { width: 25, height: 25, runs: [[0, 1, 0]] },
    { width: 25, height: 25, runs: [[624, 2, 255]] },
    { width: 25, height: 25, runs: [[20, 2, 255], [10, 2, 255]] },
    { width: 25, height: 25, runs: [[10, 3, 255], [12, 2, 255]] },
    { width: 25, height: 25, runs: Array.from({ length: 120001 }, () => [0, 1, 255]) },
  ])('rejects malformed or excessive smart-selection run data before saving', async (region) => {
    const body = new FormData(); body.set('name', 'Scene'); body.set('definition', JSON.stringify({ ...configured(),
      foregroundMask: { version: 1, strokes: [{ mode: 'paint', size: 1, softness: 0, points: [], region }] },
    }));
    await expect(updateOurTemplateImage(id, body)).rejects.toThrow(/foreground mask/i);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous smart region combined with ordinary brush points in the same stroke', async () => {
    const next = smartDefinition(); next.foregroundMask!.strokes[0].points.push({ x: 40, y: 40 });
    await expect(updateOurTemplateImage(id, form(next))).rejects.toThrow(/foreground mask/i);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('stores paint and erase strokes in the existing scene definition and restores them on reopen', async () => {
    persistUpdates();
    const next = maskedDefinition();
    const saved = await updateOurTemplateImage(id, form(next));
    const reopened = await getOurTemplateImage(id);
    expect(saved.foregroundMask).toEqual(next.foregroundMask);
    expect(reopened.foregroundMask).toEqual(next.foregroundMask);
    expect(reopened.width).toBe(100); expect(reopened.height).toBe(100);
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('retains the mask on creation without writing any separate mask asset', async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ffffff' } }).png().toBuffer();
    mocks.execute.mockImplementation(async (sql, ...values) => {
      if (statement(sql).includes('INSERT INTO our_template_images')) {
        scene.id = values[0]; scene.name = values[1]; scene.definition = JSON.parse(values[6]);
      }
      return 1;
    });
    const next = maskedDefinition(); const body = form(next);
    body.set('file', new File([new Uint8Array(png)], 'opaque-room.png', { type: 'image/png' }));
    const created = await createOurTemplateImage(body);
    expect(created.foregroundMask).toEqual(next.foregroundMask);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0][0]).toMatch(/scene\.png$/);
  });

  it('invalidates only scene followers when a paint or erase stroke changes', async () => {
    persistUpdates(); scene.definition = maskedDefinition();
    const next = maskedDefinition(); next.foregroundMask!.strokes[1].points.push({ x: 47, y: 49 });
    await updateOurTemplateImage(id, form(next));
    const updates = mocks.execute.mock.calls.filter(([sql]) => statement(sql).includes('listingImagesRevision'));
    expect(updates).toHaveLength(1);
    expect(updates[0][0].values).toEqual([101, 202, 303]);
    expect(mocks.listings).toHaveBeenCalledWith({ where: { ourCategoryId: { in: [1, 2, 3] } }, select: { id: true } });
    expect(mocks.execute.mock.calls.map(([sql]) => statement(sql)).join('\n')).not.toMatch(/imagesChanged|lastLocalChangeAt/);
  });

  it('keeps the saved mask and regeneration state unchanged for a rename alone', async () => {
    persistUpdates(); scene.definition = maskedDefinition();
    const body = new FormData(); body.set('name', 'Renamed scene');
    const saved = await updateOurTemplateImage(id, body);
    expect(saved.name).toBe('Renamed scene');
    expect(saved.foregroundMask).toEqual(maskedDefinition().foregroundMask);
    expect(mocks.listings).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.map(([sql]) => statement(sql)).join('\n')).not.toMatch(/listingImagesRevision|imagesChanged|lastLocalChangeAt/);
  });

  it('does not invalidate an existing scene when an empty brush mask is first saved', async () => {
    const next = configured(); next.foregroundMask = { version: 1, strokes: [] };
    await updateOurTemplateImage(id, form(next));
    expect(mocks.listings).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.map(([sql]) => statement(sql)).join('\n')).not.toMatch(/listingImagesRevision|imagesChanged|lastLocalChangeAt/);
  });

  it('marks scene followers stale when an existing foreground mask is cleared', async () => {
    scene.definition = maskedDefinition();
    await updateOurTemplateImage(id, form(configured()));
    expect(mocks.execute.mock.calls.filter(([sql]) => statement(sql).includes('listingImagesRevision'))).toHaveLength(1);
  });

  it.each([
    { version: 2, strokes: [] },
    { version: 1, strokes: [{ mode: 'unknown', size: 10, softness: 0, points: [{ x: 40, y: 40 }] }] },
    { version: 1, strokes: [{ mode: 'paint', size: -1, softness: 0, points: [{ x: 40, y: 40 }] }] },
    { version: 1, strokes: [{ mode: 'paint', size: 10, softness: 2, points: [{ x: 40, y: 40 }] }] },
    { version: 1, strokes: [{ mode: 'paint', size: 10, softness: 0, points: [{ x: 101, y: 40 }] }] },
    { version: 1, strokes: [{ mode: 'paint', size: 10, softness: 0, points: [{ x: 40, y: null }] }] },
  ])('rejects an invalid foreground mask before changing saved scene data: %j', async (mask) => {
    const invalid = { ...configured(), foregroundMask: mask };
    const body = new FormData(); body.set('name', 'Scene'); body.set('definition', JSON.stringify(invalid));
    await expect(updateOurTemplateImage(id, body)).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('rejects excessive scene JSON before parsing or saving brush strokes', async () => {
    const body = new FormData(); body.set('name', 'Scene'); body.set('definition', ' '.repeat(4 * 1024 * 1024 + 1));
    await expect(updateOurTemplateImage(id, body)).rejects.toThrow('scene settings are too large');
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([
    { version: 1, strokes: Array.from({ length: 1001 }, () => ({ mode: 'paint', size: 10, softness: 0, points: [{ x: 40, y: 40 }] })) },
    { version: 1, strokes: [{ mode: 'paint', size: 10, softness: 0, points: Array.from({ length: 100001 }, () => ({ x: 40, y: 40 })) }] },
  ])('rejects a foreground mask exceeding bounded stroke or point counts', async (mask) => {
    const body = new FormData(); body.set('name', 'Scene'); body.set('definition', JSON.stringify({ ...configured(), foregroundMask: mask }));
    await expect(updateOurTemplateImage(id, body)).rejects.toThrow(/foreground mask/i);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe('saved room scene dependencies and invalidation', () => {
  it('finds direct and transitive image links while excluding an unrelated template', () => {
    expect(dependentSceneReferences(references, id).map((row) => row.id)).toEqual([10, 20, 30]);
  });
  it('finds either JSON orientation slot, deduplicates paired references and follows links', () => {
    references[0].ourTemplateImageId = null;
    references[0].orientationVariants = JSON.stringify({ portrait: { ourTemplateImageId: id }, landscape: { ourTemplateImageId: id } });
    references[3].orientationVariants = { portrait: null, landscape: { ourTemplateImageId: 'another-scene' } };
    expect(dependentSceneReferences(references, id).map((row) => row.id)).toEqual([10, 20, 30]);
  });
  it('invalidates JSON slot references and linked followers on scene edits and removes the referencing role on deletion', async () => {
    references[0].ourTemplateImageId = null;
    references[0].orientationVariants = { portrait: { ourTemplateImageId: 'unrelated-opposite-scene' }, landscape: { ourTemplateImageId: id } };
    const next = configured(); next.openings[0].corners.topLeft.x += 2;
    await updateOurTemplateImage(id, form(next));
    expect(mocks.listings).toHaveBeenCalledWith({ where: { ourCategoryId: { in: [1, 2, 3] } }, select: { id: true } });
    expect(mocks.execute.mock.calls.filter(([sql]) => statement(sql).includes('listingImagesRevision'))[0][0].values).toEqual([101, 202, 303]);
    await deleteOurTemplateImage(id);
    expect(mocks.deleteTemplate).toHaveBeenCalledExactlyOnceWith('10', { localSceneChange: true });
    expect(mocks.query.mock.calls.some(([sql]) => statement(sql).includes('orientationVariants'))).toBe(true);
  });
  it('sorts newest first using creation date and id, so edits do not move older scenes', async () => {
    await getOurTemplateImages();
    expect(statement(mocks.query.mock.calls[0][0])).toContain('ORDER BY createdAt DESC, id DESC');
  });
  it('calculates deletion counts from current followers even before any listing images have been generated', async () => {
    expect(await getOurTemplateImageDeletionImpact(id)).toEqual({ affectedTemplateCount: 3, affectedImageTemplateCount: 3, affectedListingCount: 3 });
    expect(mocks.listings).toHaveBeenCalledWith({ where: { ourCategoryId: { in: [1, 2, 3] } }, select: { id: true } });
  });
  it('keeps a display rename free of regeneration and Etsy sync flags', async () => {
    const body = form(); body.set('name', 'Renamed nursery');
    const next = configured(); next.openings[0].name = 'Renamed frame'; body.set('definition', JSON.stringify(next));
    await updateOurTemplateImage(id, body);
    expect(mocks.listings).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.map(([sql]) => statement(sql)).join('\n')).not.toMatch(/listingImagesRevision|imagesChanged|lastLocalChangeAt/);
  });
  it('invalidates direct and linked followers on a corner edit without changing Etsy sync state', async () => {
    const next = configured(); next.openings[0].corners.topLeft.x += 2;
    await updateOurTemplateImage(id, form(next));
    const updates = mocks.execute.mock.calls.filter(([sql]) => statement(sql).includes('listingImagesRevision'));
    expect(updates).toHaveLength(1);
    expect(updates[0][0].values).toEqual([101, 202, 303]);
    expect(mocks.execute.mock.calls.map(([sql]) => statement(sql)).join('\n')).not.toMatch(/imagesChanged|lastLocalChangeAt/);
  });
  it('computes dependencies and marks stale before deleting any source or linked references', async () => {
    await deleteOurTemplateImage(id);
    expect(mocks.deleteTemplate).toHaveBeenCalledExactlyOnceWith('10', { localSceneChange: true });
    const invalidate = mocks.execute.mock.calls.findIndex(([sql]) => statement(sql).includes('listingImagesRevision'));
    const remove = mocks.execute.mock.calls.findIndex(([sql]) => statement(sql).includes('DELETE FROM our_template_images'));
    expect(invalidate).toBeGreaterThanOrEqual(0); expect(remove).toBeGreaterThan(invalidate);
    expect(mocks.listings.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteTemplate.mock.invocationCallOrder[0]);
    expect(mocks.execute.mock.invocationCallOrder[invalidate]).toBeLessThan(mocks.deleteTemplate.mock.invocationCallOrder[0]);
  });
  it('retains the saved scene when dependent file deletion fails', async () => {
    mocks.deleteTemplate.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(deleteOurTemplateImage(id)).rejects.toThrow('Storage unavailable');
    expect(mocks.execute.mock.calls.some(([sql]) => statement(sql).includes('DELETE FROM our_template_images'))).toBe(false);
    expect(mocks.execute.mock.calls.some(([sql]) => statement(sql).includes('listingImagesRevision'))).toBe(true);
  });
  it('renders sample uploads without writing files, changing listings or clearing regeneration status', async () => {
    const artwork = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#ee2200' } }).png().toBuffer();
    const body = new FormData(); body.set('artwork-1', new File([new Uint8Array(artwork)], 'sample.png', { type: 'image/png' }));
    const output = await testOurTemplateImage(id, body);
    expect((await sharp(output).metadata()).width).toBe(100);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.listings).not.toHaveBeenCalled();
  });
});
