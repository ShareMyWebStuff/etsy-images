import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import sharp from 'sharp';
import { ETSY_LISTINGS_DIRECTORY } from '@/lib/config';

const bucket = process.env.ETSY_LISTINGS_S3_BUCKET ?? 'etsy-listings-216211142709-eu-west-2';
const region = process.env.AWS_REGION ?? 'eu-west-2';
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) process.env.AWS_PROFILE = 'etsy-listings-app';
const S3_REQUEST_TIMEOUT_MS = 240_000;
const client = new S3Client({
  region,
  maxAttempts: 5,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 10_000,
    requestTimeout: S3_REQUEST_TIMEOUT_MS,
    socketTimeout: S3_REQUEST_TIMEOUT_MS,
    throwOnRequestTimeout: true,
  }),
});
const APP_PREVIEW_PREFIX = '.app-previews/';
const APP_PREVIEW_MAX_SIZE = 512;
const IMAGE_KEY_PATTERN = /\.(?:jpe?g|png|webp)$/i;

function storageError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function isTimeoutError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'TimeoutError' || candidate.code === 'ETIMEDOUT';
}

async function runS3Operation<T>(description: string, operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`S3 timed out while ${description}. Please try again.`, { cause: error });
    }
    throw error;
  }
}

function keyFromPath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const root = ETSY_LISTINGS_DIRECTORY.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (normalized.toLocaleLowerCase() === root.toLocaleLowerCase()) return '';
  if (normalized.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`)) {
    return normalized.slice(root.length + 1);
  }
  throw new Error(`Listing storage path is outside the configured root: ${value}`);
}

async function objectExists(key: string) {
  try {
    const result = await runS3Operation(
      `checking the stored file "${key}"`,
      () => client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    );
    return result;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

function isImageKey(key: string) {
  return !key.startsWith(APP_PREVIEW_PREFIX) && IMAGE_KEY_PATTERN.test(key);
}

function previewKeyForKey(key: string) {
  return `${APP_PREVIEW_PREFIX}${key}.webp`;
}

async function readKey(key: string) {
  try {
    const result = await runS3Operation(
      `reading the stored file "${key}"`,
      () => client.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
    );
    if (!result.Body) throw storageError('ENOENT', `S3 object not found: ${key}`);
    return Buffer.from(await runS3Operation(
      `downloading the stored file "${key}"`,
      () => result.Body!.transformToByteArray(),
    ));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === 'NoSuchKey') {
      throw storageError('ENOENT', `S3 object not found: ${key}`);
    }
    throw error;
  }
}

async function putKey(key: string, body: Buffer | Uint8Array) {
  await runS3Operation(
    `writing the stored file "${key}"`,
    () => client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body })),
  );
}

async function createAppPreview(contents: Buffer | Uint8Array) {
  return sharp(contents, { failOn: 'error' })
    .rotate()
    .resize({
      width: APP_PREVIEW_MAX_SIZE,
      height: APP_PREVIEW_MAX_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
}

async function listKeys(prefix: string) {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    keys.push(...(page.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

export async function readFile(filePath: string) {
  const key = keyFromPath(filePath);
  return readKey(key);
}

/**
 * Returns the lightweight app version of an image. Older images are
 * backfilled on first use, while newly written images receive one eagerly.
 */
export async function readImagePreview(filePath: string) {
  const key = keyFromPath(filePath);
  if (!isImageKey(key)) throw new Error(`An app preview cannot be created for a non-image file: ${filePath}`);
  const previewKey = previewKeyForKey(key);
  try {
    return await readKey(previewKey);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const preview = await createAppPreview(await readKey(key));
  await putKey(previewKey, preview);
  return preview;
}

export async function writeFile(filePath: string, contents: Buffer | Uint8Array | string, encoding?: BufferEncoding) {
  const key = keyFromPath(filePath);
  const body = typeof contents === 'string' ? Buffer.from(contents, encoding ?? 'utf8') : contents;
  if (isImageKey(key)) {
    const preview = await createAppPreview(body);
    await Promise.all([
      putKey(key, body),
      putKey(previewKeyForKey(key), preview),
    ]);
    return;
  }
  await putKey(key, body);
}

export async function mkdir(directoryPath: string, _options?: { recursive?: boolean }) {
  const key = keyFromPath(directoryPath);
  if (key) await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${key}/`, Body: Buffer.alloc(0) }));
}

export async function stat(storagePath: string) {
  const key = keyFromPath(storagePath);
  const head = key ? await objectExists(key) : null;
  if (head) return { isFile: () => true, isDirectory: () => false, size: head.ContentLength ?? 0 };
  const prefix = key ? `${key}/` : '';
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }));
  if ((listed.KeyCount ?? 0) > 0) return { isFile: () => false, isDirectory: () => true, size: 0 };
  throw storageError('ENOENT', `S3 path not found: ${key}`);
}

type StorageDirectoryEntry = { name: string; isDirectory: () => boolean; isFile: () => boolean };

export function readdir(directoryPath: string, options: { withFileTypes: true }): Promise<StorageDirectoryEntry[]>;
export function readdir(directoryPath: string, options?: { withFileTypes?: false }): Promise<string[]>;
export async function readdir(directoryPath: string, options?: { withFileTypes?: boolean }): Promise<string[] | StorageDirectoryEntry[]> {
  const key = keyFromPath(directoryPath);
  const prefix = key ? `${key}/` : '';
  const names = new Map<string, boolean>();
  let continuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
      ContinuationToken: continuationToken,
    }));
    for (const commonPrefix of page.CommonPrefixes ?? []) {
      const name = commonPrefix.Prefix?.slice(prefix.length).replace(/\/$/, '');
      if (name) names.set(name, true);
    }
    for (const object of page.Contents ?? []) {
      const name = object.Key?.slice(prefix.length);
      if (name) names.set(name, false);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  if (!options?.withFileTypes) return [...names.keys()];
  return [...names].map(([name, directory]) => ({ name, isDirectory: () => directory, isFile: () => !directory }));
}

export async function unlink(filePath: string) {
  const key = keyFromPath(filePath);
  if (!await objectExists(key)) throw storageError('ENOENT', `S3 object not found: ${key}`);
  await runS3Operation(
    `deleting the stored file "${key}"`,
    () => Promise.all([
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      ...(isImageKey(key)
        ? [client.send(new DeleteObjectCommand({ Bucket: bucket, Key: previewKeyForKey(key) }))]
        : []),
    ]),
  );
}

export async function copyFile(sourcePath: string, destinationPath: string) {
  const sourceKey = keyFromPath(sourcePath);
  const destinationKey = keyFromPath(destinationPath);
  if (!await objectExists(sourceKey)) throw storageError('ENOENT', `S3 object not found: ${sourceKey}`);
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: destinationKey,
    CopySource: `${bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
  }));
  if (isImageKey(sourceKey) && isImageKey(destinationKey)) {
    const sourcePreviewKey = previewKeyForKey(sourceKey);
    const destinationPreviewKey = previewKeyForKey(destinationKey);
    if (await objectExists(sourcePreviewKey)) {
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: destinationPreviewKey,
        CopySource: `${bucket}/${sourcePreviewKey.split('/').map(encodeURIComponent).join('/')}`,
      }));
    } else {
      const preview = await createAppPreview(await readKey(sourceKey));
      await Promise.all([
        putKey(sourcePreviewKey, preview),
        putKey(destinationPreviewKey, preview),
      ]);
    }
  }
}

export async function rename(sourcePath: string, destinationPath: string) {
  const sourceKey = keyFromPath(sourcePath);
  const destinationKey = keyFromPath(destinationPath);
  if (await objectExists(sourceKey)) {
    await copyFile(sourcePath, destinationPath);
    await unlink(sourcePath);
    return;
  }
  const sourcePrefix = `${sourceKey}/`;
  const keys = await listKeys(sourcePrefix);
  if (keys.length === 0) throw storageError('ENOENT', `S3 path not found: ${sourceKey}`);
  for (const key of keys) {
    const target = `${destinationKey}/${key.slice(sourcePrefix.length)}`;
    await client.send(new CopyObjectCommand({
      Bucket: bucket,
      Key: target,
      CopySource: `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
    }));
  }
  const sourcePreviewPrefix = `${APP_PREVIEW_PREFIX}${sourcePrefix}`;
  const previewKeys = await listKeys(sourcePreviewPrefix);
  for (const key of previewKeys) {
    const target = `${APP_PREVIEW_PREFIX}${destinationKey}/${key.slice(sourcePreviewPrefix.length)}`;
    await client.send(new CopyObjectCommand({
      Bucket: bucket,
      Key: target,
      CopySource: `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
    }));
  }
  await deleteKeys(keys);
  await deleteKeys(previewKeys);
}

async function deleteKeys(keys: string[]) {
  for (let index = 0; index < keys.length; index += 1000) {
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Quiet: true, Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })) },
    }));
  }
}

export async function rm(storagePath: string, options?: { recursive?: boolean; force?: boolean }) {
  const key = keyFromPath(storagePath);
  if (options?.recursive) {
    const keys = await listKeys(key ? `${key}/` : '');
    if (await objectExists(key)) keys.push(key);
    if (key && !key.startsWith(APP_PREVIEW_PREFIX)) {
      keys.push(...await listKeys(`${APP_PREVIEW_PREFIX}${key}/`));
      if (isImageKey(key) && await objectExists(previewKeyForKey(key))) keys.push(previewKeyForKey(key));
    }
    if (keys.length === 0 && !options.force) throw storageError('ENOENT', `S3 path not found: ${key}`);
    await deleteKeys([...new Set(keys)]);
    return;
  }
  try {
    await unlink(storagePath);
  } catch (error) {
    if (!options?.force) throw error;
  }
}
