import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const aws = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = aws.send; },
  PutObjectCommand: class { constructor(readonly input: unknown) {} },
  DeleteObjectCommand: class { constructor(readonly input: unknown) {} },
}));

import {
  removeStagedPrintShrimpArtwork,
  stagePrintShrimpArtwork,
} from '@/lib/printshrimp/s3-staging';

beforeEach(() => {
  aws.send.mockReset().mockResolvedValue({});
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg' },
  })));
});

afterEach(() => vi.unstubAllGlobals());

describe('PrintShrimp S3 staging', () => {
  it('uploads a JPEG, verifies its public HEAD response, and removes it', async () => {
    const objectKey = 'printshrimp-staging/id-artwork.jpg';
    await expect(stagePrintShrimpArtwork(objectKey, Buffer.from('jpeg'))).resolves.toBe(
      'https://etsy-listings-printshrimp-upload-eu-west-2.s3.eu-west-2.amazonaws.com/printshrimp-staging/id-artwork.jpg',
    );
    await expect(removeStagedPrintShrimpArtwork(objectKey)).resolves.toBeUndefined();

    expect(aws.send).toHaveBeenCalledTimes(2);
    expect(aws.send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'etsy-listings-printshrimp-upload-eu-west-2',
      Key: objectKey,
      ContentType: 'image/jpeg',
    });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(objectKey), expect.objectContaining({ method: 'HEAD' }));
  });

  it('rejects a bucket response that is not publicly readable as an image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 403,
      headers: { 'Content-Type': 'application/xml' },
    })));

    await expect(stagePrintShrimpArtwork('printshrimp-staging/id-artwork.jpg', Buffer.from('jpeg')))
      .rejects.toThrow(/allow public object reads/);
  });
});
