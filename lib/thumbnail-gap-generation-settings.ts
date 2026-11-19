import type { Prisma } from '@prisma/client';
import type { ListingCustomisationSettings } from '@/lib/listing-customisation';
import {
  createListingPrintCropSettings,
  defaultNativeListingPrintCropDraft,
  parseCurrentListingPrintCropSettings,
  type ListingArtworkOrientation,
  type ListingPrintCropSettings,
} from '@/lib/listing-print-crops';
import {
  defaultListingPersonalisationTextAreaSettings,
  parseListingPersonalisationTextAreas,
} from '@/lib/personalisation-text-areas';

type ThumbnailGapGenerationSettingsInput = {
  printCropSettings: unknown;
  personalisationTextAreas: unknown;
  previousSource: { fileName: string | null; updatedAt: string | null };
  source: ListingPrintCropSettings['source'];
  orientation: ListingArtworkOrientation;
  customisation: ListingCustomisationSettings;
};

function jsonValue(value: unknown): Prisma.JsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
}

/** The canvas is unchanged: keep valid paper selections and bind them to the new image. */
export function prepareThumbnailGapGenerationSettings(input: ThumbnailGapGenerationSettingsInput): {
  printCropSettings: Prisma.JsonValue;
  personalisationTextAreas: Prisma.JsonValue | null;
} {
  const current = parseCurrentListingPrintCropSettings(input.printCropSettings, {
    ...input.previousSource,
    orientation: input.orientation,
  });
  let printCropSettings: Prisma.JsonValue | null = null;
  if (current && current.source.width === input.source.width && current.source.height === input.source.height) {
    // Retain the stored version too. Upgrading a valid legacy crop here can alter
    // its placements, or subject a zoomed version 1 crop to version 3 validation.
    const stored = typeof input.printCropSettings === 'string'
      ? JSON.parse(input.printCropSettings) as Record<string, unknown>
      : input.printCropSettings as Record<string, unknown>;
    const rebound = { ...stored, source: { ...input.source } };
    if (parseCurrentListingPrintCropSettings(rebound, {
      fileName: input.source.fileName,
      updatedAt: input.source.updatedAt,
      orientation: input.orientation,
    })) printCropSettings = jsonValue(rebound);
  }
  if (!printCropSettings) {
    printCropSettings = jsonValue(createListingPrintCropSettings(
      defaultNativeListingPrintCropDraft(input.source.width, input.source.height, input.orientation),
      input.source,
      input.orientation,
    ));
  }

  const savedTextAreas = parseListingPersonalisationTextAreas(input.personalisationTextAreas);
  if (savedTextAreas) return { printCropSettings, personalisationTextAreas: jsonValue(savedTextAreas) };
  if (!input.customisation.customisePrints || (!input.customisation.customTop && !input.customisation.customBottom)) {
    return { printCropSettings, personalisationTextAreas: null };
  }
  const defaults = defaultListingPersonalisationTextAreaSettings();
  for (const areas of Object.values(defaults.areasByRatio)) {
    areas.showTop = input.customisation.customTop;
    areas.showBottom = input.customisation.customBottom;
  }
  return { printCropSettings, personalisationTextAreas: jsonValue(defaults) };
}
