import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ source: vi.fn(), editor: vi.fn(), categories: vi.fn(), target: vi.fn(), transaction: vi.fn(),
  read: vi.fn(), write: vi.fn(), unlink: vi.fn(), discover: vi.fn(), update: vi.fn(), imageRows: vi.fn(), deleteImages: vi.fn(), raw: vi.fn(), config: vi.fn() }));
vi.mock('@/lib/listing-editor', () => ({ getListingForContext: mocks.source, getListingEditorData: mocks.editor }));
vi.mock('@/lib/local-shop-directory', () => ({ getListingDirectoryPath: () => 'D:/Listings/Current' }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, writeFile: mocks.write, unlink: mocks.unlink, listGeneratedListingImageFiles: mocks.discover }));
vi.mock('@/lib/prisma', () => ({ prisma: { ourCategory: { findMany: mocks.categories, findFirst: mocks.target }, $transaction: mocks.transaction } }));
import { assignListingTemplate, getListingTemplateOptions } from './listing-template-assignment';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '3', listingId: '79' };
const directory = 'D:/Listings/Current';
const file = (name: string) => path.join(directory, name);
const pending = '0'.repeat(64);
type Template = ReturnType<typeof template>;
type Row = ReturnType<typeof listing>;
type Image = { id: number; listingId: number; ourCategoryImageTemplateId: number | null; localFileName: string | null; updatedAt: Date };
type Group = { id: number; groupListingId: number; sourceListingId: number; position: number };
type Product = { id: number; listingId: number; productKey: string; productType: string; sizeKey: string | null; frameKey: string | null;
  sku: string; priceKey: string; position: number; etsyListingId: string | null; etsyProductId?: string; etsyOfferingId?: string };
let templates: Template[];
let rows: Row[];
let images: Image[];
let groups: Group[];
let products: Product[];
let objects: Map<string, Buffer>;
let storageFailure: string | null;
let databaseFailure: boolean;

function template(id = 10, extra = {}) {
  return { id, shopId: 1, name: `Template ${id}`, templateType: 'single', itemCount: 1, followedTemplateId: null as number | null,
    roomTheme: 'Woodland', backgroundColour: '#F5F0E8', printsFrames: true, digitalDownload: true, customisePrints: true,
    customTop: true, customBottom: true, sizes: { a4: true }, frames: { no_frame: true, black: false, white: false, oak: false },
    downloadSection: { etsyShopSectionId: 123456 }, updatedAt: new Date('2026-11-20T10:00:00.000Z'), ...extra };
}
function listing(id = 79, ourCategoryId = 10) {
  return { id, ourCategoryId: ourCategoryId as number | null, shopId: '66615491', subSectionId: 3,
    title: `Artwork ${id}`, localDirectoryName: `Artwork-${id}`, thumbnailFileName: 'art.png', numberOfItems: 1, includeAllItems: false,
    roomTheme: 'Woodland', backgroundColour: '#ffffff', printCropSettings: { saved: 'crop' }, personalisationTextAreas: { saved: 'text' },
    etsyId: 'print-id', etsyDownloadId: 'digital-id', etsyCustomisedId: 'custom-id', etsyProductType: 'physical',
    updatedAt: new Date('2026-11-20T09:00:00.000Z'), lastLocalChangeAt: new Date('2026-11-20T09:00:00.000Z'),
    downloadsRevision: 4, listingImagesRevision: 2, listingImagesGeneratedRevision: 2,
    overviewGenerationFingerprint: 'a'.repeat(64), detailsChanged: false, productsChanged: false, imagesChanged: false, downloadsChanged: false,
    productConfig: { listingId: id, listOnEtsy: false, digitalDownload: true, printsFrames: true,
      printsFramesOverride: null as boolean | null, digitalDownloadOverride: null as boolean | null,
      customisePrints: true, customTop: true, customBottom: false, giftMessageEnabled: true, returnPolicyId: '5678',
      downloadSectionId: 123456, sku: 'SKU_000079', confirmedAt: new Date('2026-11-20T08:00:00.000Z') as Date | null },
  };
}
function source() {
  const row = rows.find(({ id }) => id === 79)!;
  return structuredClone({ shop: { id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: 'Shop' },
    section: { id: 2, title: 'Animals' }, subSection: { id: 3, name: 'Single Listings' }, listing: { ...row,
      ourCategory: templates.find(({ id }) => id === row.ourCategoryId) ?? null,
      images: images.filter(({ listingId }) => listingId === row.id),
    } });
}
function assignData(target: Record<string, unknown>, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    target[key] = value && typeof value === 'object' && 'increment' in value
      ? Number(target[key]) + Number(value.increment) : value;
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  templates = [template(), template(20, { roomTheme: 'Nursery', sizes: { a4: true, a3: true } }), template(99, { shopId: 2 })];
  rows = [listing()]; groups = []; products = [];
  images = [
    { id: 1, listingId: 79, ourCategoryImageTemplateId: 101, localFileName: 'template-101.png', updatedAt: new Date('2026-11-20T08:00:00.000Z') },
    { id: 2, listingId: 79, ourCategoryImageTemplateId: null, localFileName: 'manual.png', updatedAt: new Date('2026-11-20T08:00:00.000Z') },
    { id: 3, listingId: 79, ourCategoryImageTemplateId: null, localFileName: 'template-102.png', updatedAt: new Date('2026-11-20T08:00:00.000Z') },
  ];
  objects = new Map();
  for (const name of ['template-101.png', 'template-102.png', 'template-999.png', 'manual.png', 'thumbnail/art.png', 'digital-download.png']) {
    objects.set(file(name), Buffer.from(name)); objects.set(`${file(name)}.webp`, Buffer.from(`preview:${name}`));
  }
  storageFailure = null; databaseFailure = false;
  mocks.source.mockImplementation(async () => source());
  mocks.editor.mockImplementation(async () => structuredClone({ listing: rows[0], images: images.filter(row => row.listingId === 79), products }));
  mocks.categories.mockImplementation(async ({ where }) => structuredClone(templates.filter(row => row.shopId === where.shopId)));
  mocks.target.mockImplementation(async ({ where }) => structuredClone(templates.find(row => row.id === where.id && row.shopId === where.shopId) ?? null));
  mocks.discover.mockResolvedValue(['template-101.png', 'template-102.png', 'template-999.png', 'thumbnail/template-333.png', 'manual.png']);
  mocks.read.mockImplementation(async (target) => {
    if (!objects.has(target)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return Buffer.from(objects.get(target)!);
  });
  mocks.write.mockImplementation(async (target, contents) => { objects.set(target, Buffer.from(contents)); objects.set(`${target}.webp`, Buffer.from(`preview:${contents}`)); });
  mocks.unlink.mockImplementation(async (target) => {
    objects.delete(target); objects.delete(`${target}.webp`);
    if (target === storageFailure) throw new Error('S3 deletion failed');
  });
  mocks.update.mockImplementation(async ({ where, data }) => {
    const matches = rows.filter(row => typeof where.id === 'object' ? where.id.in.includes(row.id) : row.id === where.id);
    for (const row of matches) assignData(row, data);
    return { count: matches.length };
  });
  mocks.deleteImages.mockImplementation(async ({ where }) => { images = images.filter(row => row.listingId !== where.listingId || !where.id.in.includes(row.id)); return { count: 1 }; });
  mocks.imageRows.mockImplementation(async ({ where }) => structuredClone(images.filter(row => row.listingId === where.listingId)));
  mocks.config.mockImplementation(async ({ where, data }) => { const row = rows.find(row => row.id === where.listingId); if (row) assignData(row.productConfig, data); return { count: row ? 1 : 0 }; });
  mocks.raw.mockImplementation(async (sql) => {
    const text = sql.strings.join('');
    const affected = rows.filter(row => sql.values.includes(row.id));
    if (text.includes('listingImagesRevision =')) affected.forEach(row => { row.listingImagesRevision += 1; });
    if (text.includes('overviewGenerationFingerprint =')) affected.forEach(row => { row.overviewGenerationFingerprint = pending; });
    return affected.length;
  });
  mocks.transaction.mockImplementation(async (operation) => {
    const backup = structuredClone({ rows, images, groups, products });
    const tx = {
      ourCategory: { findFirst: mocks.target },
      etsyListing: { updateMany: mocks.update, update: async ({ where, data }: any) => { assignData(rows.find(row => row.id === where.id)!, data); },
        findUnique: async ({ where }: any) => {
          const row = rows.find(row => row.id === where.id)!;
          return structuredClone({ ...row, ourCategory: templates.find(template => template.id === row.ourCategoryId), products: products.filter(product => product.listingId === row.id) });
        } },
      etsyListingImage: { findMany: mocks.imageRows, deleteMany: mocks.deleteImages },
      etsyListingGroupItem: {
        findMany: async ({ where }: any) => groups.filter(group => where.groupListingId ? group.groupListingId === where.groupListingId : group.sourceListingId === where.sourceListingId).map(group => {
          const child = rows.find(row => row.id === group.sourceListingId)!;
          const parent = rows.find(row => row.id === group.groupListingId)!;
          return { ...group, sourceListing: child, groupListing: { ...parent, ourCategory: templates.find(template => template.id === parent.ourCategoryId) } };
        }),
        deleteMany: async ({ where }: any) => { groups = groups.filter(group => where.groupListingId ? group.groupListingId !== where.groupListingId : !where.id.in.includes(group.id)); },
      },
      etsyListingProductConfig: { updateMany: mocks.config, upsert: async ({ where, update }: any) => { assignData(rows.find(row => row.id === where.listingId)!.productConfig, update); } },
      etsySkuAllocation: { upsert: async () => ({ sequenceNumber: 79 }) },
      etsyListingProduct: {
        findMany: async ({ where }: any) => typeof where.listingId === 'object' ? products.filter(product => product.listingId !== where.listingId.not) : products.filter(product => product.listingId === where.listingId),
        deleteMany: async ({ where }: any) => { products = products.filter(product => product.listingId !== where.listingId || (where.productKey && where.productKey.notIn.includes(product.productKey))); },
        update: async ({ where, data }: any) => { assignData(products.find(product => product.id === where.id)!, data); },
        upsert: async ({ where, create, update }: any) => {
          const product = products.find(product => product.listingId === where.listingId_productKey.listingId && product.productKey === where.listingId_productKey.productKey);
          if (product) assignData(product, update); else products.push({ id: products.length + 100, ...create });
        },
      },
      $executeRaw: mocks.raw,
    };
    try { const result = await operation(tx); if (databaseFailure) throw new Error('Database failed'); return result; }
    catch (error) { ({ rows, images, groups, products } = backup); throw error; }
  });
});

describe('listing template choices and scope', () => {
  it('returns valid single and multiple templates only from the validated shop', async () => {
    templates.push(template(21, { templateType: 'multiple', itemCount: 3, followedTemplateId: 10 }), template(22, { templateType: 'single', itemCount: 3 }));
    expect(await getListingTemplateOptions(context)).toEqual({ templates: [
      { id: '10', name: 'Template 10', templateType: 'single', itemCount: 1 },
      { id: '20', name: 'Template 20', templateType: 'single', itemCount: 1 },
      { id: '21', name: 'Template 21', templateType: 'multiple', itemCount: 3 },
    ], currentTemplateId: '10' });
    expect(mocks.categories).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: 1 } }));
  });

  it('makes same-template selection a storage/database no-op', async () => {
    await assignListingTemplate(context, '10');
    expect(mocks.discover).not.toHaveBeenCalled(); expect(mocks.unlink).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['99', '999'])('rejects another shop or a missing template %s before touching storage', async (id) => {
    await expect(assignListingTemplate(context, id)).rejects.toMatchObject({ status: 404 });
    expect(mocks.discover).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([null, '', 20, '1.2', '-2', '9007199254740993'])('rejects invalid template ID %s', async (id) => {
    await expect(assignListingTemplate(context, id)).rejects.toMatchObject({ status: 400 }); expect(mocks.source).not.toHaveBeenCalled();
  });

  it('validates the entire context and rejects a mismatched stored shop before listing templates', async () => {
    mocks.source.mockRejectedValueOnce(new Error('Sub section not found.'));
    await expect(getListingTemplateOptions(context)).rejects.toMatchObject({ status: 404 });
    expect(mocks.categories).not.toHaveBeenCalled();
    rows[0].shopId = 'another-shop';
    await expect(assignListingTemplate(context, '20')).rejects.toMatchObject({ status: 404 }); expect(mocks.discover).not.toHaveBeenCalled();
  });

  it.each([{ templateType: 'other' }, { itemCount: 3 }, { templateType: 'multiple', itemCount: 1, followedTemplateId: 10 }, { templateType: 'multiple', itemCount: 3, followedTemplateId: null }])('rejects invalid target settings %j', async (extra) => {
    Object.assign(templates[1], extra);
    await expect(assignListingTemplate(context, '20')).rejects.toMatchObject({ status: 400 }); expect(mocks.discover).not.toHaveBeenCalled();
  });
});

describe('atomic assignment and generated photo cleanup', () => {
  it('deletes old generated rows/PNGs/WebPs and reserved orphans, preserving manual photos, source art, crops and downloads', async () => {
    const before = structuredClone(rows[0]);
    const result = await assignListingTemplate(context, '20');
    expect(rows[0]).toMatchObject({ ourCategoryId: 20, numberOfItems: 1, includeAllItems: false, roomTheme: 'Nursery',
      detailsChanged: true, imagesChanged: true, downloadsChanged: true, productsChanged: true,
      downloadsRevision: 5, listingImagesRevision: 3, listingImagesGeneratedRevision: 2, overviewGenerationFingerprint: pending });
    expect(images).toMatchObject([{ id: 2, listingId: 79, ourCategoryImageTemplateId: null, localFileName: 'manual.png' }]);
    for (const name of ['template-101.png', 'template-102.png', 'template-999.png']) {
      expect(objects.has(file(name))).toBe(false); expect(objects.has(`${file(name)}.webp`)).toBe(false);
    }
    for (const name of ['manual.png', 'thumbnail/art.png', 'digital-download.png']) {
      expect(objects.has(file(name))).toBe(true); expect(objects.has(`${file(name)}.webp`)).toBe(true);
    }
    expect(rows[0]).toMatchObject({ backgroundColour: before.backgroundColour, printCropSettings: before.printCropSettings,
      personalisationTextAreas: before.personalisationTextAreas, thumbnailFileName: before.thumbnailFileName,
      etsyId: before.etsyId, etsyDownloadId: before.etsyDownloadId, etsyCustomisedId: before.etsyCustomisedId });
    expect(result).toMatchObject({ listing: { ourCategoryId: 20 } });
    expect(mocks.unlink.mock.invocationCallOrder.at(-1)!).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0]);
  });

  it.each(['storage', 'database'])('restores old photos and assignment on %s failure', async (failure) => {
    const before = structuredClone(rows[0]); const beforeObjects = new Map(objects); const beforeImages = structuredClone(images);
    if (failure === 'storage') storageFailure = file('template-102.png'); else databaseFailure = true;
    await expect(assignListingTemplate(context, '20')).rejects.toThrow(failure === 'storage' ? 'S3 deletion failed' : 'Database failed');
    expect(rows[0]).toEqual(before); expect(images).toEqual(beforeImages); expect(objects).toEqual(beforeObjects);
    if (failure === 'storage') expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('restores photos if the listing changes before the atomic claim', async () => {
    mocks.update.mockResolvedValueOnce({ count: 0 });
    await expect(assignListingTemplate(context, '20')).rejects.toMatchObject({ status: 409 });
    expect(rows[0].ourCategoryId).toBe(10); expect(objects.has(file('template-101.png'))).toBe(true); expect(mocks.deleteImages).not.toHaveBeenCalled();
  });

  it.each(['insert', 'overwrite', 'detach'])('rolls back and restores photos when a generated child changes before commit: %s', async (change) => {
    mocks.imageRows.mockImplementationOnce(async () => {
      const current = structuredClone(images);
      if (change === 'insert') current.push({ ...current[0], id: 4, localFileName: 'template-555.png', ourCategoryImageTemplateId: 555 });
      if (change === 'overwrite') current[0].updatedAt = new Date('2026-11-20T11:00:00.000Z');
      if (change === 'detach') current[0].ourCategoryImageTemplateId = null;
      return current;
    });
    await expect(assignListingTemplate(context, '20')).rejects.toMatchObject({ status: 409 });
    expect(rows[0].ourCategoryId).toBe(10); expect(objects.has(file('template-101.png'))).toBe(true);
    expect(objects.has(`${file('template-101.png')}.webp`)).toBe(true); expect(mocks.deleteImages).not.toHaveBeenCalled();
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.imageRows.mock.invocationCallOrder[0]);
  });

  it('does not restore deleted photos after a successful save whose editor reload fails', async () => {
    mocks.editor.mockResolvedValue(null);
    await expect(assignListingTemplate(context, '20')).rejects.toMatchObject({ status: 503 });
    expect(rows[0].ourCategoryId).toBe(20); expect(objects.has(file('template-101.png'))).toBe(false);
  });
});

describe('product defaults and grouped artwork transitions', () => {
  it('reconciles actual product defaults with new sizes, retaining explicit opt-outs, identities and custom product SKUs', async () => {
    Object.assign(rows[0].productConfig, { printsFramesOverride: false, digitalDownloadOverride: false, customisePrints: true, customTop: true, customBottom: false });
    products = [{ id: 50, listingId: 79, productKey: 'unframed_a4', productType: 'physical', sizeKey: 'a4', frameKey: 'no_frame',
      sku: 'MY-CUSTOM-SKU', priceKey: 'unframed_a4', position: 1, etsyListingId: 'print-id', etsyProductId: 'product-id', etsyOfferingId: 'offering-id' }];
    await assignListingTemplate(context, '20');
    expect(rows[0].productConfig).toMatchObject({ listOnEtsy: false, giftMessageEnabled: true, returnPolicyId: '5678', sku: 'SKU_000079',
      printsFramesOverride: false, digitalDownloadOverride: false, digitalDownload: false, customisePrints: true, customBottom: false, confirmedAt: null });
    expect(products.find(product => product.productKey === 'unframed_a4')).toMatchObject({ sku: 'MY-CUSTOM-SKU', etsyProductId: 'product-id', etsyOfferingId: 'offering-id' });
    expect(products.some(product => product.productKey === 'unframed_a3')).toBe(true); expect(products.some(product => product.productKey === 'digital')).toBe(false);
  });

  it('inherits newly available customization while preserving a previously explicit disable', async () => {
    Object.assign(templates[0], { customisePrints: false, customTop: false, customBottom: false });
    Object.assign(rows[0].productConfig, { customisePrints: false, customTop: false, customBottom: false });
    await assignListingTemplate(context, '20');
    expect(rows[0].productConfig).toMatchObject({ customisePrints: true, customTop: true, customBottom: true });
  });

  it.each([true, false])('retains complete compatible groups only: compatibility %s', async (compatible) => {
    templates[0] = template(10, { templateType: 'multiple', itemCount: 3, followedTemplateId: 30 });
    templates[1] = template(20, { templateType: 'multiple', itemCount: 3, followedTemplateId: compatible ? 30 : 40 });
    rows[0].numberOfItems = 3;
    rows.push(listing(81, 30), listing(82, 30), listing(83, 30));
    groups = [81, 82, 83].map((sourceListingId, index) => ({ id: index + 1, groupListingId: 79, sourceListingId, position: index + 1 }));
    await assignListingTemplate(context, '20'); expect(groups).toHaveLength(compatible ? 3 : 0); expect(rows[0].numberOfItems).toBe(3);
  });

  it('clears a previous multiple selection when switching to single', async () => {
    templates[0] = template(10, { templateType: 'multiple', itemCount: 3, followedTemplateId: 30 });
    rows.push(listing(81, 30)); groups = [{ id: 1, groupListingId: 79, sourceListingId: 81, position: 1 }];
    await assignListingTemplate(context, '20'); expect(groups).toEqual([]); expect(rows[0].numberOfItems).toBe(1);
  });

  it('allows single to multiple, requiring the user to select the new grouped artwork', async () => {
    templates[1] = template(20, { templateType: 'multiple', itemCount: 3, followedTemplateId: 30 });
    await assignListingTemplate(context, '20'); expect(groups).toEqual([]); expect(rows[0].numberOfItems).toBe(3);
  });

  it('detaches incompatible parent selections and marks all affected parents pending without changing their products', async () => {
    templates.push(template(30, { templateType: 'multiple', itemCount: 3, followedTemplateId: 10 }), template(40, { templateType: 'multiple', itemCount: 3, followedTemplateId: 20 }));
    rows.push(listing(80, 30), listing(81, 40));
    groups = [{ id: 1, groupListingId: 80, sourceListingId: 79, position: 1 }, { id: 2, groupListingId: 81, sourceListingId: 79, position: 1 }];
    await assignListingTemplate(context, '20');
    expect(groups).toEqual([{ id: 2, groupListingId: 81, sourceListingId: 79, position: 1 }]);
    for (const parent of rows.slice(1)) expect(parent).toMatchObject({ downloadsRevision: 5, listingImagesRevision: 3,
      overviewGenerationFingerprint: pending, imagesChanged: true, downloadsChanged: true, productsChanged: false });
  });
});
