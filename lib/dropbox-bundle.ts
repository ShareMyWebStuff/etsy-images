import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import PDFDocument from 'pdfkit';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { prisma } from '@/lib/prisma';
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from '@/lib/s3-listing-storage';

type ListingContext = { shopId: string; sectionId: string; subSectionId: string; listingId: string };

type DropboxUploadFile = {
  fileName: string;
  storagePath: string;
  sizeBytes: number;
};

export type ListingZipStorageInput = {
  downloadsRevision: number;
  zippedRevision: number;
  hasEverZipped: boolean;
  numberOfItems: number | null;
  includeAllItems: boolean;
  dropboxFiles: Array<{
    groupNumber: number;
    sourceListingId: number | null;
    sourceDirectoryName: string;
    localFileName: string;
    originalFileName?: string | null;
  }>;
  zippedFiles: Array<{
    fileName: string;
    sizeBytes: number;
  }>;
};

export type ListingZipStorageStatus = {
  valid: boolean;
  grouped: boolean;
  groupCount: number;
  expectedGroupCount: number | null;
  message: string | null;
};

type DropboxInstructionPdfFile = {
  id: number;
  localFileName: string | null;
  originalFileName: string | null;
  filename: string | null;
  rawJson: unknown;
};

type DropboxInstructionPdfListing = {
  title: string;
  files: DropboxInstructionPdfFile[];
};

type PreparedDropboxInstructionPdf = {
  existingFile: DropboxInstructionPdfFile | null;
  duplicateIds: number[];
  fileName: string;
  pdf: Buffer;
  fileData: {
    localFileName: string;
    originalFileName: string;
    filename: string;
    filetype: string;
    filesize: string;
    sizeBytes: number;
    rank: number;
    etsyListingFileId: null;
    rawJson: { kind: string; dropboxSharedUrl: string };
  };
};

type InstalledStorageReplacement = {
  targetPath: string;
  backupPath: string | null;
  previousSize: number | null;
};

type DropboxEntry = {
  '.tag'?: string;
  name?: string;
  path_display?: string;
  path_lower?: string;
};

export class DropboxBundleStateError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'DropboxBundleStateError';
  }
}

class DropboxRpcError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    readonly payload: Record<string, unknown>,
  ) {
    super(`Dropbox ${endpoint} failed: ${JSON.stringify(payload)}`);
    this.name = 'DropboxRpcError';
  }
}

let cachedDropboxToken: { value: string; expiresAt: number } | null = null;
const groupedZipLocks = new Map<number, Promise<void>>();

async function withGroupedZipLock<T>(listingId: number, action: () => Promise<T>) {
  const previous = groupedZipLocks.get(listingId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  groupedZipLocks.set(listingId, tail);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (groupedZipLocks.get(listingId) === tail) groupedZipLocks.delete(listingId);
  }
}

async function getDropboxAccessToken() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const refreshSettings = [appKey, appSecret, refreshToken];

  if (refreshSettings.some(Boolean) && !refreshSettings.every(Boolean)) {
    throw new Error('Set DROPBOX_APP_KEY, DROPBOX_APP_SECRET, and DROPBOX_REFRESH_TOKEN together.');
  }

  if (appKey && appSecret && refreshToken) {
    if (cachedDropboxToken && cachedDropboxToken.expiresAt > Date.now() + 60_000) {
      return cachedDropboxToken.value;
    }
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const payload = await response.json() as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!response.ok || !payload.access_token) {
      throw new Error(`Unable to refresh the Dropbox access token: ${payload.error_description ?? payload.error ?? response.statusText}`);
    }
    cachedDropboxToken = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 14_400) * 1000,
    };
    return cachedDropboxToken.value;
  }

  const accessToken = process.env.DROPBOX_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Set Dropbox refresh-token credentials or DROPBOX_ACCESS_TOKEN before creating the Dropbox bundle.');
  }
  return accessToken;
}

async function loadBundleListing(context: ListingContext) {
  const listing = await prisma.etsyListing.findFirst({
    where: { id: Number(context.listingId), subSectionId: Number(context.subSectionId) },
    include: {
      dropboxFiles: { orderBy: [{ groupNumber: 'asc' }, { id: 'asc' }] },
      dropboxBundle: true,
      files: true,
      zippedFiles: { orderBy: [{ zipNumber: 'asc' }, { id: 'asc' }] },
      subSection: { include: { shopSection: { include: { shop: true } } } },
    },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop || section.id !== Number(context.sectionId)
    || shop.etsyShopId.toString() !== context.shopId) throw new Error('Listing context not found.');
  const shopName = shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`;
  return {
    listing,
    listingPath: getListingDirectoryPath(shopName, section.title, listing.subSection.name, listing.localDirectoryName ?? `Listing-${listing.id}`),
  };
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'listing';
}

function assertSafeFileName(fileName: string) {
  if (!fileName || fileName !== path.basename(fileName) || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error(`Invalid ZIP filename: ${fileName || '(empty)'}`);
  }
  return fileName;
}

function isNotFoundError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isDropboxNotFoundError(error: unknown) {
  return error instanceof DropboxRpcError && JSON.stringify(error.payload).toLocaleLowerCase().includes('not_found');
}

function validateDropboxFolderPath(folderPath: string) {
  if (!folderPath.startsWith('/') || folderPath === '/' || folderPath.endsWith('/')) {
    throw new Error('The Dropbox bundle folder path is invalid.');
  }
}

function multiZipDetails(
  listing: Pick<ListingZipStorageInput, 'dropboxFiles' | 'numberOfItems' | 'includeAllItems'>,
  listingPath: string,
) {
  const groups = [...new Set(listing.dropboxFiles.map((file) => file.groupNumber))].sort((a, b) => a - b);
  if (groups.some((groupNumber) => !Number.isInteger(groupNumber) || groupNumber < 1)) {
    throw new DropboxBundleStateError('Each selected animal must have a valid Dropbox source group.');
  }
  if (!listing.includeAllItems && listing.numberOfItems !== null
    && (!Number.isInteger(listing.numberOfItems) || listing.numberOfItems < 1)) {
    throw new DropboxBundleStateError('The selected animal count is invalid.');
  }
  const expectedGroupCount = !listing.includeAllItems ? listing.numberOfItems : null;
  if (expectedGroupCount !== null && groups.length !== expectedGroupCount) {
    throw new DropboxBundleStateError(
      `Expected ${expectedGroupCount} Dropbox source ${expectedGroupCount === 1 ? 'group' : 'groups'}, but found ${groups.length}.`,
    );
  }

  const seenSources = new Set<string>();
  return groups.map((groupNumber) => {
    const files = listing.dropboxFiles.filter((file) => file.groupNumber === groupNumber);
    const sourceDirectoryName = files[0]?.sourceDirectoryName;
    if (!sourceDirectoryName || files.some((file) => !file.localFileName.trim())) {
      throw new DropboxBundleStateError(`Dropbox download group ${groupNumber} is empty.`);
    }
    const sourceIds = new Set(files.flatMap((file) => file.sourceListingId === null ? [] : [file.sourceListingId]));
    const sourceNames = new Set(files.map((file) => file.sourceDirectoryName.trim().toLocaleLowerCase()).filter(Boolean));
    const mixesKnownAndUnknownSources = sourceIds.size === 1 && files.some((file) => file.sourceListingId === null);
    if (sourceIds.size > 1 || mixesKnownAndUnknownSources || sourceNames.size !== 1) {
      throw new DropboxBundleStateError(`Dropbox download group ${groupNumber} contains files from more than one animal.`);
    }
    const sourceIdentity = sourceIds.size === 1
      ? `listing:${[...sourceIds][0]}`
      : `directory:${[...sourceNames][0]}`;
    if (seenSources.has(sourceIdentity)) {
      throw new DropboxBundleStateError('Each selected animal must have one distinct Dropbox source group.');
    }
    seenSources.add(sourceIdentity);
    const fileName = `${String(groupNumber).padStart(2, '0')}-${safeName(sourceDirectoryName)}.zip`;
    return {
      groupNumber,
      sourceDirectoryName,
      fileName,
      storagePath: path.join(listingPath, 'dropboxZipped', fileName),
      files,
    };
  });
}

async function writeZip(targetPath: string, files: Array<{ path: string; name: string }>) {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  for (const file of files) archive.append(await readFile(file.path), { name: file.name });
  await archive.finalize();
  await completed;
  await writeFile(targetPath, Buffer.concat(chunks));
}

async function createZipBuffer(files: Array<{ path: string; name: string }>) {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  for (const file of files) archive.append(await readFile(file.path), { name: file.name });
  await archive.finalize();
  await completed;
  return Buffer.concat(chunks);
}

async function createDigitalDownloadsZip(
  listing: Awaited<ReturnType<typeof loadBundleListing>>['listing'],
  listingPath: string,
) {
  // The generated link PDF is the Etsy delivery mechanism, not part of the
  // artwork bundle that the link points to.
  const downloads = listing.files.filter((file) => !isDropboxInstructionPdfFile(file));
  if (downloads.length === 0) {
    throw new DropboxBundleStateError('Add at least one file to Digital Downloads before creating Dropbox.');
  }

  const seenNames = new Set<string>();
  const files = downloads.map((file) => {
    const storageName = file.localFileName;
    // The local name is an internal storage key such as file_2.jpg. Preserve
    // the customer-facing name displayed by Digital Downloads in the ZIP.
    const archiveName = assertSafeFileName(file.originalFileName ?? file.localFileName ?? file.filename ?? '');
    if (!storageName) throw new DropboxBundleStateError(`Digital download ${archiveName} is missing from storage.`);
    const normalizedName = archiveName.toLocaleLowerCase();
    if (seenNames.has(normalizedName)) {
      throw new DropboxBundleStateError(`Digital Downloads contains more than one file named ${archiveName}.`);
    }
    seenNames.add(normalizedName);
    return { path: path.join(listingPath, 'downloads', storageName), name: archiveName };
  });

  const contents = await createZipBuffer(files);
  if (contents.length === 0) throw new Error('The Digital Downloads ZIP is empty.');
  return {
    fileName: `${safeName(listing.localDirectoryName ?? listing.title)}.zip`,
    contents,
  };
}

async function unlinkIfPresent(storagePath: string) {
  try {
    await unlink(storagePath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

async function cleanupStoragePaths(storagePaths: Iterable<string>) {
  const failures: unknown[] = [];
  for (const storagePath of storagePaths) {
    try {
      await unlinkIfPresent(storagePath);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

export function isDropboxInstructionPdfFile(file: { rawJson: unknown }) {
  if (!file.rawJson || typeof file.rawJson !== 'object' || Array.isArray(file.rawJson)) return false;
  const metadata = file.rawJson as Record<string, unknown>;
  return metadata.kind === 'dropbox_instruction_pdf' || typeof metadata.dropboxSharedUrl === 'string';
}

async function prepareDropboxInstructionPdf(
  listing: DropboxInstructionPdfListing,
  sharedUrl: string,
): Promise<PreparedDropboxInstructionPdf> {
  const generatedFiles = listing.files.filter(isDropboxInstructionPdfFile);
  const existingFile = generatedFiles[0] ?? null;
  const duplicateIds = generatedFiles.slice(1).map((file) => file.id);
  const generatedIds = new Set(generatedFiles.map((file) => file.id));
  const normalFileNames = new Set(listing.files
    .filter((file) => !generatedIds.has(file.id))
    .flatMap((file) => [file.localFileName, file.filename])
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLocaleLowerCase()));
  const defaultFileName = 'CosyHousePrints_Download_Instructions.pdf';
  let fileName = existingFile?.localFileName ?? existingFile?.filename ?? defaultFileName;
  if (normalFileNames.has(fileName.toLocaleLowerCase())) {
    let suffix = 2;
    do {
      fileName = `CosyHousePrints_Download_Instructions_${suffix}.pdf`;
      suffix += 1;
    } while (normalFileNames.has(fileName.toLocaleLowerCase()));
  }
  assertSafeFileName(fileName);
  const pdf = await createLinkedPdf(listing.title, sharedUrl);
  return {
    existingFile,
    duplicateIds,
    fileName,
    pdf,
    fileData: {
      localFileName: fileName,
      originalFileName: fileName,
      filename: fileName,
      filetype: 'application/pdf',
      filesize: `${(pdf.length / (1024 * 1024)).toFixed(2)} MB`,
      sizeBytes: pdf.length,
      rank: 1,
      etsyListingFileId: null,
      rawJson: { kind: 'dropbox_instruction_pdf', dropboxSharedUrl: sharedUrl },
    },
  };
}

async function installStorageReplacement(targetPath: string, contents: Buffer): Promise<InstalledStorageReplacement> {
  const directoryPath = path.dirname(targetPath);
  await mkdir(directoryPath, { recursive: true });
  const operationId = randomUUID();
  const stagingPath = path.join(directoryPath, `.${operationId}.instruction.staged`);
  const backupPath = path.join(directoryPath, `.${operationId}.instruction.backup`);
  let previousSize: number | null = null;
  let installStarted = false;
  try {
    await writeFile(stagingPath, contents);
    const staged = await stat(stagingPath);
    if (!staged.isFile() || staged.size !== contents.length || staged.size <= 0) {
      throw new Error('The generated Dropbox instruction PDF could not be staged safely.');
    }
    try {
      const current = await stat(targetPath);
      if (!current.isFile()) throw new Error('The Dropbox instruction PDF storage path is not a file.');
      previousSize = current.size;
      await copyFile(targetPath, backupPath);
      const backup = await stat(backupPath);
      if (!backup.isFile() || backup.size !== current.size) {
        throw new Error('The existing Dropbox instruction PDF could not be backed up safely.');
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    installStarted = true;
    await rename(stagingPath, targetPath);
    const installed = await stat(targetPath);
    if (!installed.isFile() || installed.size !== contents.length || installed.size <= 0) {
      throw new Error('The regenerated Dropbox instruction PDF did not persist correctly.');
    }
    return { targetPath, backupPath: previousSize === null ? null : backupPath, previousSize };
  } catch (error) {
    let rollbackError: unknown = null;
    if (installStarted) {
      try {
        await rollbackStorageReplacement({
          targetPath,
          backupPath: previousSize === null ? null : backupPath,
          previousSize,
        });
      } catch (caughtRollbackError) {
        rollbackError = caughtRollbackError;
      }
    }
    await cleanupStoragePaths([stagingPath]);
    if (!rollbackError) await cleanupStoragePaths([backupPath]);
    if (rollbackError) {
      throw new Error('The regenerated Dropbox instruction PDF failed to install and the previous file could not be restored.', {
        cause: rollbackError,
      });
    }
    throw error;
  }
}

async function rollbackStorageReplacement(replacement: InstalledStorageReplacement) {
  await unlinkIfPresent(replacement.targetPath);
  if (replacement.backupPath && replacement.previousSize !== null) {
    await copyFile(replacement.backupPath, replacement.targetPath);
    const restored = await stat(replacement.targetPath);
    if (!restored.isFile() || restored.size !== replacement.previousSize) {
      throw new Error('The previous Dropbox instruction PDF could not be restored.');
    }
  }
}

type ZipBackup = {
  livePath: string;
  backupPath: string;
  sizeBytes: number;
};

async function rollbackGroupedZipInstall(livePaths: Set<string>, backups: ZipBackup[]) {
  const failures = await cleanupStoragePaths(livePaths);
  for (const backup of backups) {
    try {
      await copyFile(backup.backupPath, backup.livePath);
      const restored = await stat(backup.livePath);
      if (!restored.isFile() || restored.size !== backup.sizeBytes) {
        throw new Error(`Failed to restore ${path.basename(backup.livePath)} to its previous size.`);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new Error('The previous grouped ZIP files could not be fully restored after a failed install.', { cause: failures[0] });
  }
}

async function createDropboxZipsUnlocked(context: ListingContext) {
  const { listing, listingPath } = await loadBundleListing(context);
  if (listing.dropboxFiles.length === 0) throw new Error('No Dropbox downloads were found.');
  const sourceDirectory = path.join(listingPath, 'dropboxDownloads');
  const targetDirectory = path.join(listingPath, 'dropboxZipped');
  await mkdir(targetDirectory, { recursive: true });
  const expectedZips = multiZipDetails(listing, listingPath);
  const operationId = randomUUID();
  const installRevisionMarker = -1 - Number.parseInt(operationId.slice(0, 7), 16);
  const stagedZips: Array<{
    groupNumber: number;
    sourceDirectoryName: string;
    fileName: string;
    sizeBytes: number;
    stagingPath: string;
    targetPath: string;
  }> = [];
  const stagingPaths = new Set<string>();
  const backups: ZipBackup[] = [];
  const backupPaths = new Set<string>();
  const livePaths = new Set<string>();
  let liveInstallStarted = false;
  let zipStateClaimed = false;

  try {
    for (let index = 0; index < expectedZips.length; index += 1) {
      const zip = expectedZips[index];
      const stagingPath = path.join(targetDirectory, `.${operationId}.${index + 1}.staged`);
      stagingPaths.add(stagingPath);
      await writeZip(stagingPath, zip.files.map((file) => ({
        path: path.join(sourceDirectory, file.localFileName),
        name: file.originalFileName ?? file.localFileName,
      })));
      const stagedStats = await stat(stagingPath);
      if (!stagedStats.isFile() || stagedStats.size <= 0) {
        throw new Error(`Generated ZIP ${zip.groupNumber} is empty or invalid.`);
      }
      stagedZips.push({
        groupNumber: zip.groupNumber,
        sourceDirectoryName: zip.sourceDirectoryName,
        fileName: zip.fileName,
        sizeBytes: stagedStats.size,
        stagingPath,
        targetPath: zip.storagePath,
      });
    }

    const currentListing = await prisma.etsyListing.findUnique({
      where: { id: listing.id },
      select: { downloadsRevision: true },
    });
    if (currentListing?.downloadsRevision !== listing.downloadsRevision) {
      throw new DropboxBundleStateError('The downloads changed while the ZIP files were being created. Please zip them again.');
    }

    const existingZipNames = (await readdir(targetDirectory))
      .filter((fileName) => fileName.toLocaleLowerCase().endsWith('.zip'));
    for (let index = 0; index < existingZipNames.length; index += 1) {
      const fileName = existingZipNames[index];
      const livePath = path.join(targetDirectory, fileName);
      const currentStats = await stat(livePath);
      if (!currentStats.isFile()) continue;
      const backupPath = path.join(targetDirectory, `.${operationId}.${index + 1}.backup`);
      backupPaths.add(backupPath);
      await copyFile(livePath, backupPath);
      const backupStats = await stat(backupPath);
      if (!backupStats.isFile() || backupStats.size !== currentStats.size) {
        throw new Error(`Unable to stage a rollback copy of ${fileName}.`);
      }
      backups.push({ livePath, backupPath, sizeBytes: currentStats.size });
      livePaths.add(livePath);
    }

    for (const zip of stagedZips) livePaths.add(zip.targetPath);
    const claimedZipState = await prisma.etsyListing.updateMany({
      where: {
        id: listing.id,
        downloadsRevision: listing.downloadsRevision,
        zippedRevision: listing.zippedRevision,
      },
      data: { zippedRevision: installRevisionMarker },
    });
    if (claimedZipState.count !== 1) {
      throw new DropboxBundleStateError('The ZIP state changed while the archives were being prepared. Please try again.');
    }
    zipStateClaimed = true;
    liveInstallStarted = true;
    for (const zip of stagedZips) await rename(zip.stagingPath, zip.targetPath);

    const expectedNames = new Set(stagedZips.map((zip) => zip.fileName.toLocaleLowerCase()));
    for (const existingName of existingZipNames) {
      if (!expectedNames.has(existingName.toLocaleLowerCase())) {
        await unlinkIfPresent(path.join(targetDirectory, existingName));
      }
    }

    for (const zip of stagedZips) {
      const installedStats = await stat(zip.targetPath);
      if (!installedStats.isFile() || installedStats.size !== zip.sizeBytes) {
        throw new Error(`Installed ZIP ${zip.groupNumber} did not match its staged archive.`);
      }
    }

    const markedCurrent = await prisma.etsyListing.updateMany({
      where: {
        id: listing.id,
        downloadsRevision: listing.downloadsRevision,
        zippedRevision: installRevisionMarker,
      },
      data: { hasEverZipped: true, zippedRevision: listing.downloadsRevision },
    });
    if (markedCurrent.count !== 1) {
      throw new DropboxBundleStateError('The downloads changed while the ZIP files were being created. Please zip them again.');
    }

    const cleanupFailures = await cleanupStoragePaths(backupPaths);
    if (cleanupFailures.length > 0) {
      console.warn('Grouped ZIPs were installed, but one or more temporary rollback copies could not be removed.');
    }
  } catch (error) {
    let rollbackError: unknown = null;
    let stateRestoreError: unknown = null;
    if (liveInstallStarted) {
      try {
        await rollbackGroupedZipInstall(livePaths, backups);
      } catch (caughtRollbackError) {
        rollbackError = caughtRollbackError;
      }
    }
    if (zipStateClaimed && !rollbackError) {
      try {
        await prisma.etsyListing.updateMany({
          where: {
            id: listing.id,
            downloadsRevision: listing.downloadsRevision,
            zippedRevision: { in: [installRevisionMarker, listing.downloadsRevision] },
          },
          data: {
            hasEverZipped: listing.hasEverZipped,
            zippedRevision: listing.zippedRevision,
          },
        });
      } catch (caughtStateRestoreError) {
        stateRestoreError = caughtStateRestoreError;
      }
    }
    await cleanupStoragePaths(stagingPaths);
    if (!rollbackError) await cleanupStoragePaths(backupPaths);
    if (rollbackError) {
      throw new Error('Grouped ZIP creation failed and the previous ZIP files could not be fully restored.', {
        cause: rollbackError,
      });
    }
    if (stateRestoreError) {
      throw new Error('Grouped ZIP creation failed and its previous database state could not be restored.', {
        cause: stateRestoreError,
      });
    }
    throw error;
  }

  return {
    zips: stagedZips.map(({ groupNumber, sourceDirectoryName, fileName, sizeBytes }) => ({
      groupNumber,
      sourceDirectoryName,
      fileName,
      sizeBytes,
    })),
    hasEverZipped: true,
    zippedRevision: listing.downloadsRevision,
    downloadsRevision: listing.downloadsRevision,
  };
}

export async function createDropboxZips(context: ListingContext) {
  const listingId = Number(context.listingId);
  if (!Number.isInteger(listingId) || listingId < 1) throw new Error('Invalid listing id.');
  return withGroupedZipLock(listingId, () => createDropboxZipsUnlocked(context));
}

async function dropboxRpc(endpoint: string, token: string, body: unknown) {
  const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new DropboxRpcError(endpoint, response.status, payload);
  return payload;
}

export async function deleteDropboxBundleFolder(folderPath: string) {
  validateDropboxFolderPath(folderPath);
  const token = await getDropboxAccessToken();
  const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
  });
  const payload = await response.json() as { error_summary?: string };
  if (response.ok || payload.error_summary?.includes('not_found')) return;
  throw new Error(`Unable to delete the Dropbox folder: ${payload.error_summary ?? response.statusText}`);
}

async function ensureDropboxFolder(token: string, folderPath: string) {
  validateDropboxFolderPath(folderPath);
  try {
    const metadata = await dropboxRpc('files/get_metadata', token, { path: folderPath });
    if (metadata['.tag'] !== 'folder') throw new Error('The configured Dropbox bundle path is not a folder.');
    return false;
  } catch (error) {
    if (!isDropboxNotFoundError(error)) throw error;
    await dropboxRpc('files/create_folder_v2', token, { path: folderPath, autorename: false });
    return true;
  }
}

async function listDropboxFolder(token: string, folderPath: string) {
  const entries: DropboxEntry[] = [];
  let page = await dropboxRpc('files/list_folder', token, {
    path: folderPath,
    recursive: false,
    include_deleted: false,
  });
  while (true) {
    if (Array.isArray(page.entries)) entries.push(...page.entries as DropboxEntry[]);
    if (page.has_more !== true || typeof page.cursor !== 'string') break;
    page = await dropboxRpc('files/list_folder/continue', token, { cursor: page.cursor });
  }
  return entries;
}

function isManagedDropboxFile(fileName: string) {
  const normalized = fileName.toLocaleLowerCase();
  return normalized.endsWith('.zip')
    || normalized === 'howtoprintguide.txt'
    || normalized === 'download-instructions.txt';
}

async function removeObsoleteDropboxFiles(token: string, folderPath: string, expectedNames: Set<string>) {
  const normalizedExpected = new Set([...expectedNames].map((name) => name.toLocaleLowerCase()));
  for (const entry of await listDropboxFolder(token, folderPath)) {
    if (entry['.tag'] !== 'file' || !entry.name || !isManagedDropboxFile(entry.name)
      || normalizedExpected.has(entry.name.toLocaleLowerCase())) continue;
    const remotePath = entry.path_display ?? entry.path_lower;
    if (!remotePath || !remotePath.toLocaleLowerCase().startsWith(`${folderPath.toLocaleLowerCase()}/`)) continue;
    try {
      await dropboxRpc('files/delete_v2', token, { path: remotePath });
    } catch (error) {
      if (!isDropboxNotFoundError(error)) throw error;
    }
  }
}

async function uploadDropboxFile(token: string, dropboxPath: string, contents: Buffer) {
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'overwrite', autorename: false, mute: true }),
    },
    body: new Uint8Array(contents),
  });
  if (!response.ok) throw new Error(`Dropbox upload failed: ${await response.text()}`);
}

async function resolveCurrentDropboxZipFiles(
  listing: ListingZipStorageInput,
  listingPath: string,
): Promise<DropboxUploadFile[]> {
  if (!listing.hasEverZipped) {
    throw new DropboxBundleStateError('Please zip the files on the Downloads tab before creating Dropbox.');
  }
  if (listing.zippedRevision !== listing.downloadsRevision) {
    throw new DropboxBundleStateError('Please re-zip the files on the Downloads tab because the downloads have changed.');
  }

  const candidates = listing.dropboxFiles.length > 0
    ? multiZipDetails(listing, listingPath).map((zip) => ({ fileName: zip.fileName, storagePath: zip.storagePath, expectedSize: null }))
    : listing.zippedFiles.map((zip) => ({
      fileName: assertSafeFileName(zip.fileName),
      storagePath: path.join(listingPath, 'zipped', zip.fileName),
      expectedSize: zip.sizeBytes,
    }));
  if (candidates.length === 0) {
    throw new DropboxBundleStateError('Please zip the files on the Downloads tab before creating Dropbox.');
  }

  const files: DropboxUploadFile[] = [];
  for (const candidate of candidates) {
    let fileStats: Awaited<ReturnType<typeof stat>>;
    try {
      fileStats = await stat(candidate.storagePath);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new DropboxBundleStateError('One or more ZIP files are missing. Please zip the files again.');
      }
      throw error;
    }
    if (!fileStats.isFile() || fileStats.size <= 0
      || (candidate.expectedSize !== null && fileStats.size !== candidate.expectedSize)) {
      throw new DropboxBundleStateError('One or more ZIP files are invalid. Please zip the files again.');
    }
    files.push({ fileName: candidate.fileName, storagePath: candidate.storagePath, sizeBytes: fileStats.size });
  }
  return files;
}

export async function inspectListingZipStorage(
  listing: ListingZipStorageInput,
  listingPath: string,
): Promise<ListingZipStorageStatus> {
  const grouped = listing.dropboxFiles.length > 0;
  const expectedGroupCount = grouped && !listing.includeAllItems
    && listing.numberOfItems !== null && listing.numberOfItems > 0
    ? listing.numberOfItems
    : null;
  try {
    const files = await resolveCurrentDropboxZipFiles(listing, listingPath);
    return {
      valid: true,
      grouped,
      groupCount: files.length,
      expectedGroupCount,
      message: null,
    };
  } catch (error) {
    if (!(error instanceof DropboxBundleStateError)) {
      console.error('Unable to verify listing ZIP storage:', error);
    }
    return {
      valid: false,
      grouped,
      groupCount: grouped ? new Set(listing.dropboxFiles.map((file) => file.groupNumber)).size : listing.zippedFiles.length,
      expectedGroupCount,
      message: error instanceof DropboxBundleStateError
        ? error.message
        : 'Unable to verify the ZIP files in storage. Please try again.',
    };
  }
}

export async function createOrUpdateDropbox(context: ListingContext) {
  const { listing, listingPath } = await loadBundleListing(context);
  const digitalDownloadsZip = await createDigitalDownloadsZip(listing, listingPath);
  const token = await getDropboxAccessToken();
  const folderPath = listing.dropboxBundle?.folderPath
    ?? `/${safeName(listing.localDirectoryName ?? listing.title)}-${randomUUID()}`;
  let folderCreated = false;
  let installedInstructionPdf: InstalledStorageReplacement | null = null;
  let dropboxUpdateCommitted = false;
  try {
    folderCreated = await ensureDropboxFolder(token, folderPath);
    const expectedRemoteNames = new Set<string>();
    await uploadDropboxFile(
      token,
      `${folderPath}/${digitalDownloadsZip.fileName}`,
      digitalDownloadsZip.contents,
    );
    expectedRemoteNames.add(digitalDownloadsZip.fileName);

    let sharedUrl = folderCreated ? null : listing.dropboxBundle?.sharedUrl ?? null;
    if (!sharedUrl) {
      try {
        const shared = await dropboxRpc('sharing/create_shared_link_with_settings', token, {
          path: folderPath,
          settings: { requested_visibility: 'public', access: 'viewer' },
        });
        sharedUrl = typeof shared.url === 'string' ? shared.url : null;
      } catch (error) {
        const links = await dropboxRpc('sharing/list_shared_links', token, { path: folderPath, direct_only: true });
        const first = Array.isArray(links.links) ? links.links[0] as Record<string, unknown> | undefined : undefined;
        sharedUrl = typeof first?.url === 'string' ? first.url : null;
        if (!sharedUrl) throw error;
      }
    }
    if (!sharedUrl) throw new Error('Dropbox did not return a shared link.');

    const generatedInstructionFiles = listing.files.filter(isDropboxInstructionPdfFile);
    const instructionPdfUpdate = (
      (listing.dropboxFiles.length > 0 && generatedInstructionFiles.length === 0)
      || (listing.dropboxBundle?.sharedUrl !== sharedUrl && generatedInstructionFiles.length > 0)
    )
      ? await prepareDropboxInstructionPdf(listing, sharedUrl)
      : null;

    const instructions = `Thank you for your purchase.\n\nDownload your files here:\n${sharedUrl}\n`;
    await removeObsoleteDropboxFiles(token, folderPath, expectedRemoteNames);

    if (instructionPdfUpdate) {
      installedInstructionPdf = await installStorageReplacement(
        path.join(listingPath, 'downloads', instructionPdfUpdate.fileName),
        instructionPdfUpdate.pdf,
      );
    }

    const syncedAt = new Date();
    const bundle = await prisma.$transaction(async (tx) => {
      const savedBundle = await tx.etsyListingDropboxBundle.upsert({
        where: { listingId: listing.id },
        create: { listingId: listing.id, folderPath, sharedUrl, instructions },
        update: { folderPath, sharedUrl, instructions },
      });
      if (instructionPdfUpdate) {
        if (instructionPdfUpdate.duplicateIds.length > 0) {
          await tx.etsyListingFile.deleteMany({ where: { id: { in: instructionPdfUpdate.duplicateIds } } });
        }
        if (instructionPdfUpdate.existingFile) {
          await tx.etsyListingFile.update({
            where: { id: instructionPdfUpdate.existingFile.id },
            data: instructionPdfUpdate.fileData,
          });
        } else {
          await tx.etsyListingFile.create({
            data: { listingId: listing.id, ...instructionPdfUpdate.fileData },
          });
        }
      }
      const markedCurrent = await tx.etsyListing.updateMany({
        where: {
          id: listing.id,
          downloadsRevision: listing.downloadsRevision,
        },
        data: {
          dropboxRevision: listing.downloadsRevision,
          dropboxSyncedAt: syncedAt,
          ...(instructionPdfUpdate ? { downloadsChanged: true, lastLocalChangeAt: syncedAt } : {}),
        },
      });
      if (markedCurrent.count !== 1) {
        throw new DropboxBundleStateError('The digital downloads changed while Dropbox was being updated. Please update Dropbox again.');
      }
      return savedBundle;
    });
    dropboxUpdateCommitted = true;
    if (installedInstructionPdf?.backupPath) {
      const cleanupFailures = await cleanupStoragePaths([installedInstructionPdf.backupPath]);
      if (cleanupFailures.length > 0) {
        console.warn('The Dropbox instruction PDF was updated, but its temporary rollback copy could not be removed.');
      }
    }
    return {
      folderPath: bundle.folderPath,
      sharedUrl: bundle.sharedUrl,
      dropboxRevision: listing.downloadsRevision,
      dropboxSyncedAt: syncedAt.toISOString(),
      pdfCreated: instructionPdfUpdate !== null || generatedInstructionFiles.length > 0,
    };
  } catch (error) {
    let instructionRollbackError: unknown = null;
    if (installedInstructionPdf && !dropboxUpdateCommitted) {
      try {
        await rollbackStorageReplacement(installedInstructionPdf);
        if (installedInstructionPdf.backupPath) {
          await cleanupStoragePaths([installedInstructionPdf.backupPath]);
        }
      } catch (caughtRollbackError) {
        instructionRollbackError = caughtRollbackError;
      }
    }
    if (folderCreated) {
      try { await dropboxRpc('files/delete_v2', token, { path: folderPath }); } catch { /* Retry will recreate the folder. */ }
    }
    if (instructionRollbackError) {
      throw new Error('Dropbox was not updated and the previous Etsy instruction PDF could not be restored.', {
        cause: instructionRollbackError,
      });
    }
    throw error;
  }
}

async function createLinkedPdf(title: string, url: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument({ size: 'A4', margin: 64 });
    const pageWidth = document.page.width;
    const sage = '#68755A';
    const darkSage = '#536149';
    const terracotta = '#C9764E';
    const cream = '#FCF8F1';
    const border = '#D8C8B4';
    const text = '#3E3935';
    const muted = '#6B645E';
    const headerPath = path.join(process.cwd(), 'public', 'pdf-assets', 'cosyhouseprints-header.png');

    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.rect(0, 0, document.page.width, document.page.height).fill(cream);
    document.image(headerPath, 20, 18, { width: pageWidth - 40, height: 158 });
    document.fillColor(darkSage).font('Times-Roman').fontSize(30)
      .text('CosyHousePrints', 120, 48, { width: pageWidth - 240, align: 'center' });
    document.fillColor(terracotta).font('Times-Roman').fontSize(12)
      .text('~  *  ~', 180, 86, { width: pageWidth - 360, align: 'center' });
    document.fillColor(muted).font('Helvetica').fontSize(11)
      .text('Printable Wall Art for Cosy Homes', 150, 106, { width: pageWidth - 300, align: 'center' });

    let titleSize = 30;
    document.font('Times-Roman');
    document.fontSize(titleSize);
    while (titleSize > 18 && document.widthOfString(title) > pageWidth - 120) {
      titleSize -= 1;
      document.fontSize(titleSize);
    }
    document.fillColor(darkSage).fontSize(titleSize)
      .text(title, 55, 190, { width: pageWidth - 110, align: 'center', height: 42, ellipsis: true });
    document.fillColor(terracotta).fontSize(12)
      .text('~  *  ~', 180, 230, { width: pageWidth - 360, align: 'center' });
    document.font('Times-Roman').fontSize(14)
      .text('Thank you for purchasing from CosyHousePrints', 55, 254, { width: pageWidth - 110, align: 'center' });
    document.fillColor(text).font('Helvetica').fontSize(10)
      .text('Your digital files are available using the secure Dropbox link below.', 55, 279, { width: pageWidth - 110, align: 'center' });

    const buttonX = 145;
    const buttonY = 305;
    const buttonWidth = pageWidth - 290;
    document.roundedRect(buttonX, buttonY, buttonWidth, 45, 8).fill(sage);
    document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15)
      .text('DOWNLOAD YOUR FILES', buttonX, buttonY + 14, { width: buttonWidth, align: 'center' });
    document.link(buttonX, buttonY, buttonWidth, 45, url);

    document.roundedRect(80, 370, pageWidth - 160, 67, 7).lineWidth(1).strokeColor(border).stroke();
    document.circle(111, 403, 20).fillAndStroke('#F1EDE3', border);
    document.fillColor(sage).font('Helvetica-Bold').fontSize(13).text('>>', 99, 395, { width: 24, align: 'center' });
    document.fillColor(text).font('Helvetica-Bold').fontSize(9)
      .text('Button not working? Copy and paste this link into your browser:', 140, 382, { width: pageWidth - 240 });
    document.fillColor(muted).font('Helvetica').fontSize(8)
      .text(url, 140, 399, { width: pageWidth - 240, height: 30, link: url, underline: false });

    const columnY = 470;
    const columnWidth = 145;
    const columns = [
      {
        x: 52,
        heading: 'How to download',
        body: '1. Click the download button above.\n\n2. You will be taken to Dropbox.\n\n3. Use the download icon to save your files.',
      },
      {
        x: 225,
        heading: 'Your purchase includes',
        body: '- High-resolution JPEG files\n\n- Multiple print ratios and sizes\n\n- Ready for high-quality printing\n\n- Personal-use licence',
      },
      {
        x: 398,
        heading: 'Printing recommendation',
        body: 'For best results, print on matte photo paper or heavyweight cardstock using a high-quality printer.\n\nThis will bring out the colours and fine details beautifully.',
      },
    ];
    document.moveTo(210, columnY).lineTo(210, 650).strokeColor(border).stroke();
    document.moveTo(383, columnY).lineTo(383, 650).strokeColor(border).stroke();
    for (const column of columns) {
      document.circle(column.x + columnWidth / 2, columnY + 18, 17).fill('#F1EDE3');
      document.fillColor(sage).font('Times-Roman').fontSize(12)
        .text(column.heading, column.x, columnY + 45, { width: columnWidth, align: 'center' });
      document.fillColor(text).font('Helvetica').fontSize(8.5)
        .text(column.body, column.x + 5, columnY + 70, { width: columnWidth - 10, lineGap: 1.5 });
    }

    document.roundedRect(62, 685, pageWidth - 124, 68, 7).fillAndStroke('#F8F4EA', border);
    document.circle(101, 719, 22).fill('#E8E7DA');
    document.fillColor(sage).font('Helvetica').fontSize(18).text('@', 89, 708, { width: 24, align: 'center' });
    document.fillColor(darkSage).font('Times-Roman').fontSize(14).text('Need help?', 140, 699);
    document.fillColor(text).font('Helvetica').fontSize(9)
      .text('Please contact CosyHousePrints through Etsy messages and include your order number.', 140, 721, { width: pageWidth - 240 });

    document.moveTo(80, 785).lineTo(pageWidth - 80, 785).strokeColor(border).stroke();
    document.fillColor(muted).font('Helvetica').fontSize(8)
      .text('Digital product only   |   No physical item will be shipped   |   Personal use only', 55, 801, { width: pageWidth - 110, align: 'center' });
    document.end();
  });
}

export async function createDropboxInstructionPdf(context: ListingContext) {
  const { listing, listingPath } = await loadBundleListing(context);
  const sharedUrl = listing.dropboxBundle?.sharedUrl;
  if (!sharedUrl) throw new Error('Create the Dropbox bundle before creating the PDF.');
  if (!listing.dropboxSyncedAt || listing.dropboxRevision !== listing.downloadsRevision) {
    throw new DropboxBundleStateError('Update Dropbox before creating the PDF because the downloads have changed.');
  }
  const instructionPdf = await prepareDropboxInstructionPdf(listing, sharedUrl);
  const installedInstructionPdf = await installStorageReplacement(
    path.join(listingPath, 'downloads', instructionPdf.fileName),
    instructionPdf.pdf,
  );
  let databaseCommitted = false;

  try {
    await prisma.$transaction(async (tx) => {
      if (instructionPdf.duplicateIds.length > 0) {
        await tx.etsyListingFile.deleteMany({ where: { id: { in: instructionPdf.duplicateIds } } });
      }
      if (instructionPdf.existingFile) {
        await tx.etsyListingFile.update({
          where: { id: instructionPdf.existingFile.id },
          data: instructionPdf.fileData,
        });
      } else {
        await tx.etsyListingFile.create({
          data: { listingId: listing.id, ...instructionPdf.fileData },
        });
      }
      await tx.etsyListing.update({
        where: { id: listing.id },
        data: { downloadsChanged: true, lastLocalChangeAt: new Date() },
      });
    });
    databaseCommitted = true;
  } catch (error) {
    let rollbackError: unknown = null;
    try {
      await rollbackStorageReplacement(installedInstructionPdf);
      if (installedInstructionPdf.backupPath) {
        await cleanupStoragePaths([installedInstructionPdf.backupPath]);
      }
    } catch (caughtRollbackError) {
      rollbackError = caughtRollbackError;
    }
    if (rollbackError) {
      throw new Error('The instruction PDF was not saved and the previous file could not be restored.', {
        cause: rollbackError,
      });
    }
    throw error;
  } finally {
    if (databaseCommitted && installedInstructionPdf.backupPath) {
      const cleanupFailures = await cleanupStoragePaths([installedInstructionPdf.backupPath]);
      if (cleanupFailures.length > 0) {
        console.warn('The instruction PDF was saved, but its temporary rollback copy could not be removed.');
      }
    }
  }

  return { fileName: instructionPdf.fileName, sizeBytes: instructionPdf.pdf.length };
}
