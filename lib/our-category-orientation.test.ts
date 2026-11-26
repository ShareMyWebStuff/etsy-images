import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), image: vi.fn(), images: vi.fn(),
  create: vi.fn(), update: vi.fn(), claim: vi.fn(), category: vi.fn(), categories: vi.fn(), listings: vi.fn(),
  read: vi.fn(), preview: vi.fn(), write: vi.fn(), mkdir: vi.fn(), copy: vi.fn(), unlink: vi.fn(), definition: vi.fn() }));
vi.mock('@/lib/our-template-image-definitions', () => ({ getOurTemplateImageDefinition: mocks.definition }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query, $executeRaw: mocks.execute, $transaction: mocks.transaction,
  ourCategory: { findUnique: mocks.category, findMany: mocks.categories, findFirst: vi.fn(async () => null), update: vi.fn() },
  etsyShop: { findUnique: vi.fn(async () => ({ id: 1, etsyShopId: 66n })) }, etsyListing: { findMany: mocks.listings },
  ourCategoryImageTemplate: { findUnique: mocks.image, findMany: mocks.images, findFirst: vi.fn(async () => null),
    create: mocks.create, update: mocks.update, updateMany: mocks.claim, delete: vi.fn() } } }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, readImagePreview: mocks.preview, writeFile: mocks.write,
  mkdir: mocks.mkdir, copyFile: mocks.copy, unlink: mocks.unlink }));

import { prisma } from '@/lib/prisma';
import { copyOurCategoryImageTemplate, copyOurTemplateImages, createOurCategory, createOurCategoryImageTemplate,
  defaultOurCategoryValues, duplicateOurCategoryImageTemplate, getOurCategoryEditorData, getOurCategoryTemplateImage, linkFollowedOurCategoryImageTemplate,
  renderOurCategoryImageTemplate, testOurCategoryImageTemplate, updateOurCategory, updateOurCategoryImageTemplate,
  updateOurCategoryImageTemplateOrientation } from '@/lib/our-categories';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';

const portraitId = '10000000-0000-4000-8000-000000000001';
const landscapeId = '10000000-0000-4000-8000-000000000002';
type Variants = { portrait: { ourTemplateImageId: string; itemMapping: Record<string, number> | null } | null;
  landscape: { ourTemplateImageId: string; itemMapping: Record<string, number> | null } | null };
function baseRole(id = 10, categoryId = 1) {
  return { id, categoryId, name: `Image role ${id}`, description: 'Room', imagePath: 'no-parent-file.png', originalFileName: '',
    contentType: 'image/png', sizeBytes: 0, imageWidth: null as number | null, imageHeight: null as number | null,
    openingRegions: [] as unknown[], openingCorners: null, topText: '', bottomText: '', fontId: 'nunito-semibold',
    displayFonts: false, borderEnabled: false, borderSizePercent: 5, useOnPrints: true, useOnCustomised: false, useOnDigital: true,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ourTemplateImageId: null as string | null,
    ourTemplateImageItemMapping: null as Record<string, number> | null, orientationVariants: { portrait: null, landscape: null } as Variants | null,
    templateImageDefinitionId: null as string | null,
    linkedSourceCategoryId: null as number | null, linkedSourceImageTemplateId: null as number | null, linkedImageItemNumber: null as number | null };
}
type Role = ReturnType<typeof baseRole>;
let roles: Map<number, Role>;
let definitions: Map<string, OurTemplateImageDefinition>;
let files: Map<string, Buffer>;
let sceneVersions: Map<string, Date>;
const category = { id: 1, shopId: 1, name: 'Single', templateType: 'single', followedTemplateId: null, itemCount: 1,
  roomTheme: '', backgroundColour: '#FFFFFF', portraitEnabled: true, landscapeEnabled: true,
  printsFrames: true, customisePrints: false, digitalDownload: true, customTop: false, customBottom: false,
  printFrameSectionId: null, customisedSectionId: null, downloadSectionId: null, sizes: {}, frames: {} };
const multiple = { ...category, id: 2, name: 'Set', templateType: 'multiple', itemCount: 3, followedTemplateId: 1 };
function statement(sql: TemplateStringsArray | { sql?: string }) { return Array.isArray(sql) ? sql.join('') : (sql as { sql?: string }).sql ?? ''; }
function paired(): Variants { return { portrait: { ourTemplateImageId: portraitId, itemMapping: null },
  landscape: { ourTemplateImageId: landscapeId, itemMapping: null } }; }
function roleForm() { const form = new FormData(); form.set('roleOnly', 'true'); form.set('name', 'Shared image role');
  form.set('description', 'Description'); form.set('useOnPrints', 'true'); form.set('useOnCustomised', 'false'); form.set('useOnDigital', 'true'); return form; }
async function artwork(orientation: 'portrait' | 'landscape') {
  return sharp({ create: { width: orientation === 'portrait' ? 40 : 50, height: orientation === 'portrait' ? 50 : 40,
    channels: 3, background: '#33bb66' } }).png().toBuffer();
}

beforeEach(async () => {
  vi.clearAllMocks(); category.portraitEnabled = true; category.landscapeEnabled = true; roles = new Map([[10, baseRole()]]);
  mocks.unlink.mockResolvedValue(undefined);
  sceneVersions = new Map([[portraitId, new Date('2026-01-02')], [landscapeId, new Date('2026-01-03')]]);
  definitions = new Map((['portrait', 'landscape'] as const).map((orientation, index) => [index ? landscapeId : portraitId,
    { width: 120, height: 100, lightingMode: 'opaque', openings: [{ id: 'frame', name: 'Frame', imageItemNumber: 1, ratio: '4x5',
      orientation, placements: {}, corners: orientation === 'portrait'
        ? { topLeft: { x: 30, y: 10 }, topRight: { x: 90, y: 10 }, bottomRight: { x: 90, y: 85 }, bottomLeft: { x: 30, y: 85 } }
        : { topLeft: { x: 10, y: 15 }, topRight: { x: 110, y: 15 }, bottomRight: { x: 110, y: 95 }, bottomLeft: { x: 10, y: 95 } } }] } ]));
  files = new Map([[portraitId, await sharp({ create: { width: 120, height: 100, channels: 4, background: '#eeddcc' } }).png().toBuffer()],
    [landscapeId, await sharp({ create: { width: 120, height: 100, channels: 4, background: '#8899aa' } }).png().toBuffer()]]);
  mocks.image.mockImplementation(async ({ where }: { where: { id: number } }) => roles.has(where.id) ? { ...roles.get(where.id)! } : null);
  mocks.images.mockImplementation(async ({ where }: { where: { categoryId: number } }) => [...roles.values()].filter((row) => row.categoryId === where.categoryId));
  mocks.category.mockResolvedValue(category);
  mocks.categories.mockImplementation(async () => [category, multiple].map((row) => ({ ...row,
    _count: { imageTemplates: [...roles.values()].filter((role) => role.categoryId === row.id).length } })));
  mocks.create.mockImplementation(async ({ data }: { data: Partial<Role> }) => {
    const row = { ...baseRole(roles.size + 20, data.categoryId), orientationVariants: null, ...data }; roles.set(row.id, row); return { ...row };
  });
  mocks.update.mockImplementation(async ({ where, data }: { where: { id: number }; data: Partial<Role> }) => {
    const row = roles.get(where.id)!; Object.assign(row, data); return { ...row };
  });
  mocks.claim.mockImplementation(async ({ where, data }: { where: { id: number; updatedAt: Date }; data: Partial<Role> }) => {
    const row = roles.get(where.id); if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  mocks.transaction.mockImplementation(async (operation: (tx: typeof prisma) => unknown) => operation(prisma));
  mocks.listings.mockImplementation(async ({ where }: { where: { ourCategoryId: { in: number[] } } }) =>
    [{ id: 101, categoryId: 1 }, { id: 202, categoryId: 2 }, { id: 303, categoryId: 3 }, { id: 404, categoryId: 4 }]
      .filter((row) => where.ourCategoryId.in.includes(row.categoryId)).map(({ id }) => ({ id })));
  mocks.query.mockImplementation(async (sql: TemplateStringsArray | { sql?: string }, ...values: unknown[]) => {
    const text = statement(sql);
    if (text.includes('FROM our_template_image_tag_links')) return [];
    if (text.includes('FROM our_template_images')) {
      const id = String(values[0]), definition = definitions.get(id); if (!definition) return [];
      return [{ id, name: id === portraitId ? 'Portrait room' : 'Landscape room', originalFileName: `${id}.png`, imagePath: id,
        whiteImagePath: null, blackImagePath: null, definition, createdAt: new Date('2026-01-01'), updatedAt: sceneVersions.get(id) }];
    }
    if (text.includes('SELECT linked.id')) {
      const row = roles.get(Number(values[0])); return row ? [{ ...row, linkedSourceTemplateName: 'Single', linkedSourceImageTemplateName: 'Source' }] : [];
    }
    if (text.includes('FROM our_category_image_templates')) {
      if (text.includes('AND linkedSourceImageTemplateId')) return [];
      return [...roles.values()].filter((row) => row.categoryId === Number(values[0]));
    }
    if (text.includes('SELECT id, followedTemplateId')) return [{ id: 1, followedTemplateId: null }, { id: 2, followedTemplateId: 1 },
      { id: 3, followedTemplateId: 2 }, { id: 4, followedTemplateId: null }];
    if (text.includes('FROM our_categories')) return [Number(values[0]) === 2 ? multiple : category];
    return [];
  });
  mocks.execute.mockImplementation(async (sql: TemplateStringsArray | { sql?: string }, ...values: unknown[]) => {
    const text = statement(sql);
    if (text.includes('SET orientationVariants')) {
      const row = roles.get(Number(values[1]))!; row.orientationVariants = JSON.parse(String(values[0])); row.ourTemplateImageId = null;
    } else if (text.includes('SET templateImageDefinitionId')) {
      roles.get(Number(values[1]))!.templateImageDefinitionId = String(values[0]);
    } else if (text.includes('SET ourTemplateImageId =')) {
      Object.assign(roles.get(Number(values[3]))!, { ourTemplateImageId: values[0], ourTemplateImageItemMapping: values[1] ? JSON.parse(String(values[1])) : null,
        orientationVariants: values[2] ? JSON.parse(String(values[2])) : null });
    } else if (text.includes('SET templateType')) {
      category.portraitEnabled = Boolean(values[3]); category.landscapeEnabled = Boolean(values[4]);
    } else if (text.includes('SET linkedSourceCategoryId')) {
      Object.assign(roles.get(Number(values[3]))!, { linkedSourceCategoryId: Number(values[0]), linkedSourceImageTemplateId: Number(values[1]), linkedImageItemNumber: Number(values[2]) });
    }
    return 1;
  });
  mocks.read.mockImplementation(async (filePath: string) => { const contents = files.get(filePath); if (!contents) throw new Error('Parent placeholder has no stored file.'); return contents; });
  mocks.preview.mockImplementation(async (filePath: string) => Buffer.from(`preview:${filePath}`));
});

describe('template orientation roles', () => {
  it('defaults both category orientations on and rejects disabling both before querying storage or the database', async () => {
    expect(defaultOurCategoryValues()).toMatchObject({ portraitEnabled: true, landscapeEnabled: true });
    await expect(createOurCategory({ ...defaultOurCategoryValues(), name: 'No orientations', portraitEnabled: false, landscapeEnabled: false })).rejects.toThrow(/Portrait, Landscape/);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('persists an orientation toggle and invalidates direct and followed listings without deleting source assets', async () => {
    const result = await updateOurCategory('1', { ...defaultOurCategoryValues(), name: 'Single', roomTheme: 'Room theme', backgroundColour: '#FFFFFF',
      printsFrames: false, customisePrints: false, digitalDownload: false, portraitEnabled: true, landscapeEnabled: false });
    expect(result.values).toMatchObject({ portraitEnabled: true, landscapeEnabled: false });
    expect(mocks.execute.mock.calls.filter(([sql]) => statement(sql).includes('listingImagesRevision'))[0][0].values).toEqual([101, 202, 303]);
    expect(mocks.unlink).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('creates an empty role without a physical parent image and keeps both slots explicitly empty', async () => {
    const role = await createOurCategoryImageTemplate('1', roleForm());
    expect(role.orientationVariants).toEqual({ portrait: null, landscape: null });
    expect(role.orientationWarnings).toMatchObject({ portrait: expect.stringContaining('portrait'), landscape: expect.stringContaining('landscape') });
    await expect(getOurCategoryTemplateImage(role.id, false, 'portrait')).rejects.toThrow(/Choose a portrait/);
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });

  it('assigns one scene without replacing its opposite slot and invalidates only direct and transitive followers', async () => {
    roles.get(10)!.orientationVariants = paired();
    const role = await updateOurCategoryImageTemplateOrientation('10', { orientation: 'portrait', ourTemplateImageId: portraitId });
    expect(role.orientationVariants?.portrait).toMatchObject({ ourTemplateImageId: portraitId, compatible: true });
    expect(role.orientationVariants?.landscape).toMatchObject({ ourTemplateImageId: landscapeId, compatible: true });
    const invalidations = mocks.execute.mock.calls.filter(([sql]) => statement(sql).includes('listingImagesRevision'));
    expect(invalidations).toHaveLength(1); expect(invalidations[0][0].values).toEqual([101, 202, 303]);
    expect(mocks.unlink).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('rejects incompatible paper openings and invalid mappings before claiming or modifying the role', async () => {
    await expect(updateOurCategoryImageTemplateOrientation('10', { orientation: 'landscape', ourTemplateImageId: portraitId })).rejects.toThrow(/portrait/);
    await expect(updateOurCategoryImageTemplateOrientation('10', { orientation: 'portrait', ourTemplateImageId: portraitId, itemMapping: { 1: 2 } })).rejects.toThrow(/from 1 to 1/);
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('clears only the selected orientation, with no legacy fallback for the cleared slot', async () => {
    roles.get(10)!.orientationVariants = paired(); roles.get(10)!.ourTemplateImageId = portraitId;
    const role = await updateOurCategoryImageTemplateOrientation('10', { orientation: 'portrait', ourTemplateImageId: null });
    expect(role.orientationVariants?.portrait).toBeNull(); expect(role.orientationVariants?.landscape?.ourTemplateImageId).toBe(landscapeId);
    await expect(getOurCategoryTemplateImage('10', false, 'portrait')).rejects.toThrow(/Choose a portrait/);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('rejects a concurrent role change before writing either orientation or marking listings stale', async () => {
    roles.get(10)!.orientationVariants = paired(); mocks.claim.mockResolvedValue({ count: 0 });
    await expect(updateOurCategoryImageTemplateOrientation('10', { orientation: 'portrait', ourTemplateImageId: null }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('Refresh') });
    expect(roles.get(10)!.orientationVariants).toEqual(paired()); expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('updates role metadata without changing scene choices or writing parent assets', async () => {
    roles.get(10)!.orientationVariants = paired(); const form = roleForm(); form.set('name', 'Renamed role');
    const role = await updateOurCategoryImageTemplate('10', form);
    expect(role.name).toBe('Renamed role'); expect(roles.get(10)!.orientationVariants).toEqual(paired());
    expect(mocks.execute.mock.calls.some(([sql]) => statement(sql).includes('SET orientationVariants'))).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('uses cached per-slot previews and original full scenes without touching parent placeholder files', async () => {
    roles.get(10)!.orientationVariants = paired();
    expect(await getOurCategoryTemplateImage('10', true, 'landscape')).toMatchObject({ contents: Buffer.from(`preview:${landscapeId}`), contentType: 'image/webp' });
    expect(mocks.read).not.toHaveBeenCalled();
    expect((await getOurCategoryTemplateImage('10', false, 'portrait')).contents).toBe(files.get(portraitId));
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(portraitId);
  });

  it('advances explicit-role and linked-role cache versions when either shared scene changes without touching parent rows', async () => {
    roles.get(10)!.orientationVariants = paired();
    const linked = await linkFollowedOurCategoryImageTemplate('2', '10', 3);
    const initial = await getOurCategoryEditorData('1');
    expect(initial.imageTemplates[0].updatedAt).toBe('2026-01-03T00:00:00.000Z');
    const parentUpdatedAt = roles.get(10)!.updatedAt.getTime();
    sceneVersions.set(portraitId, new Date('2026-02-04'));
    const replacement = await sharp({ create: { width: 120, height: 100, channels: 4, background: '#992244' } }).png().toBuffer();
    files.set(portraitId, replacement);
    const changed = await getOurCategoryEditorData('1');
    const linkedChanged = await getOurCategoryEditorData('2');
    expect(changed.imageTemplates[0].updatedAt).toBe('2026-02-04T00:00:00.000Z');
    expect(changed.imageTemplates[0].orientationVariants?.portrait?.updatedAt).toBe('2026-02-04T00:00:00.000Z');
    expect(linkedChanged.imageTemplates.find((role) => role.id === linked.id)?.updatedAt).toBe('2026-02-04T00:00:00.000Z');
    expect(roles.get(10)!.updatedAt.getTime()).toBe(parentUpdatedAt);
    expect((await getOurCategoryTemplateImage('10', false, 'portrait')).contents).toBe(replacement);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('keeps a missing slot asset on the parent timestamp instead of creating an invalid cache version', async () => {
    roles.get(10)!.orientationVariants = paired(); definitions.clear();
    const data = await getOurCategoryEditorData('1');
    expect(data.imageTemplates[0].updatedAt).toBe(roles.get(10)!.updatedAt.toISOString());
    expect(data.imageTemplates[0].orientationVariants?.portrait?.compatible).toBe(false);
  });

  it.each(['portrait', 'landscape'] as const)('Test and normal rendering use the same %s slot at the original scene dimensions', async (orientation) => {
    roles.get(10)!.orientationVariants = paired(); const contents = await artwork(orientation);
    const preview = await testOurCategoryImageTemplate('10', [new File([new Uint8Array(contents)], 'art.png', { type: 'image/png' })], orientation);
    const normal = await renderOurCategoryImageTemplate(10, new Map([[1, contents]]), undefined, undefined, undefined, undefined, undefined, new Map([[1, orientation]]), orientation);
    expect(preview.equals(normal)).toBe(true); expect(await sharp(normal).metadata()).toMatchObject({ width: 120, height: 100 });
    expect(mocks.read.mock.calls.every(([filePath]) => filePath === (orientation === 'portrait' ? portraitId : landscapeId))).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('uses the selected scene and requires artwork when a former font-showcase role has orientation slots', async () => {
    roles.get(10)!.displayFonts = true; roles.get(10)!.orientationVariants = paired();
    await expect(testOurCategoryImageTemplate('10', [], 'portrait')).rejects.toThrow('Choose an image to attach.');
    const contents = await artwork('portrait');
    const preview = await testOurCategoryImageTemplate('10', [new File([new Uint8Array(contents)], 'art.png')], 'portrait');
    const normal = await renderOurCategoryImageTemplate(10, new Map([[1, contents]]), undefined, undefined, undefined, undefined, undefined, undefined, 'portrait');
    expect(preview.equals(normal)).toBe(true); expect(roles.get(10)!.displayFonts).toBe(true);
    expect(await sharp(normal).metadata()).toMatchObject({ width: 120, height: 100 });
  });

  it('revalidates every mapped artwork orientation even when the caller requests a particular slot', async () => {
    roles.get(10)!.orientationVariants = paired();
    await expect(renderOurCategoryImageTemplate(10, new Map([[1, await artwork('landscape')]]), undefined, undefined, undefined, undefined, undefined, undefined, 'portrait'))
      .rejects.toThrow(/landscape/);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('also infers and checks actual artwork orientation for a legacy saved-scene Test without an orientation parameter', async () => {
    roles.get(10)!.orientationVariants = null; roles.get(10)!.ourTemplateImageId = portraitId;
    const contents = await artwork('landscape');
    await expect(testOurCategoryImageTemplate('10', [new File([new Uint8Array(contents)], 'art.png')])).rejects.toThrow(/landscape/);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('duplicates paired and empty roles without copying a nonexistent parent file', async () => {
    roles.get(10)!.orientationVariants = paired(); const duplicated = await duplicateOurCategoryImageTemplate('10');
    expect(duplicated.orientationVariants?.portrait?.ourTemplateImageId).toBe(portraitId);
    expect(duplicated.orientationVariants?.landscape?.ourTemplateImageId).toBe(landscapeId);
    roles.get(10)!.orientationVariants = { portrait: null, landscape: null };
    expect((await duplicateOurCategoryImageTemplate('10')).orientationVariants).toEqual({ portrait: null, landscape: null });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('copies both orientation mappings independently into a multiple template', async () => {
    roles.get(10)!.orientationVariants = paired();
    const copied = await copyOurCategoryImageTemplate('2', '1', '10', [3]);
    for (const slot of [copied.orientationVariants?.portrait, copied.orientationVariants?.landscape]) {
      expect(slot?.itemMapping?.['1']).toBe(3); expect(slot?.openingRegions?.[0].imageItemNumber).toBe(3);
    }
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('copies empty orientation roles between templates without turning them into neutral images', async () => {
    mocks.categories.mockImplementation(async () => [category, { ...category, id: 2 }].map((row) => ({ ...row,
      _count: { imageTemplates: row.id === 1 ? 1 : 0 } })));
    await copyOurTemplateImages('1', '2');
    const copied = [...roles.values()].find((row) => row.categoryId === 2)!;
    expect(copied.orientationVariants).toEqual({ portrait: null, landscape: null }); expect(mocks.copy).not.toHaveBeenCalled();
  });

  it('inherits both linked slots and applies the linked artwork item to Test and normal rendering', async () => {
    roles.get(10)!.orientationVariants = paired();
    const linked = await linkFollowedOurCategoryImageTemplate('2', '10', 3);
    expect(linked.orientationVariants?.portrait?.openingRegions?.[0].imageItemNumber).toBe(3);
    expect(linked.orientationVariants?.landscape?.openingRegions?.[0].imageItemNumber).toBe(3);
    const contents = await artwork('landscape');
    const test = await testOurCategoryImageTemplate(linked.id, [new File([new Uint8Array(contents)], 'art.png')], 'landscape');
    const normal = await renderOurCategoryImageTemplate(Number(linked.id), new Map([[3, contents]]), undefined, undefined, undefined, undefined, undefined,
      new Map([[3, 'landscape']]), 'landscape');
    expect(test.equals(normal)).toBe(true); expect(mocks.write).not.toHaveBeenCalled();
  });

  function definitionParent(mode: 'no-areas' | 'combined' | 'both', isEmpty = false) {
    const configured = structuredClone(definitions.get(portraitId)!);
    if (mode === 'no-areas') configured.openings = [];
    if (mode === 'combined') configured.openings.push({ ...configured.openings[0], id: 'landscape', orientation: 'landscape', imageItemNumber: 99 });
    const images = isEmpty ? [] : [{ ...configured, id: portraitId, name: 'Saved room', originalFileName: 'Room.png', tags: [],
      variantSlot: mode === 'both' ? 'portrait' : 'single', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }];
    mocks.definition.mockResolvedValue({ id: portraitId, name: 'Shared definition', mode, images,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' });
    roles.get(10)!.templateImageDefinitionId = portraitId; roles.get(10)!.orientationVariants = null;
  }

  it.each(['no-areas', 'combined', 'empty'] as const)('duplicates a %s definition reference without parent asset I/O or invented legacy pointers', async (mode) => {
    definitionParent(mode === 'empty' ? 'both' : mode, mode === 'empty');
    const copy = await duplicateOurCategoryImageTemplate('10');
    const stored = roles.get(Number(copy.id))!;
    expect(copy.templateImageDefinitionId).toBe(portraitId); expect(stored.templateImageDefinitionId).toBe(portraitId);
    expect(stored.ourTemplateImageId).toBeNull(); expect(stored.orientationVariants).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('copies an arbitrary-item Combined definition into a smaller multiple template without requiring legacy remapping', async () => {
    definitionParent('combined');
    const copy = await copyOurCategoryImageTemplate('2', '1', '10', undefined);
    expect(copy).toMatchObject({ templateImageDefinitionId: portraitId, definitionMode: 'combined' });
    expect(copy.openingRegions.map((region) => region.imageItemNumber)).toEqual([1, 99]);
    expect(roles.get(Number(copy.id))!.ourTemplateImageId).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('preserves parent references during full image-role cloning without copying a No areas parent placeholder', async () => {
    definitionParent('no-areas');
    mocks.categories.mockImplementation(async () => [category, { ...category, id: 2 }].map((row) => ({ ...row, _count: { imageTemplates: row.id === 1 ? 1 : 0 } })));
    await copyOurTemplateImages('1', '2');
    const copy = [...roles.values()].find((row) => row.categoryId === 2)!;
    expect(copy.templateImageDefinitionId).toBe(portraitId); expect(copy.ourTemplateImageId).toBeNull(); expect(copy.orientationVariants).toBeNull();
    expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });

  it('retains migrated legacy slot mappings alongside the parent reference when duplicating an existing grouped role', async () => {
    definitionParent('both'); const original = roles.get(10)!;
    original.orientationVariants = { portrait: { ourTemplateImageId: portraitId, itemMapping: { 1: 3 } }, landscape: null };
    const copy = await duplicateOurCategoryImageTemplate('10');
    expect(roles.get(Number(copy.id))!.orientationVariants).toEqual(original.orientationVariants);
    expect(roles.get(Number(copy.id))!.templateImageDefinitionId).toBe(portraitId);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  function legacySceneForm() { const body = roleForm(); body.delete('roleOnly'); body.set('ourTemplateImageId', portraitId); body.set('orientation', 'portrait'); return body; }
  it('locks and revalidates a compatibility scene attachment before creating its legacy image role', async () => {
    const result = await createOurCategoryImageTemplate('1', legacySceneForm());
    expect(result.orientationVariants?.portrait?.ourTemplateImageId).toBe(portraitId);
    const lockIndex = mocks.query.mock.calls.findIndex(([sql]) => statement(sql).includes('FROM our_template_images') && statement(sql).includes('FOR UPDATE'));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.query.mock.invocationCallOrder[lockIndex]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it('rejects a compatibility attachment if its source was deleted after preflight and removes only its staged copy', async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql, ...values) => statement(sql).includes('FROM our_template_images') && statement(sql).includes('FOR UPDATE') ? [] : query(sql, ...values));
    await expect(createOurCategoryImageTemplate('1', legacySceneForm())).rejects.toThrow('changed or was deleted');
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith(mocks.write.mock.calls[0][0]);
    expect(mocks.unlink.mock.calls[0][0]).not.toBe(portraitId);
  });
  it('rejects a compatibility slot update if its scene disappears before the role can be claimed', async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql, ...values) => statement(sql).includes('FROM our_template_images') && statement(sql).includes('FOR UPDATE') ? [] : query(sql, ...values));
    await expect(updateOurCategoryImageTemplateOrientation('10', { orientation: 'portrait', ourTemplateImageId: portraitId })).rejects.toMatchObject({ status: 409 });
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('preserves the committed compatibility role and its copied file if post-commit hydration fails', async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql, ...values) => {
      if (mocks.create.mock.calls.length && statement(sql).includes('SELECT id, templateImageDefinitionId')) throw new Error('Hydration unavailable');
      return query(sql, ...values);
    });
    await expect(createOurCategoryImageTemplate('1', legacySceneForm())).rejects.toThrow('The image template was saved. Reload');
    expect(roles.size).toBe(2); expect(mocks.unlink).not.toHaveBeenCalled();
    expect([...roles.values()].find((row) => row.id !== 10)?.orientationVariants?.portrait?.ourTemplateImageId).toBe(portraitId);
  });
});
