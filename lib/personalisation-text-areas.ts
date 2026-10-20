import { PRINTABLE_DOWNLOAD_SPECS, type PrintableDownloadRatio } from '@/lib/printable-download-specs';

export type PersonalisationTextArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ListingPersonalisationTextAreas = {
  showTop: boolean;
  showBottom: boolean;
  top: PersonalisationTextArea;
  bottom: PersonalisationTextArea;
};

export type ListingPersonalisationTextAreaSettings = {
  version: 2;
  areasByRatio: Record<PrintableDownloadRatio, ListingPersonalisationTextAreas>;
};

export const DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS: ListingPersonalisationTextAreas = {
  showTop: true,
  showBottom: true,
  top: { x: 0, y: 0.05, width: 1, height: 0.1 },
  bottom: { x: 0, y: 0.85, width: 1, height: 0.1 },
};

function cloneAreas(value: ListingPersonalisationTextAreas): ListingPersonalisationTextAreas {
  return {
    showTop: value.showTop,
    showBottom: value.showBottom,
    top: { ...value.top },
    bottom: { ...value.bottom },
  };
}

export function defaultListingPersonalisationTextAreaSettings(): ListingPersonalisationTextAreaSettings {
  return {
    version: 2,
    areasByRatio: Object.fromEntries(PRINTABLE_DOWNLOAD_SPECS.map(({ key }) => [
      key,
      cloneAreas(DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS),
    ])) as Record<PrintableDownloadRatio, ListingPersonalisationTextAreas>,
  };
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function textArea(value: unknown, label: string): PersonalisationTextArea {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const record = value as Record<string, unknown>;
  const area = {
    x: finiteNumber(record.x, `${label} horizontal position`),
    y: finiteNumber(record.y, `${label} vertical position`),
    width: finiteNumber(record.width, `${label} width`),
    height: finiteNumber(record.height, `${label} height`),
  };
  const tolerance = 0.000001;
  if (area.x < 0 || area.y < 0 || area.width < 0.02 || area.height < 0.02
    || area.x + area.width > 1 + tolerance || area.y + area.height > 1 + tolerance) {
    throw new Error(`${label} must remain inside the artwork and be at least 2% wide and high.`);
  }
  return {
    x: Math.max(0, Math.min(1, area.x)),
    y: Math.max(0, Math.min(1, area.y)),
    width: Math.min(1 - area.x, area.width),
    height: Math.min(1 - area.y, area.height),
  };
}

function validateTextAreaLayout(value: unknown, label = 'personalisation text areas'): ListingPersonalisationTextAreas {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`The ${label} are invalid.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.showTop !== 'boolean' || typeof record.showBottom !== 'boolean') {
    throw new Error('Choose whether to show the top and bottom text.');
  }
  return {
    showTop: record.showTop,
    showBottom: record.showBottom,
    top: textArea(record.top, 'Top Text area'),
    bottom: textArea(record.bottom, 'Bottom Text area'),
  };
}

export function validateListingPersonalisationTextAreas(value: unknown): ListingPersonalisationTextAreaSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The personalisation text areas are invalid.');
  }
  const record = value as Record<string, unknown>;
  if (record.version === 2 && record.areasByRatio && typeof record.areasByRatio === 'object' && !Array.isArray(record.areasByRatio)) {
    const input = record.areasByRatio as Record<string, unknown>;
    return {
      version: 2,
      areasByRatio: Object.fromEntries(PRINTABLE_DOWNLOAD_SPECS.map(({ key, label }) => [
        key,
        validateTextAreaLayout(input[key], `${label} personalisation text areas`),
      ])) as Record<PrintableDownloadRatio, ListingPersonalisationTextAreas>,
    };
  }
  // Version 1 stored one normalized layout. Preserve existing listings by
  // applying that layout to every ratio until the user saves the new editor.
  const legacy = validateTextAreaLayout(value);
  return {
    version: 2,
    areasByRatio: Object.fromEntries(PRINTABLE_DOWNLOAD_SPECS.map(({ key }) => [
      key,
      cloneAreas(legacy),
    ])) as Record<PrintableDownloadRatio, ListingPersonalisationTextAreas>,
  };
}

export function parseListingPersonalisationTextAreas(value: unknown): ListingPersonalisationTextAreaSettings | null {
  if (value === null || value === undefined) return null;
  try {
    return validateListingPersonalisationTextAreas(value);
  } catch {
    return null;
  }
}

export function effectiveListingPersonalisationTextAreas(
  value: unknown,
  permissions: { customisePrints: boolean; customTop: boolean; customBottom: boolean },
  ratio: PrintableDownloadRatio = '2x3',
) {
  const settings = parseListingPersonalisationTextAreas(value);
  const saved = settings?.areasByRatio[ratio] ?? null;
  const areas = saved ?? DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS;
  return {
    settings,
    saved,
    top: areas.top,
    bottom: areas.bottom,
    showTop: permissions.customisePrints && permissions.customTop && areas.showTop,
    showBottom: permissions.customisePrints && permissions.customBottom && areas.showBottom,
  };
}
