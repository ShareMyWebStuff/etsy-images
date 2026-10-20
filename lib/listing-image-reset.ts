import path from 'node:path';
import { readFile, unlink, writeFile } from '@/lib/s3-listing-storage';

type ListingImageFile = {
  localFileName: string | null;
};

function isMissingFile(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function restoreFiles(backups: ReadonlyMap<string, Buffer>) {
  const failures: unknown[] = [];
  for (const [filePath, contents] of backups) {
    try {
      await writeFile(filePath, contents);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

/**
 * Removes listing image objects first, then commits the matching database
 * deletion. Existing objects are retained in memory until the database work
 * succeeds so they can be restored if either step fails.
 */
export async function removeListingImages(
  listingPath: string,
  images: readonly ListingImageFile[],
  deleteDatabaseRows: () => Promise<void>,
) {
  const fileNames = [...new Set(images
    .map((image) => image.localFileName?.trim())
    .filter((fileName): fileName is string => Boolean(fileName))
  )];

  for (const fileName of fileNames) {
    if (path.basename(fileName) !== fileName) {
      throw new Error(`Cannot remove listing image with an unsafe file name: ${fileName}`);
    }
  }

  const backups = new Map<string, Buffer>();
  for (const fileName of fileNames) {
    const filePath = path.join(listingPath, fileName);
    try {
      backups.set(filePath, await readFile(filePath));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  try {
    for (const fileName of fileNames) {
      try {
        await unlink(path.join(listingPath, fileName));
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
    await deleteDatabaseRows();
  } catch (error) {
    const restoreFailures = await restoreFiles(backups);
    if (restoreFailures.length > 0) {
      throw new Error(
        'Unable to remove the existing listing images, and one or more S3 images could not be restored.',
        { cause: error },
      );
    }
    throw error;
  }
}
