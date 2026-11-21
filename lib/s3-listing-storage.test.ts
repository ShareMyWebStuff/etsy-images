import sharp from 'sharp';
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

import { listGeneratedListingImageFiles, readFile, removeStagedListingThumbnail, rm, unlink, writeFile, writeStagedListingThumbnail } from '@/lib/s3-listing-storage';

beforeEach(() => {
  aws.send.mockReset().mockResolvedValue({});
});

describe('immutable thumbnail gap staging', () => {
  const stagedPath = 'D:/Etsy/EtsyListings/Test Shop/Listing/thumbnail/thumbnail-gap-82b0b16c-1178-4e3b-86a7-774f1f7eaa83.png';
  const key = 'Test Shop/Listing/thumbnail/thumbnail-gap-82b0b16c-1178-4e3b-86a7-774f1f7eaa83.png';

  it('stores both the new PNG and its bounded preview without touching an old thumbnail', async () => {
    const image = await sharp({ create: { width: 800, height: 1000, channels: 4, background: '#e2925080' } }).png().toBuffer();
    await writeStagedListingThumbnail(stagedPath, image);
    expect(aws.send.mock.calls.map(([command]) => command.input.Key)).toEqual([key, `.app-previews/${key}.webp`]);
    expect(Buffer.from(aws.send.mock.calls[0][0].input.Body)).toEqual(image);
    await expect(sharp(Buffer.from(aws.send.mock.calls[1][0].input.Body)).metadata()).resolves.toMatchObject({ format: 'webp', width: 410, height: 512 });
  });

  it('waits for the other upload to settle after one upload fails', async () => {
    const image = await sharp({ create: { width: 8, height: 10, channels: 4, background: '#e2925080' } }).png().toBuffer();
    let finishPreview: () => void = () => undefined;
    let settled = false;
    const failure = new Error('Original upload failed');
    aws.send.mockRejectedValueOnce(failure).mockImplementationOnce(() => new Promise<void>((resolve) => { finishPreview = resolve; }));
    const outcome = writeStagedListingThumbnail(stagedPath, image).then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
    await vi.waitFor(() => expect(aws.send).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    finishPreview();
    expect(await outcome).toBe(failure);
  });

  it('cleans both exact staged keys even if only a preview was written', async () => {
    await removeStagedListingThumbnail(stagedPath);
    expect(aws.send.mock.calls.map(([command]) => command.input.Key)).toEqual([key, `.app-previews/${key}.webp`]);
    expect(aws.send).toHaveBeenCalledTimes(2);
  });

  it('attempts both cleanup deletions even if one fails', async () => {
    aws.send.mockRejectedValueOnce(new Error('Cleanup failed'));
    await expect(removeStagedListingThumbnail(stagedPath)).rejects.toThrow('Cleanup failed');
    expect(aws.send).toHaveBeenCalledTimes(2);
  });

  it.each(['D:/Etsy/EtsyListings/Test Shop/Listing/thumbnail/thumbnail.png', 'D:/Etsy/EtsyListings/Test Shop/Listing/image_1.png'])('refuses operations on an existing or unrelated image %s', async (filePath) => {
    await expect(writeStagedListingThumbnail(filePath, Buffer.from('unused'))).rejects.toThrow('newly staged');
    await expect(removeStagedListingThumbnail(filePath)).rejects.toThrow('newly staged');
    expect(aws.send).not.toHaveBeenCalled();
  });
});

describe('listing image app previews', () => {
  it('stores the unchanged original and a bounded WebP preview', async () => {
    const original = await sharp({
      create: { width: 2_000, height: 1_000, channels: 3, background: '#bc7b54' },
    }).png().toBuffer();

    await writeFile('D:/Etsy/EtsyListings/Test Shop/Listing/image_1.png', original);

    expect(aws.send).toHaveBeenCalledTimes(2);
    const originalPut = aws.send.mock.calls.find(([command]) => command.input.Key === 'Test Shop/Listing/image_1.png')?.[0];
    const previewPut = aws.send.mock.calls.find(([command]) => command.input.Key === '.app-previews/Test Shop/Listing/image_1.png.webp')?.[0];
    expect(Buffer.from(originalPut.input.Body)).toEqual(original);
    const preview = Buffer.from(previewPut.input.Body);
    await expect(sharp(preview).metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 512,
      height: 256,
    });
  });

  it('returns a useful message when an S3 read times out', async () => {
    aws.send.mockRejectedValueOnce(Object.assign(new Error(''), {
      name: 'TimeoutError',
      code: 'ETIMEDOUT',
    }));

    await expect(readFile('D:/Etsy/EtsyListings/Test Shop/Listing/image_1.png'))
      .rejects.toThrow('S3 timed out while reading the stored file "Test Shop/Listing/image_1.png". Please try again.');
  });
});

describe('paired image deletion and generated-file discovery', () => {
  const directory = 'D:/Etsy/EtsyListings/Test Shop/Listing';
  const key = 'Test Shop/Listing/template-42.png';
  const previewKey = `.app-previews/${key}.webp`;
  const missing = () => Object.assign(new Error('Not found'), { $metadata: { httpStatusCode: 404 } });

  it('removes a preview-only leftover even when its original is already missing', async () => {
    aws.send.mockImplementation(async (command) => {
      if (command.constructor.name === 'HeadObjectCommand') {
        if (command.input.Key === key) throw missing();
        return { ContentLength: 5 };
      }
      return {};
    });
    await unlink(`${directory}/template-42.png`);
    expect(aws.send.mock.calls.filter(([command]) => command.constructor.name === 'DeleteObjectCommand').map(([command]) => command.input.Key))
      .toEqual([key, previewKey]);
  });

  it('reports a truly missing original and preview without pretending a storage error was a missing file', async () => {
    aws.send.mockRejectedValue(missing());
    await expect(unlink(`${directory}/template-42.png`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(aws.send.mock.calls.some(([command]) => command.constructor.name === 'DeleteObjectCommand')).toBe(false);
    aws.send.mockReset().mockRejectedValue(new Error('Access denied'));
    await expect(unlink(`${directory}/template-42.png`)).rejects.toThrow('Access denied');
  });

  it('settles both deletion requests before exposing failure to restoration code, and permits cleanup retry', async () => {
    let finishPreview: () => void = () => undefined;
    let settled = false;
    aws.send.mockImplementation(async (command) => {
      if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: 5 };
      if (command.input.Key === key) throw new Error('Original delete failed');
      return new Promise<void>((resolve) => { finishPreview = resolve; });
    });
    const outcome = unlink(`${directory}/template-42.png`).then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
    await vi.waitFor(() => expect(aws.send.mock.calls.filter(([command]) => command.constructor.name === 'DeleteObjectCommand')).toHaveLength(2));
    expect(settled).toBe(false);
    finishPreview();
    expect((await outcome)?.message).toBe('Original delete failed');
    aws.send.mockReset().mockResolvedValue({ ContentLength: 5 });
    await expect(unlink(`${directory}/template-42.png`)).resolves.toBeUndefined();
  });

  it('discovers paginated originals and preview-only generated files without including thumbnails, downloads or neighbours', async () => {
    const prefix = 'Test Shop/Listing/';
    const smallPrefix = `.app-previews/${prefix}`;
    aws.send.mockImplementation(async (command) => {
      const input = command.input;
      if (input.Prefix === prefix && !input.ContinuationToken) return { IsTruncated: true, NextContinuationToken: 'second', Contents: [
        { Key: `${prefix}template-42.png` }, { Key: `${prefix}thumbnail/thumbnail.png` }, { Key: `${prefix}manual-photo.png` },
        { Key: 'Test Shop/Listing neighbour/template-93.png' }, { Key: `${prefix}template-0.png` },
      ] };
      if (input.Prefix === prefix && input.ContinuationToken === 'second') return { Contents: [{ Key: `${prefix}template-43.png` }] };
      if (input.Prefix === smallPrefix) return { Contents: [
        { Key: `${smallPrefix}template-42.png.webp` }, { Key: `${smallPrefix}template-44.png.webp` },
        { Key: `${smallPrefix}downloads/template-99.png.webp` }, { Key: `${smallPrefix}manual-photo.png.webp` }, { Key: `${smallPrefix}template-45.png` },
      ] };
      throw new Error(`Unexpected listing prefix: ${input.Prefix}`);
    });
    expect(await listGeneratedListingImageFiles(directory)).toEqual(['template-42.png', 'template-43.png', 'template-44.png']);
    expect(aws.send.mock.calls).toHaveLength(3);
    expect(aws.send.mock.calls.every(([command]) => command.input.Delimiter === '/')).toBe(true);
  });

  it('does not claim cleanup success when S3 reports a partial batch deletion failure', async () => {
    aws.send.mockImplementation(async (command) => {
      if (command.constructor.name === 'ListObjectsV2Command') return command.input.Prefix === 'Test Shop/Listing/' ? { Contents: [{ Key: key }] } : {};
      if (command.constructor.name === 'HeadObjectCommand') throw missing();
      if (command.constructor.name === 'DeleteObjectsCommand') return { Errors: [{ Key: key, Code: 'AccessDenied', Message: 'Access denied' }] };
      return {};
    });
    await expect(rm(directory, { recursive: true })).rejects.toThrow('S3 could not delete 1 stored file');
  });

  it('waits for a late image upload before allowing a failed write to be cleaned', async () => {
    const image = await sharp({ create: { width: 8, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    let finishPreview: () => void = () => undefined;
    let settled = false;
    aws.send.mockRejectedValueOnce(new Error('Original upload failed')).mockImplementationOnce(() => new Promise<void>((resolve) => { finishPreview = resolve; }));
    const outcome = writeFile(`${directory}/template-42.png`, image).then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
    await vi.waitFor(() => expect(aws.send).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    finishPreview();
    expect((await outcome)?.message).toBe('Original upload failed');
  });
});
