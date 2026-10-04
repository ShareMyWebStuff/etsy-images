export const PRINTABLE_DOWNLOAD_GUIDE_FILE_NAME = 'How_To_Print_Guide.pdf';

export const PRINTABLE_DOWNLOAD_SPECS = [
  {
    key: 'iso-a1',
    label: 'ISO A1',
    fileToken: 'ISO_A1',
    masterToken: '',
    portraitWidth: 7016,
    portraitHeight: 9933,
    supportedSizes: ['A1', 'A2', 'A3', 'A4', 'A5'],
    matchTokens: ['isoa1'],
  },
  {
    key: '2x3',
    label: '2 x 3 (24 x 36 inches)',
    fileToken: '2x3',
    masterToken: '24x36',
    portraitWidth: 7200,
    portraitHeight: 10800,
    supportedSizes: ['4 x 6 in', '6 x 9 in', '8 x 12 in', '10 x 15 in', '12 x 18 in', '16 x 24 in', '20 x 30 in', '24 x 36 in'],
    matchTokens: ['2x3', '24x36'],
  },
  {
    key: '3x4',
    label: '3 x 4 (30 x 40 cm)',
    fileToken: '3x4',
    masterToken: '18x24',
    portraitWidth: 5400,
    portraitHeight: 7200,
    supportedSizes: ['6 x 8 in', '9 x 12 in', '12 x 16 in', '15 x 20 in', '18 x 24 in', '30 x 40 cm'],
    matchTokens: ['3x4', '18x24', '30x40'],
  },
  {
    key: '4x5',
    label: '4 x 5 (16 x 20 inches)',
    fileToken: '4x5',
    masterToken: '16x20',
    portraitWidth: 4800,
    portraitHeight: 6000,
    supportedSizes: ['4 x 5 in', '8 x 10 in', '12 x 15 in', '16 x 20 in'],
    matchTokens: ['4x5', '16x20'],
  },
  {
    key: '11x14',
    label: '11 x 14 (11 x 14 inches)',
    fileToken: '11x14',
    masterToken: '11x14',
    portraitWidth: 3300,
    portraitHeight: 4200,
    supportedSizes: ['11 x 14 in'],
    matchTokens: ['11x14'],
  },
  {
    key: '5x7',
    label: '5 x 7 (50 x 70 cm)',
    fileToken: '5x7',
    masterToken: '20x28',
    portraitWidth: 6000,
    portraitHeight: 8400,
    supportedSizes: ['5 x 7 in', '10 x 14 in', '15 x 21 in', '20 x 28 in', '50 x 70 cm'],
    matchTokens: ['5x7', '20x28', '50x70'],
  },
] as const;

export type PrintableDownloadRatio = (typeof PRINTABLE_DOWNLOAD_SPECS)[number]['key'];
export type PrintableDownloadRole = PrintableDownloadRatio | 'guide';
export type PrintableDownloadOrientation = 'portrait' | 'landscape';

type DownloadFileLike = {
  originalFileName?: string | null;
  localFileName?: string | null;
  fileName?: string | null;
  filename?: string | null;
  widthPixels?: number | null;
  heightPixels?: number | null;
  rawJson?: unknown;
};

function normalizedFileNames(file: DownloadFileLike) {
  return [file.originalFileName, file.localFileName, file.fileName, file.filename]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ''));
}

function generatedRole(file: DownloadFileLike): PrintableDownloadRole | null {
  if (!file.rawJson || typeof file.rawJson !== 'object' || Array.isArray(file.rawJson)) return null;
  const value = (file.rawJson as Record<string, unknown>).printableDownloadRole;
  return value === 'guide' || PRINTABLE_DOWNLOAD_SPECS.some((spec) => spec.key === value)
    ? value as PrintableDownloadRole
    : null;
}

export function getPrintableDownloadRole(file: DownloadFileLike): PrintableDownloadRole | null {
  const storedRole = generatedRole(file);
  if (storedRole) return storedRole;
  const names = normalizedFileNames(file);
  if (names.some((name) => name.includes('howtoprintguide'))) return 'guide';
  return PRINTABLE_DOWNLOAD_SPECS.find((spec) => (
    names.some((name) => spec.matchTokens.some((token) => name.includes(token)))
  ))?.key ?? null;
}

export function printableDownloadDimensions(
  ratio: PrintableDownloadRatio,
  orientation: PrintableDownloadOrientation,
) {
  const spec = PRINTABLE_DOWNLOAD_SPECS.find((candidate) => candidate.key === ratio);
  if (!spec) throw new Error('Choose a valid printable download ratio.');
  return orientation === 'landscape'
    ? { width: spec.portraitHeight, height: spec.portraitWidth }
    : { width: spec.portraitWidth, height: spec.portraitHeight };
}

export function isPrintableDownloadImageValid(file: DownloadFileLike, role: PrintableDownloadRatio) {
  if (!file.widthPixels || !file.heightPixels) return false;
  const portrait = printableDownloadDimensions(role, 'portrait');
  const landscape = printableDownloadDimensions(role, 'landscape');
  return (file.widthPixels === portrait.width && file.heightPixels === portrait.height)
    || (file.widthPixels === landscape.width && file.heightPixels === landscape.height);
}

export function getPrintableDownloadStatus(files: DownloadFileLike[]) {
  const items = PRINTABLE_DOWNLOAD_SPECS.map((spec) => {
    const matches = files.filter((file) => getPrintableDownloadRole(file) === spec.key);
    const file = matches.find((candidate) => isPrintableDownloadImageValid(candidate, spec.key)) ?? null;
    return { key: spec.key, label: spec.label, created: file !== null, file };
  });
  const guideCreated = files.some((file) => (
    getPrintableDownloadRole(file) === 'guide'
    && [file.originalFileName, file.localFileName, file.fileName, file.filename]
      .some((value) => typeof value === 'string' && /\.pdf$/i.test(value.trim()))
  ));
  const orientations = new Set(items.flatMap((item) => item.file
    ? [item.file.widthPixels! > item.file.heightPixels! ? 'landscape' : 'portrait']
    : []));
  const imagesComplete = items.every((item) => item.created) && orientations.size <= 1;
  return {
    items,
    guideCreated,
    completedCount: items.filter((item) => item.created).length + (guideCreated ? 1 : 0),
    complete: imagesComplete && guideCreated,
  };
}

export function hasRequiredPrintableDownloads(files: DownloadFileLike[]) {
  return getPrintableDownloadStatus(files).complete;
}
