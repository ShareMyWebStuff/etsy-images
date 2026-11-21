import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const aws = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = aws.send; },
  CopyObjectCommand: class { constructor(readonly input: unknown) {} },
  DeleteObjectCommand: class { constructor(readonly input: unknown) {} },
  DeleteObjectsCommand: class { constructor(readonly input: unknown) {} },
  GetObjectCommand: class { constructor(readonly input: unknown) {} },
  HeadObjectCommand: class { constructor(readonly input: unknown) {} },
  ListObjectsV2Command: class { constructor(readonly input: unknown) {} },
  PutObjectCommand: class { constructor(readonly input: unknown) {} },
}));

import { removeListingStorage } from '@/lib/s3-listing-storage';

const directory = 'D:/Etsy/EtsyListings/Test Shop/Test Section/Current Listing';
const root = 'Test Shop/Test Section/Current Listing';
const original = `${root}/thumbnail/art.png`, preview = `.app-previews/${original}.webp`;
const files = new Map<string, Buffer>();
const etag = (contents: Buffer) => `"${createHash('md5').update(contents).digest('hex')}"`;
const missing = () => Object.assign(new Error('Missing object'), { $metadata: { httpStatusCode: 404 } });
const conflict = () => Object.assign(new Error('Precondition failed'), { $metadata: { httpStatusCode: 412 } });

function snapshot() { return new Map([...files].map(([key, value]) => [key, Buffer.from(value)])); }

beforeEach(() => {
  files.clear();
  files.set(original, Buffer.from('Exact original PNG bytes'));
  files.set(preview, Buffer.from('Exact existing compressed preview bytes'));
  aws.send.mockReset().mockImplementation(async (command) => {
    const input = command.input, kind = command.constructor.name, value = files.get(input.Key);
    if (kind === 'ListObjectsV2Command') {
      const matches = [...files].filter(([key]) => key.startsWith(input.Prefix)).sort(([first], [second]) => first.localeCompare(second));
      const offset = Number(input.ContinuationToken ?? 0), selected = matches.slice(offset, offset + 2);
      return { IsTruncated: offset + 2 < matches.length, NextContinuationToken: offset + 2 < matches.length ? String(offset + 2) : undefined,
        Contents: selected.map(([Key, body]) => ({ Key, ETag: etag(body), Size: body.length })) };
    }
    if (kind === 'HeadObjectCommand') {
      if (!value) throw missing();
      return { ETag: etag(value), ContentLength: value.length };
    }
    if (kind === 'GetObjectCommand') {
      if (!value) throw missing();
      if (input.IfMatch && input.IfMatch !== etag(value)) throw conflict();
      return { ETag: etag(value), Body: { transformToByteArray: async () => Uint8Array.from(value) } };
    }
    if (kind === 'DeleteObjectCommand') {
      if (value && input.IfMatch && input.IfMatch !== etag(value)) throw conflict();
      files.delete(input.Key); return {};
    }
    if (kind === 'PutObjectCommand') {
      if (value && input.IfNoneMatch === '*') throw conflict();
      files.set(input.Key, Buffer.from(input.Body)); return {};
    }
    throw new Error(`Unexpected S3 operation: ${kind}`);
  });
});

function calls(kind: string) { return aws.send.mock.calls.map(([command]) => command).filter((command) => command.constructor.name === kind); }

describe('removeListingStorage', () => {
  it('removes all original/preview children and markers before deleting the database row, preserving neighbouring prefixes', async () => {
    for (const [key, value] of [
      [root, 'old marker'], [`${root}/`, ''], [`${root}/downloads/guide.pdf`, 'PDF'],
      [`${root}/downloads/prints.zip`, 'ZIP'], [`${root}/video/room.mp4`, 'MP4'], [`${root}/manual.jpg`, 'manual photo'],
      [`.app-previews/${root}`, 'preview marker'], [`.app-previews/${root}/`, ''],
      [`.app-previews/${root}/preview-only.png.webp`, 'orphan preview'],
      [`${root} neighbour/thumbnail/art.png`, 'neighbour'], [`.app-previews/${root} neighbour/a.webp`, 'neighbour preview'],
      ['Test Shop/Another Section/Current Listing/a.png', 'other section'],
    ]) files.set(key, Buffer.from(value));
    const outside = new Map([...files].filter(([key]) => key.includes('neighbour') || key.includes('Another Section')));
    const commit = vi.fn(async () => { expect(files).toEqual(outside); });
    await removeListingStorage(directory, [], commit);
    expect(commit).toHaveBeenCalledOnce();
    expect(files).toEqual(outside);
    expect(calls('PutObjectCommand')).toHaveLength(0);
    expect(calls('DeleteObjectCommand').every((command) => typeof command.input.IfMatch === 'string')).toBe(true);
    expect(calls('GetObjectCommand').every((command) => typeof command.input.IfMatch === 'string')).toBe(true);
  });

  it('backs up every selected object completely before issuing the first deletion', async () => {
    const handler = aws.send.getMockImplementation()!;
    aws.send.mockImplementation(async (command) => {
      if (command.constructor.name === 'DeleteObjectCommand') expect(calls('GetObjectCommand')).toHaveLength(2);
      return handler(command);
    });
    await removeListingStorage(directory, [], async () => undefined);
  });

  it('preserves explicitly reused source files, their exact previews, and excluded directory descendants', async () => {
    const shared = `${root}/shared/source.png`, sharedPreview = `.app-previews/${shared}.webp`;
    const subtree = `${root}/reused`, nested = `${subtree}/nested/art.jpg`, nestedPreview = `.app-previews/${nested}.webp`;
    for (const key of [shared, sharedPreview, nested, nestedPreview]) files.set(key, Buffer.from(key));
    const saved = new Map([...files].filter(([key]) => key !== original && key !== preview));
    await removeListingStorage(directory, [`${directory}/shared/source.png`, `${directory}/reused`], async () => { expect(files).toEqual(saved); });
    expect(calls('GetObjectCommand').map((command) => command.input.Key).sort()).toEqual([original, preview].sort());
  });

  it('restores exact bytes for every file type and preview after a database failure', async () => {
    files.set(`${root}/downloads/art.zip`, Buffer.from([0x50, 0x4b, 0x00, 0xff]));
    files.set(`${root}/video/room.mp4`, Buffer.from([0xff, 0x00, 0x13]));
    files.set(`${root}/downloads/guide.pdf`, Buffer.from('%PDF-1.4'));
    const before = snapshot(), failure = new Error('Database deletion failed');
    await expect(removeListingStorage(directory, [], async () => { expect(files.size).toBe(0); throw failure; })).rejects.toBe(failure);
    expect(files).toEqual(before);
    expect(calls('PutObjectCommand')).toHaveLength(before.size);
    expect(calls('PutObjectCommand').every((command) => command.input.IfNoneMatch === '*')).toBe(true);
  });

  it('retains content headers and user metadata when restoring originals and previews', async () => {
    const handler = aws.send.getMockImplementation()!;
    const headers = {
      ContentType: 'image/png', CacheControl: 'public, max-age=86400', ContentEncoding: 'gzip',
      ContentDisposition: 'attachment; filename="artwork.png"', ContentLanguage: 'en-GB',
      Expires: new Date('2027-01-01T00:00:00Z'), Metadata: { source: 'imported-artwork', collection: 'nursery' },
    };
    const previewHeaders = { ContentType: 'image/webp', CacheControl: 'private, max-age=3600', Metadata: { original: 'art.png' } };
    aws.send.mockImplementation(async (command) => {
      const result = await handler(command);
      return command.constructor.name === 'GetObjectCommand'
        ? { ...result, ...(command.input.Key === original ? headers : previewHeaders) } : result;
    });
    await expect(removeListingStorage(directory, [], async () => { throw new Error('Database deletion failed'); })).rejects.toThrow('Database deletion failed');
    expect(calls('PutObjectCommand').find((command) => command.input.Key === original)?.input)
      .toMatchObject({ ...headers, Body: Buffer.from('Exact original PNG bytes'), IfNoneMatch: '*' });
    expect(calls('PutObjectCommand').find((command) => command.input.Key === preview)?.input)
      .toMatchObject({ ...previewHeaders, Body: Buffer.from('Exact existing compressed preview bytes'), IfNoneMatch: '*' });
  });

  it('does not delete anything if an inventory or backup read fails', async () => {
    const before = snapshot(), handler = aws.send.getMockImplementation()!, commit = vi.fn();
    aws.send.mockImplementation(async (command) => {
      if (command.constructor.name === 'GetObjectCommand' && command.input.Key === preview) throw new Error('Backup unavailable');
      return handler(command);
    });
    await expect(removeListingStorage(directory, [], commit)).rejects.toThrow('Backup unavailable');
    expect(files).toEqual(before); expect(commit).not.toHaveBeenCalled();
    expect(calls('DeleteObjectCommand')).toHaveLength(0); expect(calls('PutObjectCommand')).toHaveLength(0);
  });

  it('restores already removed files on a later S3 deletion failure and keeps the database row', async () => {
    const before = snapshot(), handler = aws.send.getMockImplementation()!, commit = vi.fn();
    aws.send.mockImplementation(async (command) => {
      if (command.constructor.name === 'DeleteObjectCommand' && command.input.Key === preview) throw new Error('Delete denied');
      return handler(command);
    });
    await expect(removeListingStorage(directory, [], commit)).rejects.toThrow('Delete denied');
    expect(files).toEqual(before); expect(commit).not.toHaveBeenCalled();
  });

  it('restores an object deleted by a request whose acknowledgement was lost', async () => {
    const before = snapshot(), handler = aws.send.getMockImplementation()!, commit = vi.fn();
    aws.send.mockImplementation(async (command) => {
      if (command.constructor.name === 'DeleteObjectCommand' && command.input.Key === original) {
        await handler(command); throw new Error('Acknowledgement lost');
      }
      return handler(command);
    });
    await expect(removeListingStorage(directory, [], commit)).rejects.toThrow('Acknowledgement lost');
    expect(files).toEqual(before); expect(commit).not.toHaveBeenCalled();
  });

  it('reports rollback failures, attempts every restoration, and does not hide the original failure', async () => {
    const handler = aws.send.getMockImplementation()!, failure = new Error('Database failed');
    aws.send.mockImplementation(async (command) => {
      if (command.constructor.name === 'PutObjectCommand' && command.input.Key === original) throw new Error('Restore denied');
      return handler(command);
    });
    const outcome = await removeListingStorage(directory, [], async () => { throw failure; }).catch((error) => error);
    expect(outcome.message).toMatch(/could not be restored safely/);
    expect(outcome.cause).toBeInstanceOf(AggregateError);
    expect(outcome.cause.errors).toContain(failure);
    expect(calls('PutObjectCommand')).toHaveLength(2);
    expect(files.get(preview)).toEqual(Buffer.from('Exact existing compressed preview bytes'));
  });

  it('preserves a concurrent replacement using conditional deletes and reports the restoration conflict', async () => {
    const handler = aws.send.getMockImplementation()!, commit = vi.fn(), newer = Buffer.from('Newer artwork');
    aws.send.mockImplementation(async (command) => {
      if (command.constructor.name === 'DeleteObjectCommand' && command.input.Key === original) files.set(original, newer);
      return handler(command);
    });
    const outcome = await removeListingStorage(directory, [], commit).catch((error) => error);
    expect(files.get(original)).toBe(newer); expect(files.has(preview)).toBe(true); expect(commit).not.toHaveBeenCalled();
    expect(outcome.message).toMatch(/could not be restored safely/);
    expect(outcome.cause.errors.some((error: Error) => /newer listing file was preserved/.test(error.message))).toBe(true);
  });

  it('detects newly uploaded keys before deleting database rows and never deletes those new keys', async () => {
    const handler = aws.send.getMockImplementation()!, commit = vi.fn(), added = `${root}/new-upload.png`, before = snapshot();
    aws.send.mockImplementation(async (command) => {
      const value = await handler(command);
      if (command.constructor.name === 'DeleteObjectCommand' && command.input.Key === preview) files.set(added, Buffer.from('New image'));
      return value;
    });
    await expect(removeListingStorage(directory, [], commit)).rejects.toThrow(/changed while deletion was running/);
    expect(commit).not.toHaveBeenCalled(); expect(files.get(added)).toEqual(Buffer.from('New image'));
    for (const [key, contents] of before) expect(files.get(key)).toEqual(contents);
    expect(calls('DeleteObjectCommand').some((command) => command.input.Key === added)).toBe(false);
  });

  it('allows removal of a listing whose original and preview directories are both missing', async () => {
    files.clear(); const commit = vi.fn();
    await removeListingStorage(directory, [], commit);
    expect(commit).toHaveBeenCalledOnce(); expect(calls('GetObjectCommand')).toHaveLength(0); expect(calls('DeleteObjectCommand')).toHaveLength(0);
  });

  it.each([
    'D:/Etsy/EtsyListings', 'D:/Etsy/EtsyListings/Test Shop', 'D:/Etsy/EtsyListings/Test Shop/Test Section',
    `${directory}/thumbnail`, 'D:/Etsy/EtsyListings/.app-previews/Test Shop/Test Section',
    'D:/Etsy/EtsyListings/Test Shop/../Current Listing', 'D:/Other/Test Shop/Test Section/Current Listing',
  ])('refuses unsafe or overly broad directory %s before any S3 request', async (unsafe) => {
    const commit = vi.fn(); await expect(removeListingStorage(unsafe, [], commit)).rejects.toThrow(/exact listing directory|outside the configured root/);
    expect(aws.send).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });

  it('fails before mutations if the inventory exceeds its object or byte backup bounds', async () => {
    for (const oversized of ['objects', 'bytes']) {
      aws.send.mockReset().mockImplementation(async (command) => {
        if (command.constructor.name === 'ListObjectsV2Command') return { Contents: oversized === 'objects'
          ? Array.from({ length: 10_001 }, (_, index) => ({ Key: `${root}/${index}`, ETag: 'etag', Size: 1 }))
          : [{ Key: original, ETag: 'etag', Size: 1024 * 1024 * 1024 + 1 }] };
        throw new Error('No more operations expected');
      });
      const commit = vi.fn(); await expect(removeListingStorage(directory, [], commit)).rejects.toThrow(/too large for safe deletion/);
      expect(calls('GetObjectCommand')).toHaveLength(0); expect(calls('DeleteObjectCommand')).toHaveLength(0); expect(commit).not.toHaveBeenCalled();
    }
  });

  it('does not loop forever or delete objects when S3 pagination is incomplete', async () => {
    aws.send.mockResolvedValue({ IsTruncated: true, Contents: [] });
    const commit = vi.fn(); await expect(removeListingStorage(directory, [], commit)).rejects.toThrow(/inventory could not be completed/);
    expect(aws.send).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
  });
});
