import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import sharp, { type Metadata } from 'sharp';
import { prisma } from '@/lib/prisma';
import { createLocalListingRowInTransaction, getListingContext } from '@/lib/local-listings';
import { getListingDirectoryPath, getSectionDirectoryPath } from '@/lib/local-shop-directory';
import { getSubSectionListingsPageData } from '@/lib/listing-table';
import { parseListingImportArchive, LISTING_IMPORT_ARCHIVE_LIMITS } from '@/lib/listing-import-archive';
import { buildListingProductDefinitions, getTemplateProductOptions } from '@/lib/listing-products';
import { effectiveListingCustomisation } from '@/lib/listing-customisation';
import { ETSY_LISTINGS_DIRECTORY } from '@/lib/config';
import { readdir, unlink, writeFile } from '@/lib/s3-listing-storage';

const DESCRIPTION_LIMIT = 1000;
const nameCollator = new Intl.Collator('en', { sensitivity: 'base', usage: 'search' });
export type ListingZipImportContext = { shopId: string; sectionId: string; subSectionId: string };
type Context = ListingZipImportContext;
type ResolvedContext = Awaited<ReturnType<typeof getListingContext>>;
type ArchiveRow = Awaited<ReturnType<typeof parseListingImportArchive>>['rows'][number];
type ArtworkRow = Pick<ArchiveRow, 'rowNumber' | 'image' | 'originalFileName' | 'relativeFilename'>;
export type ListingZipReviewRow = Omit<ArchiveRow, 'image'> & {
  width: number | null;
  height: number | null;
  orientation: 'portrait' | 'landscape' | null;
  error: string | null;
  contents?: Buffer;
  /** Review-only preview for rejected artwork; never used to insert a listing. */
  previewContents?: Buffer;
  fileName?: string;
  filePath?: string;
};
export type ListingZipReviewPlan = {
  input: Context;
  context: ResolvedContext;
  target: Awaited<ReturnType<typeof loadImportTemplate>>['target'];
  productType: 'physical' | 'digital';
  rows: ListingZipReviewRow[];
};
type PreparedRow = ListingZipReviewRow & { contents: Buffer; width: number; height: number; orientation: 'portrait' | 'landscape'; fileName: string; filePath: string };

export class ListingZipImportError extends Error {
  constructor(message: string, readonly status = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ListingZipImportError';
  }
}

export function listingZipImportContext(input: Record<string, unknown>): Context {
  const keys = ['shopId', 'sectionId', 'subSectionId'] as const;
  for (const key of keys) {
    const value = input[key];
    if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) < 1n
      || (key !== 'shopId' && !Number.isSafeInteger(Number(value)))) throw new ListingZipImportError('Missing or invalid listing context.');
  }
  return Object.fromEntries(keys.map((key) => [key, input[key]])) as Context;
}

async function loadContext(input: Context) {
  listingZipImportContext(input);
  try { return await getListingContext(input.shopId, input.sectionId, input.subSectionId); }
  catch (error) {
    if (error instanceof Error && /not found\.$/.test(error.message)) throw new ListingZipImportError(error.message, 404);
    throw error;
  }
}

export async function getListingZipImportTemplates(input: Context) {
  const context = await loadContext(input);
  const templates = await prisma.ourCategory.findMany({ where: { shopId: context.shop.id, templateType: 'single', itemCount: 1 },
    select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  return { templates: templates.map((template) => ({ id: String(template.id), name: template.name, templateType: 'single' as const, itemCount: 1 })) };
}

function rowError(row: Pick<ArchiveRow, 'rowNumber'>, message: string, status = 400) {
  return new ListingZipImportError(`CSV row ${row.rowNumber}: ${message}`, status);
}

function validateRow(row: Pick<ArchiveRow, 'rowNumber' | 'title' | 'description'>, previous: Array<Pick<ArchiveRow, 'title'>>) {
  if (!row.title || row.title.length > 100) throw rowError(row, 'The title must contain 1 to 100 characters.');
  if (/[<>:"/\\|?*\x00-\x1F]/.test(row.title) || /[. ]$/.test(row.title) || row.title === '.' || row.title === '..'
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(row.title)) throw rowError(row, 'The title cannot be used as a listing folder name.');
  if (row.description.length > DESCRIPTION_LIMIT) throw rowError(row, `The description must contain no more than ${DESCRIPTION_LIMIT} characters.`);
  if (previous.some((other) => nameCollator.compare(other.title, row.title) === 0)) {
    throw rowError(row, `The title "${row.title}" duplicates another row in this ZIP. Choose Skip to continue.`);
  }
}

async function existingNames(client: Pick<Prisma.TransactionClient, 'etsyListing'>, context: ResolvedContext) {
  const rows = await client.etsyListing.findMany({
    // Storage omits subsection names, so every subsection of this section shares its namespace.
    where: { shopId: context.shop.etsyShopId.toString(), OR: [
      { subSection: { is: { shopSectionId: context.section.id } } },
      ...(context.section.etsyShopSectionId === null ? [] : [{ subSectionId: null, shopSectionId: Number(context.section.etsyShopSectionId) }]),
    ] },
    select: { title: true, localDirectoryName: true },
  });
  return rows.flatMap((row) => [row.title, row.localDirectoryName].filter((name): name is string => name !== null));
}

function assertNoCollisions(rows: Array<Pick<ArchiveRow, 'title' | 'rowNumber'>>, names: string[]) {
  for (const row of rows) if (names.some((name) => nameCollator.compare(name.trim(), row.title) === 0)) {
    throw rowError(row, `A listing or folder named "${row.title}" already exists in this section. Choose Skip to continue.`, 409);
  }
}

function isMissing(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }

async function storageNames(context: ResolvedContext) {
  const sectionPath = getSectionDirectoryPath(context.shop.displayName, context.section.title);
  const previewSectionPath = path.join(ETSY_LISTINGS_DIRECTORY, '.app-previews', path.relative(ETSY_LISTINGS_DIRECTORY, sectionPath));
  const names: string[] = [];
  for (const directory of [sectionPath, previewSectionPath]) {
    try { names.push(...await readdir(directory)); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
  return names;
}

/** In-memory image preflight; never reads or mutates the database or storage. */
export async function prepareListingZipArtwork(row: ArtworkRow) {
  if (row.image.length > LISTING_IMPORT_ARCHIVE_LIMITS.imageBytes) throw rowError(row, 'The artwork must be 60 MB or smaller.');
  const extension = path.extname(row.originalFileName).toLowerCase();
  const format = extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : extension === '.png' ? 'png' : extension === '.webp' ? 'webp' : null;
  if (!format) throw rowError(row, 'Choose a JPG, PNG, or WEBP artwork image.');
  let metadata: Metadata;
  try {
    // Reading headers does not decode the pixels. Inspect dimensions first so a
    // genuine pixel-limit error can identify the image rather than blame its format.
    metadata = await sharp(row.image, { failOn: 'error', limitInputPixels: false }).metadata();
  } catch {
    throw rowError(row, `The artwork headers in "${row.relativeFilename}" could not be read. Re-export it as a valid JPG, PNG, or WEBP.`);
  }
  const dimensions = metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : 'unknown dimensions';
  const detectedFormat = metadata.format?.toUpperCase() ?? 'unknown format';
  if (metadata.format !== format) throw rowError(row, `The artwork contents (${detectedFormat}, ${dimensions}) do not match the filename extension in "${row.relativeFilename}".`);
  if (!metadata.width || !metadata.height) throw rowError(row, `The ${detectedFormat} artwork "${row.relativeFilename}" does not contain valid image dimensions.`);
  if ((metadata.pages ?? 1) > 1) throw rowError(row, `The ${detectedFormat} artwork "${row.relativeFilename}" (${dimensions}) contains ${metadata.pages} pages or frames. Choose a single image.`);
  try {
    if (format === 'png' && (metadata.orientation === undefined || metadata.orientation === 1)) {
      // Fully decode the pixels with the manual-upload limit, then retain the
      // source's lossless compression and colour profile when no rotation is needed.
      await sharp(row.image, { failOn: 'error' }).stats();
      return { contents: row.image, width: metadata.width, height: metadata.height,
        orientation: metadata.width > metadata.height ? 'landscape' as const : 'portrait' as const };
    }
    // Do not crop an imported image to an unrelated ratio. Set Size remains available afterwards.
    // Keep Sharp's default pixel guard, exactly as manual thumbnail upload does.
    const normalized = await sharp(row.image, { failOn: 'error' }).rotate().png().toBuffer({ resolveWithObject: true });
    return { contents: normalized.data, width: normalized.info.width, height: normalized.info.height,
      orientation: normalized.info.width > normalized.info.height ? 'landscape' as const : 'portrait' as const };
  } catch (error) {
    if (error instanceof Error && /exceeds pixel limit/i.test(error.message)) {
      const megapixels = ((metadata.width * metadata.height) / 1_000_000).toFixed(1);
      throw rowError(row, `The ${detectedFormat} artwork "${row.relativeFilename}" is ${dimensions} (${megapixels} MP), which exceeds the safe image limit used by manual uploads. Choose an image within that limit.`);
    }
    throw rowError(row, `The ${detectedFormat} artwork "${row.relativeFilename}" (${dimensions}) could not be decoded. Re-export this file as a complete JPG, PNG, or WEBP.`);
  }
}

/** Retain a small preview of rejected oversized artwork, never its original. */
async function prepareOversizedArtworkPreview(row: ArtworkRow) {
  const source = sharp(row.image, { failOn: 'error' });
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1
    || !['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) return null;
  const preview = await source.rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const rotated = metadata.orientation !== undefined && metadata.orientation >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  return { previewContents: preview.data, width, height, orientation: width > height ? 'landscape' as const : 'portrait' as const };
}

async function cleanup(paths: string[]) {
  const failures: unknown[] = [];
  for (const filePath of paths) {
    try { await unlink(filePath); }
    catch (error) { if (!isMissing(error)) failures.push(error); }
  }
  return failures;
}

async function loadImportTemplate(context: ResolvedContext, templateId: unknown) {
  if (typeof templateId !== 'string' || !/^[1-9]\d*$/.test(templateId) || !Number.isSafeInteger(Number(templateId))) throw new ListingZipImportError('Choose a template.');
  const target = await prisma.ourCategory.findFirst({ where: { id: Number(templateId), shopId: context.shop.id }, include: { downloadSection: true } });
  if (!target) throw new ListingZipImportError('The selected template was not found for this shop.', 404);
  if (target.templateType !== 'single' || target.itemCount !== 1) throw new ListingZipImportError('Choose a single-item template. ZIP rows do not contain grouped artwork.');
  if (target.digitalDownload && (!target.downloadSection?.etsyShopSectionId || target.downloadSection.etsyShopId !== context.shop.etsyShopId)) {
    throw new ListingZipImportError('The selected template needs a valid Digital Download Etsy section in this shop.');
  }
  const customisation = effectiveListingCustomisation(target, null);
  const productType = !target.printsFrames && target.digitalDownload ? 'digital' as const : 'physical' as const;
  const products = buildListingProductDefinitions({ numberOfItems: 1, includeAllItems: false }, {
    printsFrames: target.printsFrames || customisation.customisePrints, digitalDownload: target.digitalDownload,
    ...getTemplateProductOptions(target, productType),
  });
  if ((target.printsFrames || customisation.customisePrints || target.digitalDownload) && !products.length) throw new ListingZipImportError('The selected template has no enabled product sizes.');
  return { target, productType };
}

/** Prepare a review in memory. Individual row errors remain visible and skippable. */
export async function prepareListingZipReview(input: Context, templateId: unknown, file: File): Promise<ListingZipReviewPlan> {
  if (typeof templateId !== 'string' || !/^[1-9]\d*$/.test(templateId) || !Number.isSafeInteger(Number(templateId))) throw new ListingZipImportError('Choose a template.');
  if (!(file instanceof File) || !file.size || !/\.zip$/i.test(file.name)) throw new ListingZipImportError('Choose a ZIP file.');
  if (file.size > LISTING_IMPORT_ARCHIVE_LIMITS.zipBytes) throw new ListingZipImportError('The ZIP file must be 500 MB or smaller.');
  const context = await loadContext(input);
  const { target, productType } = await loadImportTemplate(context, templateId);
  let archive: Awaited<ReturnType<typeof parseListingImportArchive>>;
  try { archive = await parseListingImportArchive(Buffer.from(await file.arrayBuffer())); }
  catch (error) { throw new ListingZipImportError(error instanceof Error ? error.message : 'The ZIP archive is invalid.'); }
  if (!archive.rows.length) throw new ListingZipImportError('The CSV does not contain any listings.');
  const databaseNames = await existingNames(prisma, context);
  const storedNames = await storageNames(context);
  const rows: ListingZipReviewRow[] = [];
  let normalizedBytes = 0;
  for (const [index, row] of archive.rows.entries()) {
    const { image: _source, ...metadata } = row;
    const value: ListingZipReviewRow = { ...metadata, width: null, height: null, orientation: null, error: null };
    try { validateRow(row, archive.rows.slice(0, index)); }
    catch (error) { value.error = error instanceof Error ? error.message : `CSV row ${row.rowNumber}: The listing is invalid.`; }
    if (row.image.length > LISTING_IMPORT_ARCHIVE_LIMITS.imageBytes) {
      const megabytes = (Math.ceil(row.image.length / (1024 * 1024) * 10) / 10).toFixed(1);
      value.error = rowError(row, `Skipping this image because it exceeds the 60 MB per-image limit (${megabytes} MB). Choose Skip to continue.`).message;
      try {
        const preview = await prepareOversizedArtworkPreview(row);
        if (preview && normalizedBytes + preview.previewContents.length <= LISTING_IMPORT_ARCHIVE_LIMITS.expandedBytes) {
          normalizedBytes += preview.previewContents.length;
          Object.assign(value, preview);
        }
      } catch { /* Invalid or unsafe artwork can still be reviewed and skipped. */ }
      rows.push(value);
      continue;
    }
    try {
      const artwork = await prepareListingZipArtwork(row);
      if (normalizedBytes + artwork.contents.length > LISTING_IMPORT_ARCHIVE_LIMITS.expandedBytes) {
        throw rowError(row, 'The normalized artwork batch is too large. Import fewer listings at a time.');
      }
      normalizedBytes += artwork.contents.length;
      Object.assign(value, artwork);
      value.fileName = `import-${randomUUID()}.png`;
      if (!value.error) value.filePath = path.join(getListingDirectoryPath(context.shop.displayName, context.section.title, context.subSection.name, row.title), 'thumbnail', value.fileName);
    } catch (error) { value.error ??= error instanceof Error ? error.message : `CSV row ${row.rowNumber}: The artwork is invalid.`; }
    try { assertNoCollisions([row], [...databaseNames, ...storedNames]); }
    catch (error) { value.error ??= error instanceof Error ? error.message : `CSV row ${row.rowNumber}: The listing already exists.`; }
    rows.push(value);
  }
  return { input, context, target, productType, rows };
}

function requirePreparedRow(row: ListingZipReviewRow | undefined): asserts row is PreparedRow {
  if (!row) throw new ListingZipImportError('The review row is invalid.');
  if (row.error) throw new ListingZipImportError(row.error, /already exists|duplicates another/.test(row.error) ? 409 : 400);
  if (!row.contents || !row.fileName || !row.filePath || !row.width || !row.height || !row.orientation) {
    throw new ListingZipImportError('This review artwork is no longer available. Upload the ZIP again.', 410);
  }
}

async function persistReviewRows(plan: ListingZipReviewPlan, prepared: PreparedRow[]) {
  const { context, target, productType } = plan;
  const written: string[] = [];
  let transactionStarted = false;
  let listingIds: number[] = [];
  try {
    for (const row of prepared) {
      // Register before writing: an unsuccessful upload can still have created its original or WebP.
      written.push(row.filePath);
      await writeFile(row.filePath, row.contents);
    }
    transactionStarted = true;
    listingIds = await prisma.$transaction(async (transaction) => {
      const section = await transaction.$queryRaw<Array<{ id: number; title: string }>>`
        SELECT id, title FROM etsy_shop_sections WHERE id = ${context.section.id} AND title = ${context.section.title}
          AND (shopId = ${context.shop.id} OR etsyShopId = ${context.shop.etsyShopId})
          AND etsyShopSectionId <=> ${context.section.etsyShopSectionId} FOR UPDATE`;
      if (!section.length || section[0].title !== context.section.title) throw new ListingZipImportError('The section changed. Reload it and try again.', 409);
      const shop = await transaction.etsyShop.findUnique({ where: { id: context.shop.id }, select: { etsyShopId: true, shopName: true, title: true } });
      if (!shop || shop.etsyShopId !== context.shop.etsyShopId || shop.shopName !== context.shop.shopName || shop.title !== context.shop.title) {
        throw new ListingZipImportError('The shop changed. Reload it and try again.', 409);
      }
      const subSection = await transaction.etsyShopSubSection.findFirst({ where: { id: context.subSection.id, name: context.subSection.name, shopSectionId: context.section.id } });
      if (!subSection) throw new ListingZipImportError('The subsection changed. Reload it and try again.', 409);
      const currentTarget = await transaction.ourCategory.findFirst({ where: { id: target.id, shopId: context.shop.id } });
      if (!currentTarget || currentTarget.updatedAt.getTime() !== target.updatedAt.getTime()) throw new ListingZipImportError('The selected template changed. Reload it and try again.', 409);
      assertNoCollisions(prepared, await existingNames(transaction, context));
      const ids: number[] = [];
      for (const row of prepared) {
        const created = await createLocalListingRowInTransaction(transaction, context, row.title,
          { numberOfItems: 1, includeAllItems: false, etsyProductType: productType, ourCategoryId: target.id });
        const now = new Date();
        await transaction.etsyListing.update({ where: { id: created.listing.id }, data: {
          description: row.description, listingDescription: row.description, backgroundColour: '#F5F0E8',
          thumbnailFileName: row.fileName, thumbnailOriginalFileName: row.originalFileName, thumbnailUpdatedAt: now,
          thumbnailWidthPixels: row.width, thumbnailHeightPixels: row.height, artworkOrientation: row.orientation,
          detailsChanged: true, imagesChanged: true, lastLocalChangeAt: now,
        } });
        ids.push(created.listing.id);
      }
      return ids;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
  } catch (error) {
    if (transactionStarted) {
      // A lost commit acknowledgement must not unlink artwork now referenced by committed listings.
      let owners;
      try { owners = await prisma.etsyListing.findMany({ where: { shopId: context.shop.etsyShopId.toString(), thumbnailFileName: { in: prepared.map((row) => row.fileName) } }, select: { id: true, thumbnailFileName: true } }); }
      catch { throw new ListingZipImportError('The import result could not be confirmed. Reload the listings before retrying; staged artwork was retained.', 503, { cause: error }); }
      if (owners.length === prepared.length) listingIds = owners.map((row) => row.id);
      else {
        const owned = new Set(owners.map((row) => row.thumbnailFileName));
        const failures = await cleanup(written.filter((value) => !owned.has(path.basename(value))));
        if (failures.length) throw new ListingZipImportError('The import failed and some staged artwork could not be removed. Cleanup must be retried.', 503, { cause: new AggregateError([error, ...failures]) });
        if (owners.length) throw new ListingZipImportError('The import result changed before it could be confirmed. Reload the listings before retrying.', 503, { cause: error });
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ListingZipImportError('A listing with one of these titles was created during the import. Reload and try again.', 409);
        throw error;
      }
    } else {
      const failures = await cleanup(written);
      if (failures.length) throw new ListingZipImportError('The import failed and some staged artwork could not be removed. Cleanup must be retried.', 503, { cause: new AggregateError([error, ...failures]) });
      throw error;
    }
  }
  return { listingIds: listingIds.map(String) };
}

/** Commit exactly one reviewed row. Session state records success before reloading table data. */
export async function insertListingZipReviewRow(plan: ListingZipReviewPlan, index: number) {
  if (!Number.isSafeInteger(index) || index < 0) throw new ListingZipImportError('The review row is invalid.');
  const row = plan.rows[index];
  requirePreparedRow(row);
  validateRow(row, []);
  const context = await loadContext(plan.input);
  if (context.shop.etsyShopId !== plan.context.shop.etsyShopId || context.shop.id !== plan.context.shop.id
    || context.shop.shopName !== plan.context.shop.shopName || context.shop.title !== plan.context.shop.title
    || context.shop.displayName !== plan.context.shop.displayName || context.section.id !== plan.context.section.id
    || context.section.title !== plan.context.section.title || context.section.etsyShopSectionId !== plan.context.section.etsyShopSectionId
    || context.subSection.id !== plan.context.subSection.id
    || context.subSection.name !== plan.context.subSection.name) throw new ListingZipImportError('The import location changed. Upload the ZIP again.', 409);
  let owners;
  try {
    owners = await prisma.etsyListing.findMany({ where: {
      shopId: context.shop.etsyShopId.toString(), thumbnailFileName: { in: [row.fileName] },
    }, select: { id: true, shopId: true, subSectionId: true, localDirectoryName: true, thumbnailFileName: true } });
  } catch (error) {
    throw new ListingZipImportError('The previous Insert result could not be checked. Retry Insert when the database is available; no new artwork was uploaded.', 503, { cause: error });
  }
  if (owners.length) {
    const owner = owners[0];
    if (owners.length !== 1 || !Number.isSafeInteger(owner.id) || owner.id < 1
      || owner.shopId !== context.shop.etsyShopId.toString() || owner.subSectionId !== context.subSection.id
      || owner.localDirectoryName !== row.title || owner.thumbnailFileName !== row.fileName) {
      throw new ListingZipImportError('The previous Insert result is ambiguous or its listing location changed. Reload the listings before continuing; existing artwork was retained.', 503);
    }
    // The UUID belongs to this row, so a lost commit confirmation can be
    // recovered without uploading again, overwriting artwork, or creating a duplicate.
    return { listingIds: [String(owner.id)] };
  }
  const { target } = await loadImportTemplate(context, String(plan.target.id));
  if (target.updatedAt.getTime() !== plan.target.updatedAt.getTime()) throw new ListingZipImportError('The selected template changed. Upload the ZIP again.', 409);
  assertNoCollisions([row], await existingNames(prisma, context));
  assertNoCollisions([row], await storageNames(context));
  return persistReviewRows(plan, [row]);
}

/** Compatibility bulk entry point: retain all-or-nothing validation and database creation. */
export async function importListingZip(input: Context, templateId: unknown, file: File) {
  const plan = await prepareListingZipReview(input, templateId, file);
  for (const row of plan.rows) requirePreparedRow(row);
  const result = await persistReviewRows(plan, plan.rows as PreparedRow[]);
  let data;
  try { data = await getSubSectionListingsPageData(input.shopId, input.sectionId, input.subSectionId); }
  catch (error) { throw new ListingZipImportError('The listings were imported, but the page could not be reloaded. Reload the section before importing again.', 503, { cause: error }); }
  if (!data) throw new ListingZipImportError('The listings were imported, but the page could not be reloaded. Reload the section before importing again.', 503);
  return { data, importedCount: result.listingIds.length, listingIds: result.listingIds };
}
