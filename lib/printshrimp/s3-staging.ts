import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const DEFAULT_BUCKET = 'etsy-listings-printshrimp-upload-eu-west-2';
const DEFAULT_REGION = 'eu-west-2';
const STAGING_PREFIX = 'printshrimp-staging/';
const PUBLIC_CHECK_TIMEOUT_MS = 30_000;

if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) process.env.AWS_PROFILE = 'etsy-listings-app';

const region = process.env.AWS_REGION?.trim() || DEFAULT_REGION;
const bucket = process.env.PRINTSHRIMP_UPLOAD_S3_BUCKET?.trim() || DEFAULT_BUCKET;
const client = new S3Client({ region });

function validateObjectKey(objectKey: string) {
  if (!objectKey.startsWith(STAGING_PREFIX) || objectKey.endsWith('/') || objectKey.includes('\\')) {
    throw new Error('The temporary PrintShrimp S3 object key is invalid.');
  }
}

function publicObjectUrl(objectKey: string) {
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

function contentTypeFor(objectKey: string) {
  return objectKey.toLocaleLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

export async function stagePrintShrimpArtwork(objectKey: string, contents: Buffer) {
  validateObjectKey(objectKey);
  const contentType = contentTypeFor(objectKey);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: contents,
    ContentType: contentType,
    CacheControl: 'no-store, max-age=0',
  }));

  const imageUrl = publicObjectUrl(objectKey);
  let response: Response;
  try {
    response = await fetch(imageUrl, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(PUBLIC_CHECK_TIMEOUT_MS),
    });
  } catch {
    throw new Error('The PrintShrimp upload bucket public URL could not be reached.');
  }
  if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0].toLocaleLowerCase() !== contentType) {
    throw new Error(
      `The PrintShrimp upload bucket must allow public object reads and return ${contentType} (received status ${response.status}).`,
    );
  }
  return imageUrl;
}

export async function removeStagedPrintShrimpArtwork(objectKey: string) {
  validateObjectKey(objectKey);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}

export const PRINTSHRIMP_UPLOAD_BUCKET = bucket;
