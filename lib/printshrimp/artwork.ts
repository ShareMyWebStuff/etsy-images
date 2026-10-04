import { createHash } from 'node:crypto';
import path from 'node:path';

import sharp from 'sharp';
import {
  getPrintableDownloadRole,
  isPrintableDownloadImageValid,
  PRINTABLE_DOWNLOAD_SPECS,
  type PrintableDownloadRatio,
} from '@/lib/printable-download-specs';

export const PRINTSHRIMP_RATIOS = ['A', '5x7', '4x5', '11x14', '3x4', '2x3'] as const;
export type PrintShrimpRatio = typeof PRINTSHRIMP_RATIOS[number];

const PRINTSHRIMP_SOURCE_ROLES: Record<PrintShrimpRatio, PrintableDownloadRatio> = {
  A: 'iso-a1',
  '5x7': '5x7',
  '4x5': '4x5',
  '11x14': '11x14',
  '3x4': '3x4',
  '2x3': '2x3',
};

const PRINTSHRIMP_RATIO_BY_SOURCE_ROLE = Object.fromEntries(
  Object.entries(PRINTSHRIMP_SOURCE_ROLES).map(([ratio, role]) => [role, ratio]),
) as Record<PrintableDownloadRatio, PrintShrimpRatio>;

// Exact, case-sensitive values accepted by PrintShrimp. We intersect this
// list with the sizes covered by each Digital Download master below.
export const PRINTSHRIMP_SUPPORTED_SIZES = [
  'A5', 'A4', 'A3', 'A2', 'A1',
  '5x7', '6x8', '8x10', '11x14', '12x18', '16x20', '16x24',
  '18x24', '20x30', '24x36', '30x40cm', '50x70cm',
] as const;

function printShrimpSizeName(downloadSize: string) {
  const normalized = downloadSize.replace(/\s+/g, '').replace(/×/g, 'x').replace(/in$/i, '');
  return PRINTSHRIMP_SUPPORTED_SIZES.find(
    (size) => size.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  ) ?? null;
}

function variantSizesForSourceRole(role: PrintableDownloadRatio) {
  const spec = PRINTABLE_DOWNLOAD_SPECS.find((candidate) => candidate.key === role)!;
  return spec.supportedSizes
    .map(printShrimpSizeName)
    .filter((size): size is (typeof PRINTSHRIMP_SUPPORTED_SIZES)[number] => size !== null);
}

export const PRINTSHRIMP_RATIO_DETAILS: ReadonlyArray<{
  ratio: PrintShrimpRatio;
  aspectRatio: number;
  physicalSizes: string;
  variantSizes: readonly string[];
}> = ([
  { ratio: 'A', aspectRatio: 1 / Math.sqrt(2) },
  { ratio: '5x7', aspectRatio: 5 / 7 },
  { ratio: '4x5', aspectRatio: 4 / 5 },
  { ratio: '11x14', aspectRatio: 11 / 14 },
  { ratio: '3x4', aspectRatio: 3 / 4 },
  { ratio: '2x3', aspectRatio: 2 / 3 },
] as const).map(({ ratio, aspectRatio }) => {
  const variantSizes = variantSizesForSourceRole(PRINTSHRIMP_SOURCE_ROLES[ratio]);
  return { ratio, aspectRatio, physicalSizes: variantSizes.join(', '), variantSizes };
});

export function getPrintShrimpVariantSizes(ratio: PrintShrimpRatio) {
  return PRINTSHRIMP_RATIO_DETAILS.find((item) => item.ratio === ratio)!.variantSizes;
}

export function getPrintShrimpRatioForSize(size: string) {
  return PRINTSHRIMP_RATIO_DETAILS.find((item) => item.variantSizes.some((candidate) => candidate === size))?.ratio ?? null;
}

export type PrintShrimpSourceFile = {
  id: number;
  localFileName: string | null;
  originalFileName: string | null;
  widthPixels: number | null;
  heightPixels: number | null;
  rawJson?: unknown;
};

export type PrintShrimpRatioMapping = {
  files: Map<PrintShrimpRatio, PrintShrimpSourceFile>;
  missingRatios: PrintShrimpRatio[];
  duplicateRatios: PrintShrimpRatio[];
};

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const RATIO_TOLERANCE = 0.005;

function ratioFromFileName(fileName: string) {
  const normalized = path.basename(fileName, path.extname(fileName)).toLowerCase();
  if (/(^|[_-])(?:iso[_-]?)?a(?:1|2|3|4|5)?([_-]|$)/.test(normalized)) return 'A' as const;
  for (const ratio of ['11x14', '5x7', '4x5', '3x4', '2x3'] as const) {
    if (new RegExp(`(^|[_-])${ratio.replace('x', '[x×]')}([_-]|$)`).test(normalized)) return ratio;
  }
  return null;
}

export function identifyPrintShrimpRatio(file: Pick<PrintShrimpSourceFile, 'originalFileName' | 'localFileName' | 'widthPixels' | 'heightPixels'>) {
  const width = file.widthPixels;
  const height = file.heightPixels;
  if (width && height && width > 0 && height > 0) {
    const actual = Math.min(width, height) / Math.max(width, height);
    const nearest = PRINTSHRIMP_RATIO_DETAILS
      .map((candidate) => ({ ratio: candidate.ratio, difference: Math.abs(candidate.aspectRatio - actual) }))
      .sort((first, second) => first.difference - second.difference)[0];
    if (nearest.difference <= RATIO_TOLERANCE) return nearest.ratio;
  }

  const name = file.originalFileName ?? file.localFileName;
  return name ? ratioFromFileName(name) : null;
}

export function mapPrintShrimpRatioFiles(files: PrintShrimpSourceFile[]): PrintShrimpRatioMapping {
  const mapped = new Map<PrintShrimpRatio, PrintShrimpSourceFile>();
  const duplicates = new Set<PrintShrimpRatio>();

  for (const file of files) {
    const name = file.originalFileName ?? file.localFileName ?? '';
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
    const sourceRole = getPrintableDownloadRole(file);
    if (!sourceRole || sourceRole === 'guide' || !isPrintableDownloadImageValid(file, sourceRole)) continue;
    const ratio = PRINTSHRIMP_RATIO_BY_SOURCE_ROLE[sourceRole];
    if (mapped.has(ratio)) duplicates.add(ratio);
    else mapped.set(ratio, file);
  }

  return {
    files: mapped,
    missingRatios: PRINTSHRIMP_RATIOS.filter((ratio) => !mapped.has(ratio)),
    duplicateRatios: PRINTSHRIMP_RATIOS.filter((ratio) => duplicates.has(ratio)),
  };
}

export function validatePrintShrimpBaseSku(value: string | null | undefined) {
  const sku = value?.trim() ?? '';
  if (!sku) throw new Error('Add an Etsy SKU before syncing to PrintShrimp.');
  if (!/^[A-Za-z0-9_-]+$/.test(sku)) {
    throw new Error('The Etsy SKU may contain only letters, numbers, hyphens and underscores for PrintShrimp.');
  }
  if (sku.length > 50) {
    throw new Error('The Etsy SKU is too long. PrintShrimp allows a maximum of 50 characters.');
  }
  return sku;
}

export function getPrintShrimpArtworkIdentity(baseSku: string, ratio: PrintShrimpRatio) {
  const sku = validatePrintShrimpBaseSku(baseSku);
  return { sku, fileName: `${sku}_${ratio}.jpg` };
}

export function hashPrintShrimpSource(source: Buffer, ratio: PrintShrimpRatio) {
  return createHash('sha256')
    .update('printshrimp-six-download-sources-v1\0')
    .update(ratio)
    .update('\0')
    .update(getPrintShrimpVariantSizes(ratio).join(','))
    .update('\0')
    .update(source)
    .digest('hex');
}

export async function convertPrintShrimpArtwork(source: Buffer) {
  const inputMetadata = await sharp(source, { failOn: 'error' }).metadata();
  if (!inputMetadata.width || !inputMetadata.height) throw new Error('The artwork image dimensions could not be read.');

  const jpeg = await sharp(source, { failOn: 'error' })
    .flatten({ background: '#FFFFFF' })
    .toColourspace('srgb')
    .withMetadata({ density: 300 })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const outputMetadata = await sharp(jpeg).metadata();

  if (outputMetadata.width !== inputMetadata.width || outputMetadata.height !== inputMetadata.height) {
    throw new Error('PrintShrimp artwork conversion changed the image dimensions.');
  }
  if (outputMetadata.hasAlpha || outputMetadata.channels !== 3) {
    throw new Error('PrintShrimp artwork conversion did not produce a flattened RGB JPEG.');
  }

  return {
    jpeg,
    width: inputMetadata.width,
    height: inputMetadata.height,
    density: outputMetadata.density ?? 300,
  };
}
