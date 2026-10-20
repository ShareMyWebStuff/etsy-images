import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  unlinkFailure: null as string | null,
}));

function normalized(value: string) {
  return value.replace(/\\/g, '/');
}

function missingObject(filePath: string) {
  return Object.assign(new Error(`Missing ${filePath}`), { code: 'ENOENT' });
}

vi.mock('@/lib/s3-listing-storage', () => ({
  readFile: vi.fn(async (filePath: string) => {
    const contents = storage.objects.get(normalized(filePath));
    if (!contents) throw missingObject(filePath);
    return Buffer.from(contents);
  }),
  unlink: vi.fn(async (filePath: string) => {
    const key = normalized(filePath);
    if (storage.unlinkFailure === key) throw new Error('S3 delete failed');
    if (!storage.objects.delete(key)) throw missingObject(filePath);
  }),
  writeFile: vi.fn(async (filePath: string, contents: Buffer) => {
    storage.objects.set(normalized(filePath), Buffer.from(contents));
  }),
}));

import { removeListingImages } from '@/lib/listing-image-reset';

const listingPath = 'D:/Listings/Current';
const firstPath = normalized(path.join(listingPath, 'first.png'));
const secondPath = normalized(path.join(listingPath, 'second.png'));

beforeEach(() => {
  storage.objects.clear();
  storage.objects.set(firstPath, Buffer.from('first image'));
  storage.objects.set(secondPath, Buffer.from('second image'));
  storage.unlinkFailure = null;
});

describe('removeListingImages', () => {
  it('removes S3 files before deleting their database rows', async () => {
    const deleteDatabaseRows = vi.fn(async () => {
      expect(storage.objects.size).toBe(0);
    });

    await removeListingImages(
      listingPath,
      [{ localFileName: 'first.png' }, { localFileName: 'second.png' }],
      deleteDatabaseRows,
    );

    expect(deleteDatabaseRows).toHaveBeenCalledOnce();
    expect(storage.objects.size).toBe(0);
  });

  it('restores S3 files when the database deletion fails', async () => {
    await expect(removeListingImages(
      listingPath,
      [{ localFileName: 'first.png' }, { localFileName: 'second.png' }],
      async () => { throw new Error('Database delete failed'); },
    )).rejects.toThrow('Database delete failed');

    expect(storage.objects.get(firstPath)?.toString()).toBe('first image');
    expect(storage.objects.get(secondPath)?.toString()).toBe('second image');
  });

  it('restores already removed S3 files when a later S3 deletion fails', async () => {
    storage.unlinkFailure = secondPath;
    const deleteDatabaseRows = vi.fn();

    await expect(removeListingImages(
      listingPath,
      [{ localFileName: 'first.png' }, { localFileName: 'second.png' }],
      deleteDatabaseRows,
    )).rejects.toThrow('S3 delete failed');

    expect(deleteDatabaseRows).not.toHaveBeenCalled();
    expect(storage.objects.get(firstPath)?.toString()).toBe('first image');
    expect(storage.objects.get(secondPath)?.toString()).toBe('second image');
  });

  it('refuses to remove a file outside the listing directory', async () => {
    const deleteDatabaseRows = vi.fn();

    await expect(removeListingImages(
      listingPath,
      [{ localFileName: '../another-listing/image.png' }],
      deleteDatabaseRows,
    )).rejects.toThrow('unsafe file name');

    expect(deleteDatabaseRows).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(2);
  });
});
