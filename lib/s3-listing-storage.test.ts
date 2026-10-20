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

import { writeFile } from '@/lib/s3-listing-storage';

beforeEach(() => {
  aws.send.mockReset().mockResolvedValue({});
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
});
