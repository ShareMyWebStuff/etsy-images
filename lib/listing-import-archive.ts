import path from 'node:path';
import { TextDecoder } from 'node:util';
import { crc32 } from 'node:zlib';
import { parse } from 'csv-parse/sync';
import { fromBufferPromise, type Entry, type ZipFile } from 'yauzl';

const MIB = 1024 * 1024;

export const LISTING_IMPORT_ARCHIVE_LIMITS = Object.freeze({
  zipBytes: 400 * MIB,
  expandedBytes: 500 * MIB,
  entries: 2000,
  listings: 100,
  imageBytes: 25 * MIB,
  csvBytes: 2 * MIB,
});

export type ListingImportArchiveRow = {
  rowNumber: number;
  title: string;
  description: string;
  relativeFilename: string;
  image: Buffer;
  originalFileName: string;
};

class ArchiveInputError extends Error {}

function invalid(message: string): never {
  throw new ArchiveInputError(message);
}

function comparisonKey(value: string) {
  return value.normalize('NFC').toLowerCase();
}

/** Validate before resolving: normalizing away '..' would conceal unsafe input. */
function archivePath(value: string, context = 'The ZIP'): string {
  const forward = value.replace(/\\/g, '/');
  if (!forward || forward.startsWith('/') || /^[a-z]:/i.test(forward)
    || /[\u0000-\u001f\u007f<>:"|?*]/.test(forward)
    || forward.split('/').includes('..')) {
    return invalid(`${context} contains an unsafe relative filename: ${value || '(empty)'}.`);
  }
  const normalized = forward.split('/').filter((part) => part && part !== '.').join('/');
  if (!normalized) return invalid(`${context} contains an empty filename.`);
  return normalized.normalize('NFC');
}

type StoredEntry = { entry: Entry; name: string; directory: boolean };

async function entriesInArchive(zip: ZipFile): Promise<StoredEntry[]> {
  if (zip.entryCount > LISTING_IMPORT_ARCHIVE_LIMITS.entries) {
    invalid('The ZIP may contain no more than 2,000 entries.');
  }
  const entries: StoredEntry[] = [], seen = new Set<string>();
  let expanded = 0;
  for await (const entry of zip.eachEntry()) {
    if (entries.length >= LISTING_IMPORT_ARCHIVE_LIMITS.entries) invalid('The ZIP may contain no more than 2,000 entries.');
    const name = archivePath(entry.fileName), key = comparisonKey(name);
    if (seen.has(key)) invalid(`The ZIP contains duplicate filenames: ${name}.`);
    seen.add(key);
    if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x40)) invalid('Encrypted ZIP entries are not supported.');
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) invalid(`The ZIP uses unsupported compression for ${name}.`);
    const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
    if (kind === 0xa000) invalid(`Symbolic links are not allowed in the ZIP: ${name}.`);
    if (kind && kind !== 0x8000 && kind !== 0x4000) invalid(`The ZIP contains an unsupported file type: ${name}.`);
    const directory = entry.fileName.endsWith('/') || kind === 0x4000;
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0
      || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) invalid(`The ZIP contains an invalid entry size: ${name}.`);
    if (directory && entry.uncompressedSize) invalid(`The ZIP contains a nonempty directory entry: ${name}.`);
    expanded += entry.uncompressedSize;
    if (expanded > LISTING_IMPORT_ARCHIVE_LIMITS.expandedBytes) invalid('The ZIP must expand to 500 MB or less.');
    entries.push({ entry, name, directory });
  }
  return entries;
}

async function readEntry(zip: ZipFile, stored: StoredEntry, limit: number, retain: boolean): Promise<Buffer> {
  if (stored.entry.uncompressedSize > limit) invalid(`${stored.name} exceeds the allowed ${limit === LISTING_IMPORT_ARCHIVE_LIMITS.csvBytes ? '2 MB CSV' : '25 MB image'} size.`);
  const header = await zip.readLocalFileHeaderPromise(stored.entry);
  if (header.generalPurposeBitFlag & 0x41) invalid('Encrypted ZIP entries are not supported.');
  if (header.compressionMethod !== stored.entry.compressionMethod) invalid(`The ZIP contains a corrupt entry: ${stored.name}.`);
  const stream = await zip.openReadStreamPromise(stored.entry);
  const chunks: Buffer[] = [];
  let length = 0, checksum = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    length += chunk.length;
    if (length > limit || length > stored.entry.uncompressedSize) invalid(`The ZIP entry expands beyond its allowed size: ${stored.name}.`);
    checksum = crc32(chunk, checksum);
    if (retain) chunks.push(chunk);
  }
  // yauzl validates entry sizes, but deliberately does not check file-data CRCs.
  if (length !== stored.entry.uncompressedSize || checksum !== stored.entry.crc32) invalid(`The ZIP contains a corrupt entry: ${stored.name}.`);
  return retain ? Buffer.concat(chunks, length) : Buffer.alloc(0);
}

type CsvRow = Omit<ListingImportArchiveRow, 'image' | 'originalFileName'> & { imageKey: string };

function csvRows(contents: Buffer, csvName: string): CsvRow[] {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(contents); }
  catch { return invalid('overview.csv must use UTF-8 text encoding.'); }
  const folder = path.posix.dirname(csvName), titles = new Set<string>();
  const rows: CsvRow[] = [];
  let rowNumber = 0, headerSkipped = false;
  try {
    parse(text, {
      bom: true,
      relax_column_count: true,
      max_record_size: LISTING_IMPORT_ARCHIVE_LIMITS.csvBytes,
      // Validate records as they arrive, so a CSV full of blank lines does not
      // allocate an unbounded array and the 101st listing fails immediately.
      on_record(record: string[]) {
        rowNumber++;
        if (record.every((field) => !field.trim())) return null;
        if (!headerSkipped) { headerSkipped = true; return null; }
        if (record.length !== 3) invalid(`overview.csv row ${rowNumber} must contain exactly three fields: title, description, relative filename.`);
        const title = record[0].trim(), description = record[1], filename = record[2].trim();
        if (!title) invalid(`overview.csv row ${rowNumber} needs a title.`);
        if (!filename) invalid(`overview.csv row ${rowNumber} needs a relative filename.`);
        const relativeFilename = archivePath(filename, `overview.csv row ${rowNumber}`);
        const imageKey = comparisonKey(folder === '.' ? relativeFilename : `${folder}/${relativeFilename}`);
        if (titles.has(comparisonKey(title))) invalid(`overview.csv contains a duplicate title on row ${rowNumber}: ${title}.`);
        titles.add(comparisonKey(title));
        if (titles.size > LISTING_IMPORT_ARCHIVE_LIMITS.listings) invalid('overview.csv may contain no more than 100 listings.');
        rows.push({ rowNumber, title, description, relativeFilename, imageKey });
        return null;
      },
    });
    return rows;
  } catch (error) {
    if (error instanceof ArchiveInputError) throw error;
    return invalid(`overview.csv is invalid: ${error instanceof Error ? error.message : 'CSV could not be read'}.`);
  }
}

/** Read and verify the complete archive without extracting anything to disk. */
export async function parseListingImportArchive(buffer: Buffer): Promise<{ rows: ListingImportArchiveRow[] }> {
  if (!Buffer.isBuffer(buffer) || !buffer.length) invalid('Choose a nonempty ZIP archive.');
  if (buffer.length > LISTING_IMPORT_ARCHIVE_LIMITS.zipBytes) invalid('The ZIP must be 400 MB or smaller.');
  let zip: ZipFile | undefined;
  try {
    zip = await fromBufferPromise(buffer, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: false });
    const entries = await entriesInArchive(zip);
    const csvs = entries.filter((file) => !file.directory && comparisonKey(path.posix.basename(file.name)) === 'overview.csv');
    if (csvs.length > 1) invalid('The ZIP contains more than one overview.csv. Include exactly one CSV.');
    if (!csvs.length) invalid('The ZIP is missing overview.csv. Place it at the root or inside one enclosing folder.');
    const csv = csvs[0];
    if (csv.name.split('/').length > 2) invalid('Place overview.csv at the ZIP root or inside one enclosing folder.');
    const rows = csvRows(await readEntry(zip, csv, LISTING_IMPORT_ARCHIVE_LIMITS.csvBytes, true), csv.name);
    if (!rows.length) invalid('overview.csv has no listings after its header.');
    const byName = new Map(entries.filter((file) => !file.directory).map((file) => [comparisonKey(file.name), file]));
    const needed = new Set(rows.map((row) => row.imageKey));
    for (const row of rows) {
      const image = byName.get(row.imageKey);
      if (!image || image === csv) invalid(`The image for overview.csv row ${row.rowNumber} was not found: ${row.relativeFilename}.`);
      if (image.entry.uncompressedSize > LISTING_IMPORT_ARCHIVE_LIMITS.imageBytes) invalid(`The image on overview.csv row ${row.rowNumber} must be 25 MB or smaller: ${row.relativeFilename}.`);
    }
    const images = new Map<string, Buffer>();
    for (const file of entries) {
      if (file === csv) continue;
      const key = comparisonKey(file.name), retain = needed.has(key);
      // Drain unused entries too: corrupt unreferenced files must not silently
      // pass archive validation, and no unused file needs a retained buffer.
      const image = await readEntry(zip, file, retain ? LISTING_IMPORT_ARCHIVE_LIMITS.imageBytes : LISTING_IMPORT_ARCHIVE_LIMITS.expandedBytes, retain);
      if (retain) images.set(key, image);
    }
    return { rows: rows.map(({ imageKey, ...row }) => ({ ...row, image: images.get(imageKey)!, originalFileName: path.posix.basename(row.relativeFilename) })) };
  } catch (error) {
    if (error instanceof ArchiveInputError) throw error;
    throw new Error(`The ZIP archive is corrupt or unsupported: ${error instanceof Error ? error.message : 'ZIP could not be read'}.`, { cause: error });
  } finally { zip?.close(); }
}
