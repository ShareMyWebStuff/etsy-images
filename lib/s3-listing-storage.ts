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
import { ETSY_LISTINGS_DIRECTORY } from '@/lib/config';

const bucket = process.env.ETSY_LISTINGS_S3_BUCKET ?? 'etsy-listings-216211142709-eu-west-2';
const region = process.env.AWS_REGION ?? 'eu-west-2';
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) process.env.AWS_PROFILE = 'etsy-listings-app';
const client = new S3Client({ region });

function storageError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
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
    const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return result;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
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
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw storageError('ENOENT', `S3 object not found: ${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === 'NoSuchKey') {
      throw storageError('ENOENT', `S3 object not found: ${key}`);
    }
    throw error;
  }
}

export async function writeFile(filePath: string, contents: Buffer | Uint8Array | string, encoding?: BufferEncoding) {
  const key = keyFromPath(filePath);
  const body = typeof contents === 'string' ? Buffer.from(contents, encoding ?? 'utf8') : contents;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
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
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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
}

export async function rename(sourcePath: string, destinationPath: string) {
  const sourceKey = keyFromPath(sourcePath);
  const destinationKey = keyFromPath(destinationPath);
  if (await objectExists(sourceKey)) {
    await copyFile(sourcePath, destinationPath);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
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
  await deleteKeys(keys);
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
    if (keys.length === 0 && !options.force) throw storageError('ENOENT', `S3 path not found: ${key}`);
    await deleteKeys(keys);
    return;
  }
  try {
    await unlink(storagePath);
  } catch (error) {
    if (!options?.force) throw error;
  }
}
