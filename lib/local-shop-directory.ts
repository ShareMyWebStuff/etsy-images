import path from 'node:path';
import { ETSY_LISTINGS_DIRECTORY } from '@/lib/config';
import { mkdir, readdir, rename, stat } from '@/lib/s3-listing-storage';

const INVALID_WINDOWS_PATH_CHARS = /[<>:"/\\|?*\x00-\x1F]/;

export function getShopDirectoryPath(shopName: string) {
  const trimmedShopName = shopName.trim();

  if (!trimmedShopName) {
    throw new Error('Shop name is required.');
  }

  if (INVALID_WINDOWS_PATH_CHARS.test(trimmedShopName)) {
    throw new Error(`Shop name contains characters that cannot be used in a Windows folder name: ${trimmedShopName}`);
  }

  const rootPath = path.resolve(ETSY_LISTINGS_DIRECTORY);
  const shopPath = path.resolve(rootPath, trimmedShopName);

  if (shopPath !== rootPath && !shopPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error('Shop directory must stay inside the Etsy listings directory.');
  }

  return shopPath;
}

function getValidatedDirectoryName(value: string, label: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error(`${label} is required.`);
  }

  if (INVALID_WINDOWS_PATH_CHARS.test(trimmedValue)) {
    throw new Error(`${label} contains characters that cannot be used in a Windows folder name: ${trimmedValue}`);
  }

  return trimmedValue;
}

export async function shopDirectoryExists(shopName: string) {
  try {
    const directoryStats = await stat(getShopDirectoryPath(shopName));
    return directoryStats.isDirectory();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function createShopDirectory(shopName: string) {
  const shopPath = getShopDirectoryPath(shopName);
  await mkdir(shopPath, { recursive: true });
  return shopPath;
}

export function getSectionDirectoryPath(shopName: string, sectionName: string) {
  const shopPath = getShopDirectoryPath(shopName);
  const validatedSectionName = getValidatedDirectoryName(sectionName, 'Section name');
  const sectionPath = path.resolve(shopPath, validatedSectionName);

  if (sectionPath !== shopPath && !sectionPath.startsWith(`${shopPath}${path.sep}`)) {
    throw new Error('Section directory must stay inside the shop directory.');
  }

  return sectionPath;
}

export async function sectionDirectoryExists(shopName: string, sectionName: string) {
  try {
    const directoryStats = await stat(getSectionDirectoryPath(shopName, sectionName));
    return directoryStats.isDirectory();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function createSectionDirectory(shopName: string, sectionName: string) {
  const sectionPath = getSectionDirectoryPath(shopName, sectionName);
  await mkdir(sectionPath);
  return sectionPath;
}

export async function listShopSectionDirectories(shopName: string) {
  const shopPath = getShopDirectoryPath(shopName);
  const entries = await readdir(shopPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((first, second) => first.localeCompare(second));
}

export function getSubSectionDirectoryPath(shopName: string, sectionName: string, subSectionName: string) {
  void subSectionName;
  return getSectionDirectoryPath(shopName, sectionName);
}

export async function createSubSectionDirectory(shopName: string, sectionName: string, subSectionName: string) {
  const subSectionPath = getSubSectionDirectoryPath(shopName, sectionName, subSectionName);
  await mkdir(subSectionPath, { recursive: true });
  return subSectionPath;
}

async function directoryExists(directoryPath: string) {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function renameSubSectionDirectory(
  shopName: string,
  sectionName: string,
  currentName: string,
  newName: string
) {
  const currentPath = getSubSectionDirectoryPath(shopName, sectionName, currentName);
  const newPath = getSubSectionDirectoryPath(shopName, sectionName, newName);

  if (currentPath === newPath || !(await directoryExists(currentPath))) {
    return false;
  }

  const isCaseOnlyRename = currentPath.toLocaleLowerCase() === newPath.toLocaleLowerCase();
  if (!isCaseOnlyRename && (await directoryExists(newPath))) {
    throw new Error(`A directory named "${newName}" already exists.`);
  }

  if (isCaseOnlyRename) {
    const temporaryPath = `${currentPath}.rename-${Date.now()}`;
    await rename(currentPath, temporaryPath);
    try {
      await rename(temporaryPath, newPath);
    } catch (error) {
      await rename(temporaryPath, currentPath);
      throw error;
    }
  } else {
    await rename(currentPath, newPath);
  }

  return true;
}

export function getListingDirectoryPath(shopName: string, sectionName: string, subSectionName: string, listingName: string) {
  const subSectionPath = getSubSectionDirectoryPath(shopName, sectionName, subSectionName);
  const validatedListingName = getValidatedDirectoryName(listingName, 'Listing name');
  const listingPath = path.resolve(subSectionPath, validatedListingName);

  if (listingPath !== subSectionPath && !listingPath.startsWith(`${subSectionPath}${path.sep}`)) {
    throw new Error('Listing directory must stay inside the section directory.');
  }

  return listingPath;
}

export async function listingDirectoryExists(shopName: string, sectionName: string, subSectionName: string, listingName: string) {
  try {
    const directoryStats = await stat(getListingDirectoryPath(shopName, sectionName, subSectionName, listingName));
    return directoryStats.isDirectory();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function listingDirectoryIsEmpty(
  shopName: string,
  sectionName: string,
  subSectionName: string,
  listingName: string
) {
  const listingPath = getListingDirectoryPath(shopName, sectionName, subSectionName, listingName);
  return (await readdir(listingPath, { withFileTypes: true })).length === 0;
}

export async function createListingDirectory(shopName: string, sectionName: string, subSectionName: string, listingName: string) {
  const listingPath = getListingDirectoryPath(shopName, sectionName, subSectionName, listingName);
  await mkdir(listingPath, { recursive: true });
  return listingPath;
}

export async function listSubSectionListingDirectories(shopName: string, sectionName: string, subSectionName: string) {
  const subSectionPath = getSubSectionDirectoryPath(shopName, sectionName, subSectionName);
  const entries = await readdir(subSectionPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((first, second) => first.localeCompare(second));
}
