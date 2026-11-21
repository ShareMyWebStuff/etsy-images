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
type Context = { shopId: string; sectionId: string; subSectionId: string };
type ResolvedContext = Awaited<ReturnType<typeof getListingContext>>;
type ArchiveRow = Awaited<ReturnType<typeof parseListingImportArchive>>['rows'][number];
type ArtworkRow = Pick<ArchiveRow, 'rowNumber' | 'image' | 'originalFileName' | 'relativeFilename'>;
type PreparedRow = ArchiveRow & { contents: Buffer; width: number; height: number; orientation: 'portrait' | 'landscape'; fileName: string; filePath: string };

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

function validateRow(row: ArchiveRow, previous: ArchiveRow[]) {
  if (!row.title || row.title.length > 100) throw rowError(row, 'The title must contain 1 to 100 characters.');
  if (/[<>:"/\\|?*\x00-\x1F]/.test(row.title) || /[. ]$/.test(row.title) || row.title === '.' || row.title === '..'
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(row.title)) throw rowError(row, 'The title cannot be used as a listing folder name.');
  if (row.description.length > DESCRIPTION_LIMIT) throw rowError(row, `The description must contain no more than ${DESCRIPTION_LIMIT} characters.`);
  if (previous.some((other) => nameCollator.compare(other.title, row.title) === 0)) throw rowError(row, 'The title duplicates another row.');
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

function assertNoCollisions(rows: ArchiveRow[], names: string[]) {
  for (const row of rows) if (names.some((name) => nameCollator.compare(name.trim(), row.title) === 0)) {
    throw rowError(row, `A listing or folder named "${row.title}" already exists in this section.`, 409);
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
  if (row.image.length > LISTING_IMPORT_ARCHIVE_LIMITS.imageBytes) throw rowError(row, 'The artwork must be 25 MB or smaller.');
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

async function prepareRow(row: ArchiveRow, context: ResolvedContext): Promise<PreparedRow> {
  const artwork = await prepareListingZipArtwork(row);
  const fileName = `import-${randomUUID()}.png`;
  return { ...row, ...artwork, fileName,
    filePath: path.join(getListingDirectoryPath(context.shop.displayName, context.section.title, context.subSection.name, row.title), 'thumbnail', fileName) };
}

async function cleanup(paths: string[]) {
  const failures: unknown[] = [];
  for (const filePath of paths) {
    try { await unlink(filePath); }
    catch (error) { if (!isMissing(error)) failures.push(error); }
  }
  return failures;
}

export async function importListingZip(input: Context, templateId: unknown, file: File) {
  if (typeof templateId !== 'string' || !/^[1-9]\d*$/.test(templateId) || !Number.isSafeInteger(Number(templateId))) throw new ListingZipImportError('Choose a template.');
  if (!(file instanceof File) || !file.size || !/\.zip$/i.test(file.name)) throw new ListingZipImportError('Choose a ZIP file.');
  if (file.size > LISTING_IMPORT_ARCHIVE_LIMITS.zipBytes) throw new ListingZipImportError('The ZIP file must be 400 MB or smaller.');
  const context = await loadContext(input);
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
  let archive: Awaited<ReturnType<typeof parseListingImportArchive>>;
  try { archive = await parseListingImportArchive(Buffer.from(await file.arrayBuffer())); }
  catch (error) { throw new ListingZipImportError(error instanceof Error ? error.message : 'The ZIP archive is invalid.'); }
  if (!archive.rows.length) throw new ListingZipImportError('The CSV does not contain any listings.');
  for (const [index, row] of archive.rows.entries()) validateRow(row, archive.rows.slice(0, index));
  assertNoCollisions(archive.rows, await existingNames(prisma, context));
  assertNoCollisions(archive.rows, await storageNames(context));
  const prepared: PreparedRow[] = [];
  let normalizedBytes = 0;
  for (const row of archive.rows) {
    const value = await prepareRow(row, context);
    normalizedBytes += value.contents.length;
    if (normalizedBytes > LISTING_IMPORT_ARCHIVE_LIMITS.expandedBytes) throw rowError(row, 'The normalized artwork batch is too large. Import fewer listings at a time.');
    prepared.push(value);
  }
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
          AND (shopId = ${context.shop.id} OR etsyShopId = ${context.shop.etsyShopId}) FOR UPDATE`;
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
  let data;
  try { data = await getSubSectionListingsPageData(input.shopId, input.sectionId, input.subSectionId); }
  catch (error) { throw new ListingZipImportError('The listings were imported, but the page could not be reloaded. Reload the section before importing again.', 503, { cause: error }); }
  if (!data) throw new ListingZipImportError('The listings were imported, but the page could not be reloaded. Reload the section before importing again.', 503);
  return { data, importedCount: listingIds.length, listingIds: listingIds.map(String) };
}
