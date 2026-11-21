import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
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
    // A caller may clean up after a failed write. Wait for both uploads so a
    // late success cannot recreate an object after that cleanup has finished.
    const results = await Promise.allSettled([
      putKey(key, body),
      putKey(previewKeyForKey(key), preview),
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return;
  }
  await putKey(key, body);
}

function stagedThumbnailKey(filePath: string) {
  const key = keyFromPath(filePath);
  if (!/(?:^|\/)thumbnail\/thumbnail-gap-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.png$/i.test(key)) {
    throw new Error('Only a newly staged thumbnail gap image can use this storage operation.');
  }
  return key;
}

/** Both writes settle before cleanup can run, including when only one write fails. */
export async function writeStagedListingThumbnail(filePath: string, contents: Buffer) {
  const key = stagedThumbnailKey(filePath);
  const preview = await createAppPreview(contents);
  const results = await Promise.allSettled([putKey(key, contents), putKey(previewKeyForKey(key), preview)]);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

/** Never checks or removes the previous thumbnail; preview-only staging is also cleaned. */
export async function removeStagedListingThumbnail(filePath: string) {
  const key = stagedThumbnailKey(filePath);
  const results = await Promise.allSettled([key, previewKeyForKey(key)].map((objectKey) => runS3Operation(
    'cleaning a newly staged thumbnail',
    () => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })),
  )));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
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
  const keys = [key, ...(isImageKey(key) ? [previewKeyForKey(key)] : [])];
  const existing = await Promise.all(keys.map((objectKey) => objectExists(objectKey)));
  if (!existing.some(Boolean)) throw storageError('ENOENT', `S3 object not found: ${key}`);
  await runS3Operation(
    `deleting the stored file "${key}"`,
    async () => {
      // Delete both keys even if only the preview remains. Settle all deletes
      // before an error reaches rollback code that may restore the originals.
      const results = await Promise.allSettled(keys.map((objectKey) => (
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }))
      )));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    },
  );
}

/** Discover only this listing's reserved generated PNGs, including preview-only leftovers. */
export async function listGeneratedListingImageFiles(directoryPath: string): Promise<string[]> {
  const directory = keyFromPath(directoryPath);
  const originalPrefix = directory ? `${directory}/` : '';
  const names = new Set<string>();
  await Promise.all([originalPrefix, `${APP_PREVIEW_PREFIX}${originalPrefix}`].map(async (prefix, index) => {
    let continuationToken: string | undefined;
    do {
      const page = await runS3Operation(`checking generated images in "${directory}"`, () => client.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: continuationToken,
      })));
      for (const object of page.Contents ?? []) {
        const relative = object.Key?.startsWith(prefix) ? object.Key.slice(prefix.length) : '';
        if (index === 1 && !relative.endsWith('.webp')) continue;
        const fileName = index === 1 && relative.endsWith('.webp') ? relative.slice(0, -5) : relative;
        const match = /^template-([1-9]\d*)\.png$/i.exec(fileName);
        if (match && Number.isSafeInteger(Number(match[1]))) names.add(fileName);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }));
  return [...names].sort();
}

const LISTING_DELETE_MAX_OBJECTS = 10_000;
const LISTING_DELETE_MAX_BYTES = 1024 * 1024 * 1024;
type ListingDeleteObject = { key: string; etag: string; size: number };
type ListingDeleteHeaders = Pick<PutObjectCommandInput,
  'ContentType' | 'CacheControl' | 'ContentEncoding' | 'ContentDisposition' | 'ContentLanguage' | 'Expires' | 'Metadata'>;

function listingDirectoryKey(directoryPath: string) {
  const key = keyFromPath(directoryPath), parts = key.split('/');
  // A listing lives at root/shop/section/listing. Never permit a shop,
  // section, preview namespace, nested child, or traversal as the target.
  if (parts.length !== 3 || parts.some((part) => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part))
    || parts[0] === APP_PREVIEW_PREFIX.slice(0, -1)) {
    throw new Error('Only an exact listing directory inside the configured storage root can be deleted.');
  }
  return key;
}

async function listingDeleteInventory(directory: string, protectedKey: (key: string) => boolean) {
  const objects = new Map<string, ListingDeleteObject>();
  let bytes = 0;
  const add = (key: string, etag: string | undefined, size: number | undefined) => {
    if (protectedKey(key) || objects.has(key)) return;
    if (!etag || !Number.isSafeInteger(size) || size! < 0) throw new Error(`The listing storage inventory could not be verified: ${key}.`);
    bytes += size!;
    if (objects.size >= LISTING_DELETE_MAX_OBJECTS || bytes > LISTING_DELETE_MAX_BYTES) {
      throw new Error('The listing is too large for safe deletion: at most 10,000 objects and 1 GiB can be backed up. No database rows were deleted.');
    }
    objects.set(key, { key, etag, size: size! });
  };
  for (const root of [directory, `${APP_PREVIEW_PREFIX}${directory}`]) {
    const prefix = `${root}/`, tokens = new Set<string>();
    let token: string | undefined;
    do {
      const page = await runS3Operation(`checking listing files in "${directory}"`, () => client.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix, ContinuationToken: token,
      })));
      for (const object of page.Contents ?? []) {
        // Check the boundary even though S3 ordinarily enforces its Prefix.
        if (object.Key?.startsWith(prefix)) add(object.Key, object.ETag, object.Size);
      }
      if (!page.IsTruncated) break;
      if (!page.NextContinuationToken || tokens.has(page.NextContinuationToken)) throw new Error('The listing storage inventory could not be completed. No database rows were deleted.');
      token = page.NextContinuationToken; tokens.add(token);
    } while (true);
    // Some old folder markers use the exact directory key without '/'.
    if (!protectedKey(root)) {
      const marker = await objectExists(root);
      if (marker) add(root, marker.ETag, marker.ContentLength);
    }
  }
  return [...objects.values()];
}

/**
 * Remove one listing's inventoried originals and exact preview bytes, then
 * commit its database deletion. The callback must resolve a lost database
 * commit acknowledgement itself before deciding whether rollback is needed.
 */
export async function removeListingStorage(
  directoryPath: string,
  excludedPaths: readonly string[],
  deleteDatabaseRows: () => Promise<void>,
): Promise<void> {
  const directory = listingDirectoryKey(directoryPath);
  const exclusions = excludedPaths.map((value) => {
    const key = keyFromPath(value);
    if (key.split('/').some((part) => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part))) {
      throw new Error('A preserved listing source has an unsafe storage path.');
    }
    return key;
  });
  const protectedKey = (key: string) => exclusions.some((source) => key === source || key.startsWith(`${source}/`)
    || !source.startsWith(APP_PREVIEW_PREFIX) && (key === previewKeyForKey(source)
      || key === `${APP_PREVIEW_PREFIX}${source}` || key.startsWith(`${APP_PREVIEW_PREFIX}${source}/`)));
  const inventory = await listingDeleteInventory(directory, protectedKey);
  const backups = new Map<string, { contents: Buffer; etag: string; headers: ListingDeleteHeaders }>();
  // Complete every backup before issuing the first mutation, even when a
  // listing contains files that the database never registered.
  for (const object of inventory) {
    const response = await runS3Operation(`backing up the listing file "${object.key}"`, () => client.send(new GetObjectCommand({
      Bucket: bucket, Key: object.key, IfMatch: object.etag,
    })));
    if (!response.Body || response.ETag !== object.etag) throw new Error('The listing files changed while preparing deletion. Reload and try again. No files were deleted.');
    const contents = Buffer.from(await runS3Operation(`backing up the listing file "${object.key}"`, () => response.Body!.transformToByteArray()));
    if (contents.length !== object.size) throw new Error('The listing file sizes changed while preparing deletion. No files were deleted.');
    backups.set(object.key, { contents, etag: object.etag, headers: {
      ContentType: response.ContentType,
      CacheControl: response.CacheControl,
      ContentEncoding: response.ContentEncoding,
      ContentDisposition: response.ContentDisposition,
      ContentLanguage: response.ContentLanguage,
      Expires: response.Expires,
      Metadata: response.Metadata ? { ...response.Metadata } : undefined,
    } });
  }
  const attempted: string[] = [];
  try {
    for (const object of inventory) {
      attempted.push(object.key);
      // A concurrent upload of this filename must survive deletion.
      await runS3Operation(`deleting the listing file "${object.key}"`, () => client.send(new DeleteObjectCommand({
        Bucket: bucket, Key: object.key, IfMatch: object.etag,
      })));
    }
    if ((await listingDeleteInventory(directory, protectedKey)).length) {
      throw new Error('The listing files changed while deletion was running. No database rows were deleted. Reload and try again.');
    }
    await deleteDatabaseRows();
  } catch (error) {
    const failures: unknown[] = [];
    for (const key of attempted) {
      const backup = backups.get(key)!;
      try {
        await runS3Operation(`restoring the listing file "${key}"`, () => client.send(new PutObjectCommand({
          ...backup.headers, Bucket: bucket, Key: key, Body: backup.contents, IfNoneMatch: '*',
        })));
      } catch (restoreError) {
        const status = (restoreError as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 412) {
          try {
            const existing = await objectExists(key);
            if (existing?.ETag === backup.etag) continue; // The failed delete left the original intact.
            failures.push(new Error(`A newer listing file was preserved instead of overwriting it during rollback: ${key}.`, { cause: restoreError }));
          } catch (lookupError) { failures.push(lookupError); }
        } else failures.push(restoreError);
      }
    }
    if (failures.length) throw new Error('The listing could not be deleted, and some files could not be restored safely. Reload before retrying deletion.',
      { cause: new AggregateError([error, ...failures]) });
    throw error;
  }
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
    const result = await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Quiet: true, Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })) },
    }));
    if (result.Errors?.length) {
      throw new Error(`S3 could not delete ${result.Errors.length} stored file(s): ${result.Errors.map((error) => `${error.Key}: ${error.Message ?? error.Code ?? 'Delete failed'}`).join('; ')}`);
    }
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
