import { once } from 'node:events';
import { ZipArchive } from 'archiver';
import { describe, expect, it } from 'vitest';
import { LISTING_IMPORT_ARCHIVE_LIMITS, parseListingImportArchive } from '@/lib/listing-import-archive';

type File = { name: string; contents: string | Buffer; symlink?: boolean };

async function zip(files: File[], store = true): Promise<Buffer> {
  const archive = new ZipArchive({ store, zlib: { level: 1 } }), chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = once(archive, 'end');
  for (const file of files) {
    if (file.symlink) archive.symlink(file.name, String(file.contents));
    else archive.append(file.contents, { name: file.name });
  }
  await archive.finalize(); await finished;
  return Buffer.concat(chunks);
}

const csv = 'title,description,filename\r\nBunny,Little rabbit,ear.png\r\n';
const image = Buffer.from('Image bytes are validated by the import service.');
const files = () => [{ name: 'overview.csv', contents: csv }, { name: 'ear.png', contents: image }];

/** Mutate ZIP metadata for adversarial cases; archiver performs all compression. */
function central(buffer: Buffer, name: string): number {
  for (let cursor = 0; cursor < buffer.length - 46; cursor++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) continue;
    const length = buffer.readUInt16LE(cursor + 28);
    if (buffer.subarray(cursor + 46, cursor + 46 + length).toString() === name) return cursor;
  }
  throw new Error(`Missing fixture entry ${name}`);
}

function rename(buffer: Buffer, from: string, to: string): Buffer {
  const result = Buffer.from(buffer), old = Buffer.from(from), next = Buffer.from(to);
  if (old.length !== next.length) throw new Error('Fixture names must have the same byte length.');
  let offset = 0;
  while ((offset = result.indexOf(old, offset)) >= 0) { next.copy(result, offset); offset += next.length; }
  return result;
}

describe('parseListingImportArchive', () => {
  it('reads image bytes in memory and ignores the CSV header', async () => {
    const result = await parseListingImportArchive(await zip(files()));
    expect(result.rows).toEqual([{ rowNumber: 2, title: 'Bunny', description: 'Little rabbit', relativeFilename: 'ear.png', originalFileName: 'ear.png', image }]);
  });

  it.each([
    ['Windows CRLF', '\r\n'],
    ['Unix LF', '\n'],
    ['classic Mac CR', '\r'],
  ])('automatically reads %s CSV rows without retaining line endings in filenames', async (_name, lineEnding) => {
    const overview = [
      'title,description,filename',
      'Bunny,Little rabbit,Images\\ear.png',
      'Fox,Woodland fox,Images\\fox.webp',
      '',
    ].join(lineEnding);
    const foxImage = Buffer.from('Second image bytes.');
    const result = await parseListingImportArchive(await zip([
      { name: 'Collection/overview.csv', contents: overview },
      { name: 'Collection/Images/ear.png', contents: image },
      { name: 'Collection/Images/fox.webp', contents: foxImage },
    ]));
    expect(result.rows).toEqual([
      { rowNumber: 2, title: 'Bunny', description: 'Little rabbit', relativeFilename: 'Images/ear.png', originalFileName: 'ear.png', image },
      { rowNumber: 3, title: 'Fox', description: 'Woodland fox', relativeFilename: 'Images/fox.webp', originalFileName: 'fox.webp', image: foxImage },
    ]);
    for (const row of result.rows) {
      expect(row.relativeFilename).not.toMatch(/[\r\n]/);
      expect(row.originalFileName).not.toMatch(/[\r\n]/);
    }
  });

  it('supports UTF-8 BOM, CRLF, quotes, commas, embedded newlines and blank rows', async () => {
    const overview = '\uFEFFtitle,description,filename\r\n" Bunny, portrait ","First line\r\nA ""tiny"" rabbit",ear.png\r\n\r\n, ,\r\nFox,,fox.webp\r\n';
    const result = await parseListingImportArchive(await zip([
      { name: 'overview.csv', contents: overview }, { name: 'ear.png', contents: image }, { name: 'fox.webp', contents: 'fox' },
    ]));
    expect(result.rows.map(({ rowNumber, title, description }) => ({ rowNumber, title, description }))).toEqual([
      { rowNumber: 2, title: 'Bunny, portrait', description: 'First line\r\nA "tiny" rabbit' },
      { rowNumber: 5, title: 'Fox', description: '' },
    ]);
  });

  it('resolves Windows paths relative to a single enclosing CSV folder, case-insensitively', async () => {
    const result = await parseListingImportArchive(await zip([
      { name: 'Collection/OVERVIEW.CSV', contents: 'title,description,filename\nRabbit,,Images\\EAR.PNG' },
      { name: 'Collection/Images/ear.png', contents: image },
      { name: 'Collection/unused.txt', contents: 'Extra files are verified but not retained.' },
    ]));
    expect(result.rows[0]).toMatchObject({ relativeFilename: 'Images/EAR.PNG', originalFileName: 'EAR.PNG', image });
  });

  it('accepts actual Windows separators in ZIP entry names', async () => {
    const archive = rename(await zip([
      { name: 'Folder/overview.csv', contents: 'title,description,filename\nRabbit,,Images\\ear.png' },
      { name: 'Folder/Images/ear.png', contents: image },
    ]), 'Folder/Images/ear.png', 'Folder\\Images\\ear.png');
    expect((await parseListingImportArchive(archive)).rows[0].image).toEqual(image);
  });

  it('allows distinct listings to share the same image without retaining duplicate buffers', async () => {
    const result = await parseListingImportArchive(await zip([
      { name: 'overview.csv', contents: 'title,description,filename\nRabbit portrait,First listing,ear.png\nRabbit nursery,Second listing,EAR.PNG' },
      { name: 'ear.png', contents: image },
    ]));
    expect(result.rows.map((row) => row.title)).toEqual(['Rabbit portrait', 'Rabbit nursery']);
    expect(result.rows[0].image).toEqual(image);
    expect(result.rows[1].image).toBe(result.rows[0].image);
  });

  it.each([
    ['missing CSV', [{ name: 'ear.png', contents: image }], /missing overview\.csv/i],
    ['ambiguous CSV', [...files(), { name: 'Folder/overview.csv', contents: csv }], /more than one overview\.csv/i],
    ['deeply nested CSV', [{ name: 'a/b/overview.csv', contents: csv }, { name: 'a/b/ear.png', contents: image }], /one enclosing folder/i],
    ['missing image', [{ name: 'overview.csv', contents: csv }], /row 2.*not found/i],
    ['CSV referenced as image', [{ name: 'overview.csv', contents: 'title,description,filename\nRabbit,,overview.csv' }], /not found/i],
    ['empty CSV', [{ name: 'overview.csv', contents: '' }], /no listings/i],
    ['header only CSV', [{ name: 'overview.csv', contents: 'title,description,filename\n\n' }], /no listings/i],
    ['duplicate archive filenames', [...files(), { name: 'EAR.PNG', contents: 'other' }], /duplicate filenames/i],
  ] as const)('rejects %s', async (_name, input, message) => {
    await expect(parseListingImportArchive(await zip([...input]))).rejects.toThrow(message);
  });

  it.each([
    ['too few fields', 'Rabbit,ear.png', /exactly three fields/i],
    ['too many fields', 'Rabbit,desc,ear.png,extra', /exactly three fields/i],
    ['missing title', ',desc,ear.png', /needs a title/i],
    ['missing filename', 'Rabbit,desc,', /needs a relative filename/i],
    ['duplicate title', 'Rabbit,,ear.png\nrAbBiT,,fox.png', /duplicate title/i],
    ['broken quotes', 'Rabbit,"unfinished,ear.png', /overview\.csv is invalid/i],
    ['parent traversal', 'Rabbit,,../ear.png', /row 2.*unsafe relative filename/i],
    ['absolute path', 'Rabbit,,/ear.png', /row 2.*unsafe relative filename/i],
    ['drive path', 'Rabbit,,C:\\ear.png', /row 2.*unsafe relative filename/i],
  ])('rejects CSV %s', async (_name, line, message) => {
    await expect(parseListingImportArchive(await zip([{ name: 'overview.csv', contents: `title,description,filename\n${line}` }, { name: 'ear.png', contents: image }]))).rejects.toThrow(message);
  });

  it.each(['../ear.png', 'C:/ear.png', '/a/ear.png'])('rejects unsafe archive path %s even when unreferenced', async (unsafe) => {
    const original = 'a'.repeat(unsafe.length - 8) + '/ear.png';
    const archive = rename(await zip([...files(), { name: original, contents: image }]), original, unsafe);
    await expect(parseListingImportArchive(archive)).rejects.toThrow(/unsafe|absolute path|invalid relative path/i);
  });

  it('rejects symbolic links', async () => {
    await expect(parseListingImportArchive(await zip([{ name: 'overview.csv', contents: csv }, { name: 'ear.png', contents: 'outside.png', symlink: true }]))).rejects.toThrow(/symbolic links/i);
  });

  it('rejects encrypted entries before opening their data streams', async () => {
    const archive = await zip(files(), false), offset = central(archive, 'ear.png');
    archive.writeUInt16LE(archive.readUInt16LE(offset + 8) | 1, offset + 8);
    await expect(parseListingImportArchive(archive)).rejects.toThrow(/encrypted/i);
  });

  it('rejects corrupt content, including unreferenced entries', async () => {
    const archive = await zip([...files(), { name: 'unused.txt', contents: 'Verified even though it is not referenced.' }]);
    archive[archive.indexOf('Verified even though')] ^= 1;
    await expect(parseListingImportArchive(archive)).rejects.toThrow(/corrupt entry.*unused\.txt/i);
  });

  it('rejects broken deflate streams and truncated ZIPs', async () => {
    const archive = await zip(files(), false), position = central(archive, 'ear.png');
    const local = archive.readUInt32LE(position + 42), nameLength = archive.readUInt16LE(local + 26), extraLength = archive.readUInt16LE(local + 28);
    archive.fill(255, local + 30 + nameLength + extraLength, local + 33 + nameLength + extraLength);
    await expect(parseListingImportArchive(archive)).rejects.toThrow(/corrupt|invalid/i);
    await expect(parseListingImportArchive(archive.subarray(0, 50))).rejects.toThrow(/corrupt|unsupported/i);
  });

  it('rejects an incorrect declared uncompressed length', async () => {
    const archive = await zip(files(), false), offset = central(archive, 'ear.png');
    archive.writeUInt32LE(1, offset + 24);
    await expect(parseListingImportArchive(archive)).rejects.toThrow(/size|byte|corrupt/i);
  });

  it('rejects a CSV larger than 2 MB and referenced images larger than 35 MB before inflating', async () => {
    expect(LISTING_IMPORT_ARCHIVE_LIMITS.imageBytes).toBe(35 * 1024 * 1024);
    for (const [name, limit, message] of [
      ['overview.csv', LISTING_IMPORT_ARCHIVE_LIMITS.csvBytes, /2 MB CSV/],
      ['ear.png', LISTING_IMPORT_ARCHIVE_LIMITS.imageBytes, /35 MB/],
    ] as const) {
      const archive = await zip(files(), false), offset = central(archive, name);
      archive.writeUInt32LE(limit + 1, offset + 24);
      await expect(parseListingImportArchive(archive)).rejects.toThrow(message);
    }
  });

  it('rejects expanded ZIPs over 500 MB based on central-directory sizes', async () => {
    const archive = await zip(files(), false), offset = central(archive, 'ear.png');
    archive.writeUInt32LE(LISTING_IMPORT_ARCHIVE_LIMITS.expandedBytes, offset + 24);
    await expect(parseListingImportArchive(archive)).rejects.toThrow(/500 MB/i);
  });

  it('rejects more than 2,000 entries and more than 100 listings', async () => {
    const archive = await zip(files()), eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    archive.writeUInt16LE(2001, eocd + 8); archive.writeUInt16LE(2001, eocd + 10);
    await expect(parseListingImportArchive(archive)).rejects.toThrow(/2,000 entries/i);
    const overview = ['title,description,filename', ...Array.from({ length: 101 }, (_, index) => `Artwork ${index},,${index}.png`)].join('\n');
    await expect(parseListingImportArchive(await zip([{ name: 'overview.csv', contents: overview }]))).rejects.toThrow(/100 listings/i);
  });

  it('rejects invalid UTF-8 and an empty/non-ZIP input', async () => {
    await expect(parseListingImportArchive(await zip([{ name: 'overview.csv', contents: Buffer.from([0xff, 0xfe]) }]))).rejects.toThrow(/UTF-8/i);
    await expect(parseListingImportArchive(Buffer.alloc(0))).rejects.toThrow(/nonempty ZIP/i);
    await expect(parseListingImportArchive(Buffer.from('not a ZIP'))).rejects.toThrow(/corrupt|unsupported/i);
  });
});
