import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STAGING_ROOT = path.join(process.cwd(), '.tmp', 'multi-listing-uploads');
const TOKEN_PATTERN = /^[0-9a-f-]{36}$/i;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function tokenDirectory(token: string) {
  if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid staged-upload token.');
  return path.join(STAGING_ROOT, token);
}

async function removeExpiredUploads() {
  await mkdir(STAGING_ROOT, { recursive: true });
  const entries = await readdir(STAGING_ROOT, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = path.join(STAGING_ROOT, entry.name);
    const details = await stat(directory);
    if (Date.now() - details.mtimeMs > MAX_AGE_MS) await rm(directory, { recursive: true, force: true });
  }));
}

export async function stageTwelveListingImages(token: string | null, images: Array<{ slot: number; file: File }>) {
  await removeExpiredUploads();
  const stagingToken = token && TOKEN_PATTERN.test(token) ? token : randomUUID();
  const directory = tokenDirectory(stagingToken);
  await mkdir(directory, { recursive: true });

  for (const { slot, file } of images) {
    if (!Number.isInteger(slot) || slot < 1 || slot > 8) throw new Error('Invalid image slot.');
    if (!file.type.startsWith('image/')) throw new Error('Only image uploads are allowed.');
    const extension = path.extname(file.name).toLowerCase() || '.jpg';
    const metadata = { name: file.name, type: file.type, extension };
    await Promise.all([
      writeFile(path.join(directory, `image${slot}${extension}`), Buffer.from(await file.arrayBuffer())),
      writeFile(path.join(directory, `image${slot}.json`), JSON.stringify(metadata), 'utf8'),
    ]);
  }
  return stagingToken;
}

export async function loadTwelveListingImages(token: string) {
  const directory = tokenDirectory(token);
  const entries = await readdir(directory);
  return Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const slot = index + 1;
    const metadataName = `image${slot}.json`;
    if (!entries.includes(metadataName)) return null;
    const metadata = JSON.parse(await readFile(path.join(directory, metadataName), 'utf8')) as { name: string; type: string; extension: string };
    const contents = await readFile(path.join(directory, `image${slot}${metadata.extension}`));
    return new File([contents], metadata.name, { type: metadata.type });
  }));
}

export async function removeStagedTwelveListingImages(token: string) {
  await rm(tokenDirectory(token), { recursive: true, force: true });
}
