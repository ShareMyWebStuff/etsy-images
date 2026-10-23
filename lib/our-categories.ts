import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma, type OurCategoryImageTemplate } from '@prisma/client';
import { imageSize } from 'image-size';
import sharp from 'sharp';

import {
  DEFAULT_ARTWORK_BACKGROUND_COLOUR,
  normalizeArtworkBackgroundColour,
  validateArtworkBackgroundColour,
  type ArtworkBackgroundColour,
} from '@/lib/artwork-background-colours';
import { ETSY_LISTINGS_DIRECTORY } from '@/lib/config';
import { createFontShowcaseImage, FONT_SHOWCASE_HEIGHT, FONT_SHOWCASE_WIDTH } from '@/lib/font-showcase-image';
import { ETSY_PRODUCT_FRAMES, ETSY_PRODUCT_SIZES, type EtsyProductSizeKey } from '@/lib/listing-products';
import {
  registerEtsySection,
  type EtsySectionUsage,
} from '@/lib/local-shop-sections';
import { validateOurCategoryTemplateOrder } from '@/lib/our-category-template-order';
import {
  prepareOurCategoryTemplateArtwork,
  validateOurCategoryTemplatePersonalisation,
} from '@/lib/our-category-template-personalisation';
import {
  composeOurCategoryTemplateWithArtworks,
  remapTemplateOpeningRegionImageItem,
  validateTemplateOpeningCorners,
  validateTemplateOpeningRegions,
  type TemplateOpeningCorners,
  type TemplateOpeningRegion,
} from '@/lib/our-category-template-composite';
import {
  DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
  type PrintShrimpCustomFontId,
} from '@/lib/printshrimp/custom-fonts';
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS,
  effectiveListingPersonalisationTextAreas,
  type ListingPersonalisationTextAreaSettings,
} from '@/lib/personalisation-text-areas';
import type { PrintableDownloadRatio } from '@/lib/printable-download-specs';
import type { ListingCustomisationSettings } from '@/lib/listing-customisation';
import { createListingPersonalisationPreview } from '@/lib/listing-personalisation-preview';
import { removeListingImages } from '@/lib/listing-image-reset';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import type { ListingArtworkOrientation, ListingPrintCropSettings } from '@/lib/listing-print-crops';
import { mkdir, readFile, readImagePreview, rm, unlink, writeFile } from '@/lib/s3-listing-storage';

const TEMPLATE_DIRECTORY = 'EtsyListingTemplates';
const MAX_TEMPLATE_BYTES = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const TEMPLATE_IMAGE_EXTENSIONS = new Set(['.png']);
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const SIZE_KEYS = ETSY_PRODUCT_SIZES.map(({ key }) => key);
const FRAME_KEYS = ETSY_PRODUCT_FRAMES.map(({ key }) => key);
const MULTIPLE_ITEM_COUNTS = [3, 6, 12] as const;
const TEMPLATE_PREVIEW_SIZE_BY_RATIO: Record<PrintableDownloadRatio, EtsyProductSizeKey> = {
  'iso-a1': 'a5',
  '2x3': '12x18',
  '3x4': '6x8',
  '4x5': '8x10',
  '5x7': '5x7',
  '11x14': '11x14',
};

export type OurTemplateType = 'single' | 'multiple';

export type OurCategoryImageTemplateDeletionImpact = {
  templateId: string;
  templateType: OurTemplateType;
  dependentTemplateImageCount: number;
  generatedListingImageCount: number;
  affectedListingCount: number;
  requiresCascade: boolean;
};

export type OurCategoryFormValues = {
  name: string;
  templateType: OurTemplateType;
  followedTemplateId: number | null;
  itemCount: number;
  roomTheme: string;
  backgroundColour: ArtworkBackgroundColour;
  printsFrames: boolean;
  customisePrints: boolean;
  digitalDownload: boolean;
  customTop: boolean;
  customBottom: boolean;
  printFrameSectionId: number | null;
  customisedSectionId: number | null;
  downloadSectionId: number | null;
  sizes: Record<string, boolean>;
  frames: Record<string, boolean>;
};

export type OurCategoryEtsySectionOption = {
  id: number;
  title: string;
  useForPrintFrames: boolean;
  useForCustomisedPrints: boolean;
  useForDigitalDownloads: boolean;
};

export type OurCategoryImageTemplateView = {
  id: string;
  name: string;
  description: string;
  originalFileName: string;
  useOnPrints: boolean;
  useOnCustomised: boolean;
  useOnDigital: boolean;
  imageWidth: number | null;
  imageHeight: number | null;
  openingRegions: TemplateOpeningRegion[];
  displayFonts: boolean;
  borderEnabled: boolean;
  borderSizePercent: number;
  topText: string;
  bottomText: string;
  fontId: PrintShrimpCustomFontId;
  isLinked: boolean;
  linkedSourceCategoryId: number | null;
  linkedSourceImageTemplateId: number | null;
  linkedImageItemNumber: number | null;
  linkedSourceTemplateName: string | null;
  linkedSourceImageTemplateName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OurCategoryCopySourceTemplate = {
  id: number;
  name: string;
  templateType: OurTemplateType;
  itemCount: number;
  imageTemplates: OurCategoryImageTemplateView[];
};

export type OurCategoryEditorData = {
  categoryId: string | null;
  shopId: string;
  values: OurCategoryFormValues;
  sizes: Array<{ key: string; label: string }>;
  frames: Array<{ key: string; label: string }>;
  etsySections: OurCategoryEtsySectionOption[];
  imageTemplates: OurCategoryImageTemplateView[];
  singleTemplates: Array<{ id: number; name: string; values: OurCategoryFormValues }>;
  followedImageTemplates: OurCategoryImageTemplateView[];
  copySourceTemplates: OurCategoryCopySourceTemplate[];
};

export type OurCategoryListRow = {
  id: string;
  name: string;
  templateType: OurTemplateType;
  followedTemplateName: string | null;
  listingCount: number;
  imageTemplateCount: number;
};

function defaultBooleanMap(keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, true]));
}

export function defaultOurCategoryValues(templateType: OurTemplateType = 'single'): OurCategoryFormValues {
  const multiple = templateType === 'multiple';
  return {
    name: '',
    templateType,
    followedTemplateId: null,
    itemCount: multiple ? 3 : 1,
    roomTheme: '',
    backgroundColour: DEFAULT_ARTWORK_BACKGROUND_COLOUR,
    printsFrames: !multiple,
    customisePrints: !multiple,
    digitalDownload: !multiple,
    customTop: !multiple,
    customBottom: !multiple,
    printFrameSectionId: null,
    customisedSectionId: null,
    downloadSectionId: null,
    sizes: Object.fromEntries(SIZE_KEYS.map((key) => [key, !multiple])),
    frames: Object.fromEntries(FRAME_KEYS.map((key) => [key, !multiple])),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBooleanMap(value: unknown, keys: readonly string[], label: string) {
  if (!isRecord(value)) throw new Error(`${label} must contain every available option.`);
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key)) || keys.some((key) => typeof value[key] !== 'boolean')) {
    throw new Error(`${label} contains an invalid option.`);
  }
  return Object.fromEntries(keys.map((key) => [key, value[key] as boolean]));
}

function storedBooleanMap(value: Prisma.JsonValue, keys: readonly string[]) {
  let stored: unknown = value;
  if (typeof stored === 'string') {
    try { stored = JSON.parse(stored); } catch { stored = null; }
  }
  if (!isRecord(stored)) return defaultBooleanMap(keys);
  return Object.fromEntries(keys.map((key) => [key, typeof stored[key] === 'boolean' ? stored[key] : true]));
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
}

function optionalSectionId(value: unknown, label: string) {
  const sectionId = value === null || value === '' || value === undefined ? null : Number(value);
  if (sectionId !== null && (!Number.isSafeInteger(sectionId) || sectionId <= 0)) {
    throw new Error(`Choose a valid ${label}.`);
  }
  return sectionId;
}

function validateCategoryInput(value: unknown): OurCategoryFormValues {
  if (!isRecord(value)) throw new Error('Enter the template details.');
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const templateType = value.templateType === 'multiple' ? 'multiple' : value.templateType === 'single' ? 'single' : null;
  if (!templateType) throw new Error('Choose a valid template type.');
  const followedTemplateId = templateType === 'multiple'
    ? optionalSectionId(value.followedTemplateId, 'Followed Template')
    : null;
  const itemCount = templateType === 'multiple' ? Number(value.itemCount) : 1;
  if (templateType === 'multiple' && followedTemplateId === null) throw new Error('Choose a Followed Template.');
  if (templateType === 'multiple' && !MULTIPLE_ITEM_COUNTS.includes(itemCount as 3 | 6 | 12)) {
    throw new Error('Choose 3, 6, or 12 items.');
  }
  const roomTheme = typeof value.roomTheme === 'string' ? value.roomTheme.trim() : '';
  const backgroundColour = validateArtworkBackgroundColour(value.backgroundColour);
  if (!name) throw new Error('Enter a template name.');
  if (name.length > 100) throw new Error('Template Name must be 100 characters or fewer.');
  if (!roomTheme) throw new Error('Enter a Room Theme.');
  if (roomTheme.length > 200) throw new Error('Room Theme must be 200 characters or fewer.');

  const printsFrames = requiredBoolean(value.printsFrames, 'Print / Frames');
  const customisePrints = requiredBoolean(value.customisePrints, 'Customised Prints');
  const digitalDownload = requiredBoolean(value.digitalDownload, 'Digital Downloads');
  const printFrameSectionId = optionalSectionId(value.printFrameSectionId, 'Etsy Print / Frame Section');
  const customisedSectionId = optionalSectionId(value.customisedSectionId, 'Etsy Customised Section');
  const downloadSectionId = optionalSectionId(value.downloadSectionId, 'Digital Download Section');
  if (printsFrames && printFrameSectionId === null) throw new Error('Choose an Etsy Print / Frame Section when Print / Frames is enabled.');
  if (customisePrints && customisedSectionId === null) throw new Error('Choose an Etsy Customised Section when Customised Prints is enabled.');
  if (digitalDownload && downloadSectionId === null) throw new Error('Choose a Digital Download Section when Digital Downloads is enabled.');

  return {
    name,
    templateType,
    followedTemplateId,
    itemCount,
    roomTheme,
    backgroundColour,
    printsFrames,
    customisePrints,
    digitalDownload,
    customTop: requiredBoolean(value.customTop, 'Customise Top text'),
    customBottom: requiredBoolean(value.customBottom, 'Customise Bottom text'),
    printFrameSectionId,
    customisedSectionId,
    downloadSectionId,
    sizes: normalizeBooleanMap(value.sizes, SIZE_KEYS, 'Print sizes'),
    frames: normalizeBooleanMap(value.frames, FRAME_KEYS, 'Frames'),
  };
}

async function defaultShop() {
  const configuredShopId = process.env.ETSY_SHOP_ID?.trim();
  const shop = configuredShopId && /^\d+$/.test(configuredShopId)
    ? await prisma.etsyShop.findUnique({ where: { etsyShopId: BigInt(configuredShopId) } })
    : await prisma.etsyShop.findFirst({ orderBy: { id: 'asc' } });
  if (!shop) throw new Error('Create or connect an Etsy shop before creating Our Templates.');
  return shop;
}

async function editorOptions(shopId: number) {
  const shop = await prisma.etsyShop.findUnique({ where: { id: shopId }, select: { etsyShopId: true } });
  if (!shop) throw new Error('The category shop no longer exists.');
  const rows = await prisma.$queryRaw<OurCategoryEtsySectionOption[]>`
    SELECT id, title, useForPrintFrames, useForCustomisedPrints, useForDigitalDownloads
    FROM etsy_download_sections
    WHERE etsyShopId = ${shop.etsyShopId}
    ORDER BY title, id
  `;
  const etsySections = rows.map((section) => ({
    ...section,
    useForPrintFrames: Boolean(section.useForPrintFrames),
    useForCustomisedPrints: Boolean(section.useForCustomisedPrints),
    useForDigitalDownloads: Boolean(section.useForDigitalDownloads),
  }));
  return { shopId: shop.etsyShopId.toString(), etsySections };
}

function templateView(template: {
  id: number;
  name: string;
  description: string;
  originalFileName: string;
  useOnPrints: boolean;
  useOnCustomised: boolean;
  useOnDigital: boolean;
  createdAt: Date;
  updatedAt: Date;
  imageWidth?: number | null;
  imageHeight?: number | null;
  openingCorners?: Prisma.JsonValue | TemplateOpeningCorners | null;
  openingRegions?: Prisma.JsonValue | TemplateOpeningRegion[] | null;
  displayFonts?: boolean | null;
  borderEnabled?: boolean | null;
  borderSizePercent?: number | null;
  topText?: string | null;
  bottomText?: string | null;
  fontId?: string | null;
  linkedSourceCategoryId?: number | null;
  linkedSourceImageTemplateId?: number | null;
  linkedImageItemNumber?: number | null;
  linkedSourceTemplateName?: string | null;
  linkedSourceImageTemplateName?: string | null;
}): OurCategoryImageTemplateView {
  let openingRegions: TemplateOpeningRegion[] = [];
  if (template.imageWidth && template.imageHeight && template.openingRegions) {
    try {
      const value = typeof template.openingRegions === 'string' ? JSON.parse(template.openingRegions) : template.openingRegions;
      openingRegions = validateTemplateOpeningRegions(value, template.imageWidth, template.imageHeight);
    } catch {
      openingRegions = [];
    }
  } else if (template.imageWidth && template.imageHeight && template.openingCorners) {
    try {
      const value = typeof template.openingCorners === 'string' ? JSON.parse(template.openingCorners) : template.openingCorners;
      openingRegions = [{ id: `area-${template.id}-1`, name: 'Area 1', corners: validateTemplateOpeningCorners(value, template.imageWidth, template.imageHeight) }];
    } catch {
      openingRegions = [];
    }
  }
  const personalisation = validateOurCategoryTemplatePersonalisation(
    template.topText,
    template.bottomText,
    template.fontId ?? DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
  );
  return {
    id: String(template.id),
    name: template.name,
    description: template.description,
    originalFileName: template.originalFileName,
    useOnPrints: template.useOnPrints,
    useOnCustomised: template.useOnCustomised,
    useOnDigital: template.useOnDigital,
    imageWidth: template.imageWidth ?? null,
    imageHeight: template.imageHeight ?? null,
    openingRegions,
    displayFonts: template.displayFonts ?? false,
    borderEnabled: template.borderEnabled ?? false,
    borderSizePercent: template.borderSizePercent ?? 5,
    ...personalisation,
    isLinked: Boolean(template.linkedSourceImageTemplateId),
    linkedSourceCategoryId: template.linkedSourceCategoryId ?? null,
    linkedSourceImageTemplateId: template.linkedSourceImageTemplateId ?? null,
    linkedImageItemNumber: template.linkedImageItemNumber ?? null,
    linkedSourceTemplateName: template.linkedSourceTemplateName ?? null,
    linkedSourceImageTemplateName: template.linkedSourceImageTemplateName ?? null,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

type TemplateCalibrationRow = {
  id: number;
  imageWidth: number | null;
  imageHeight: number | null;
  openingCorners: Prisma.JsonValue | string | null;
  openingRegions: Prisma.JsonValue | string | null;
  topText: string;
  bottomText: string;
  fontId: string;
  position: number;
};

type TemplateLinkRow = {
  id: number;
  linkedSourceCategoryId: number | null;
  linkedSourceImageTemplateId: number | null;
  linkedImageItemNumber: number | null;
  linkedSourceTemplateName: string | null;
  linkedSourceImageTemplateName: string | null;
};

async function templateLink(templateId: number) {
  const rows = await prisma.$queryRaw<TemplateLinkRow[]>`
    SELECT linked.id, linked.linkedSourceCategoryId, linked.linkedSourceImageTemplateId,
           linked.linkedImageItemNumber, source_category.name AS linkedSourceTemplateName,
           source_image.name AS linkedSourceImageTemplateName
    FROM our_category_image_templates linked
    LEFT JOIN our_categories source_category ON source_category.id = linked.linkedSourceCategoryId
    LEFT JOIN our_category_image_templates source_image ON source_image.id = linked.linkedSourceImageTemplateId
    WHERE linked.id = ${templateId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function templateCalibrations(categoryId: number) {
  return prisma.$queryRaw<TemplateCalibrationRow[]>`
    SELECT id, imageWidth, imageHeight, openingCorners, openingRegions, topText, bottomText, fontId, position
    FROM our_category_image_templates
    WHERE categoryId = ${categoryId}
  `;
}

async function saveTemplateCalibration(
  client: Pick<typeof prisma, '$executeRaw'>,
  templateId: number,
  imageWidth: number,
  imageHeight: number,
  openingRegions: TemplateOpeningRegion[],
  topText: string,
  bottomText: string,
  fontId: PrintShrimpCustomFontId,
) {
  const serializedRegions = JSON.stringify(openingRegions);
  const serializedCorners = openingRegions[0] ? JSON.stringify(openingRegions[0].corners) : null;
  await client.$executeRaw`
    UPDATE our_category_image_templates
    SET imageWidth = ${imageWidth}, imageHeight = ${imageHeight}, openingCorners = ${serializedCorners}, openingRegions = ${serializedRegions},
        topText = ${topText}, bottomText = ${bottomText}, fontId = ${fontId}
    WHERE id = ${templateId}
  `;
}

async function appendTemplatePosition(templateId: number, categoryId: number) {
  await prisma.$executeRaw`
    UPDATE our_category_image_templates
    SET position = (
      SELECT nextPosition
      FROM (
        SELECT COALESCE(MAX(position), -1) + 1 AS nextPosition
        FROM our_category_image_templates
        WHERE categoryId = ${categoryId} AND id <> ${templateId}
      ) AS template_positions
    )
    WHERE id = ${templateId}
  `;
}

function calibrationFromForm(
  formData: FormData,
  actualWidth: number,
  actualHeight: number,
  templateType: OurTemplateType = 'single',
  itemCount = 1,
) {
  const imageWidth = Number(formData.get('imageWidth'));
  const imageHeight = Number(formData.get('imageHeight'));
  if (!Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight) || imageWidth !== actualWidth || imageHeight !== actualHeight) {
    throw new Error('The saved artwork regions do not match the template image dimensions. Configure the regions again.');
  }
  const serializedRegions = formData.get('openingRegions');
  if (typeof serializedRegions !== 'string') throw new Error('The artwork regions are missing.');
  let rawRegions: unknown;
  try {
    rawRegions = JSON.parse(serializedRegions);
  } catch {
    throw new Error('The artwork regions are invalid.');
  }
  const openingRegions = validateTemplateOpeningRegions(rawRegions, imageWidth, imageHeight);
  if (openingRegions.filter((region) => region.grid).length > 4) {
    throw new Error('New image templates can contain no more than four grid areas.');
  }
  for (const region of openingRegions) {
    for (const [cellIndex, cell] of (region.grid?.cells ?? []).entries()) {
      if (cell.imageItemNumber > itemCount) {
        throw new Error(`Choose an image item number from 1 to ${itemCount} for ${region.name}, Image ${cellIndex + 1}.`);
      }
    }
  }
  const normalizedRegions = templateType === 'multiple' ? openingRegions.map((region, index) => {
    if (region.grid) return region;
    if (!region.imageItemNumber || region.imageItemNumber > itemCount) {
      throw new Error(`Choose an image item number from 1 to ${itemCount} for ${region.name}.`);
    }
    const personalisation = validateOurCategoryTemplatePersonalisation(
      region.topText ?? '',
      region.bottomText ?? '',
      region.fontId ?? DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
    );
    return { ...region, imageItemNumber: region.imageItemNumber, ...personalisation };
  }) : openingRegions;
  return {
    imageWidth,
    imageHeight,
    openingRegions: normalizedRegions,
    ...validateOurCategoryTemplatePersonalisation(
      formData.get('topText'),
      formData.get('bottomText'),
      formData.get('fontId'),
    ),
  };
}

function assertImageTemplateUses(formData: FormData, values: OurCategoryFormValues) {
  const uses = {
    prints: formBoolean(formData, 'useOnPrints'),
    customised: formBoolean(formData, 'useOnCustomised'),
    digital: formBoolean(formData, 'useOnDigital'),
  };
  if (uses.prints && !values.printsFrames) throw new Error('This template does not allow print image templates.');
  if (uses.customised && !values.customisePrints) throw new Error('This template does not allow customised-print image templates.');
  if (uses.digital && !values.digitalDownload) throw new Error('This template does not allow digital-download image templates.');
  return uses;
}

function imageTemplateBorderFromForm(formData: FormData) {
  const enabled = formBoolean(formData, 'borderEnabled');
  const sizePercent = Number(formData.get('borderSizePercent'));
  if (!Number.isFinite(sizePercent) || sizePercent < 2.5 || sizePercent > 10) {
    throw new Error('Border Size must be between 2.5% and 10%.');
  }
  return { enabled, sizePercent };
}

export async function getOurCategories(): Promise<OurCategoryListRow[]> {
  const [rows, metadata] = await Promise.all([
    prisma.ourCategory.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, _count: { select: { listings: true, imageTemplates: true } } },
    }),
    prisma.$queryRaw<Array<{ id: number; templateType: string; followedTemplateName: string | null }>>`
      SELECT template.id, template.templateType, followed.name AS followedTemplateName
      FROM our_categories template
      LEFT JOIN our_categories followed ON followed.id = template.followedTemplateId
    `,
  ]);
  const metadataById = new Map(metadata.map((row) => [row.id, row]));
  return rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    templateType: metadataById.get(row.id)?.templateType === 'multiple' ? 'multiple' : 'single',
    followedTemplateName: metadataById.get(row.id)?.followedTemplateName ?? null,
    listingCount: row._count.listings,
    imageTemplateCount: row._count.imageTemplates,
  }));
}

type OurCategorySettingsRow = {
  id: number;
  shopId: number;
  name: string;
  templateType: string;
  followedTemplateId: number | null;
  itemCount: number;
  roomTheme: string;
  backgroundColour: string | null;
  printsFrames: boolean | number;
  customisePrints: boolean | number;
  digitalDownload: boolean | number;
  customTop: boolean | number;
  customBottom: boolean | number;
  printFrameSectionId: number | null;
  customisedSectionId: number | null;
  downloadSectionId: number | null;
  sizes: Prisma.JsonValue;
  frames: Prisma.JsonValue;
};

async function getOurCategorySettings(categoryId: number) {
  const rows = await prisma.$queryRaw<OurCategorySettingsRow[]>`
    SELECT id, shopId, name, templateType, followedTemplateId, itemCount, roomTheme, backgroundColour,
           printsFrames, customisePrints, digitalDownload, customTop, customBottom,
           printFrameSectionId, customisedSectionId, downloadSectionId, sizes, frames
    FROM our_categories
    WHERE id = ${categoryId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function settingsRowValues(row: OurCategorySettingsRow): OurCategoryFormValues {
  return {
    name: row.name,
    templateType: row.templateType === 'multiple' ? 'multiple' : 'single',
    followedTemplateId: row.followedTemplateId,
    itemCount: row.templateType === 'multiple' && MULTIPLE_ITEM_COUNTS.includes(row.itemCount as 3 | 6 | 12) ? row.itemCount : 1,
    roomTheme: row.roomTheme,
    backgroundColour: normalizeArtworkBackgroundColour(row.backgroundColour),
    printsFrames: Boolean(row.printsFrames),
    customisePrints: Boolean(row.customisePrints),
    digitalDownload: Boolean(row.digitalDownload),
    customTop: Boolean(row.customTop),
    customBottom: Boolean(row.customBottom),
    printFrameSectionId: row.printFrameSectionId,
    customisedSectionId: row.customisedSectionId,
    downloadSectionId: row.downloadSectionId,
    sizes: storedBooleanMap(row.sizes, SIZE_KEYS),
    frames: storedBooleanMap(row.frames, FRAME_KEYS),
  };
}

async function getSingleTemplateOptions(shopId: number, excludingId?: number) {
  const rows = await prisma.$queryRaw<OurCategorySettingsRow[]>`
    SELECT id, shopId, name, templateType, followedTemplateId, itemCount, roomTheme, backgroundColour,
           printsFrames, customisePrints, digitalDownload, customTop, customBottom,
           printFrameSectionId, customisedSectionId, downloadSectionId, sizes, frames
    FROM our_categories
    WHERE shopId = ${shopId} AND templateType = 'single'
      AND (${excludingId ?? null} IS NULL OR id <> ${excludingId ?? null})
    ORDER BY name, id
  `;
  return rows.map((row) => ({ id: row.id, name: row.name, values: settingsRowValues(row) }));
}

async function resolvedImageTemplateView(template: OurCategoryImageTemplate, visited = new Set<number>()): Promise<OurCategoryImageTemplateView> {
  if (visited.has(template.id)) throw new Error('An image-template link contains a circular reference.');
  const nextVisited = new Set(visited).add(template.id);
  const link = await templateLink(template.id);
  if (link?.linkedSourceImageTemplateId) {
    if (!link.linkedSourceCategoryId || !link.linkedImageItemNumber) throw new Error('An image-template link is incomplete.');
    const source = await prisma.ourCategoryImageTemplate.findUnique({ where: { id: link.linkedSourceImageTemplateId } });
    if (!source || source.categoryId !== link.linkedSourceCategoryId) throw new Error('The linked source image template no longer exists.');
    const sourceView = await resolvedImageTemplateView(source, nextVisited);
    return {
      ...sourceView,
      id: String(template.id),
      name: template.name,
      description: template.description,
      useOnPrints: template.useOnPrints,
      useOnCustomised: template.useOnCustomised,
      useOnDigital: template.useOnDigital,
      openingRegions: sourceView.openingRegions.map((region) => ({
        ...remapTemplateOpeningRegionImageItem(region, link.linkedImageItemNumber!),
        topText: sourceView.topText,
        bottomText: sourceView.bottomText,
        fontId: sourceView.fontId,
      })),
      isLinked: true,
      linkedSourceCategoryId: link.linkedSourceCategoryId,
      linkedSourceImageTemplateId: link.linkedSourceImageTemplateId,
      linkedImageItemNumber: link.linkedImageItemNumber,
      linkedSourceTemplateName: link.linkedSourceTemplateName,
      linkedSourceImageTemplateName: link.linkedSourceImageTemplateName,
      createdAt: template.createdAt.toISOString(),
      // The linked template displays the source image, so its cache version
      // must change whenever that source image is replaced.
      updatedAt: sourceView.updatedAt,
    };
  }
  const calibration = (await templateCalibrations(template.categoryId)).find((row) => row.id === template.id);
  return templateView({ ...template, ...calibration });
}

async function resolvedStoredImageTemplate(template: OurCategoryImageTemplate, visited = new Set<number>()): Promise<OurCategoryImageTemplate> {
  if (visited.has(template.id)) throw new Error('An image-template link contains a circular reference.');
  const link = await templateLink(template.id);
  if (!link?.linkedSourceImageTemplateId) return template;
  const source = await prisma.ourCategoryImageTemplate.findUnique({ where: { id: link.linkedSourceImageTemplateId } });
  if (!source || source.categoryId !== link.linkedSourceCategoryId) throw new Error('The linked source image template no longer exists.');
  return resolvedStoredImageTemplate(source, new Set(visited).add(template.id));
}

async function getCategoryImageTemplateViews(categoryId: number) {
  const templates = await prisma.ourCategoryImageTemplate.findMany({
    where: { categoryId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  return Promise.all(templates.map((template) => resolvedImageTemplateView(template)));
}

async function getCopySourceTemplates(target: OurCategorySettingsRow): Promise<OurCategoryCopySourceTemplate[]> {
  if (target.templateType !== 'multiple') return [];
  const sources = await prisma.$queryRaw<Array<{ id: number; name: string; templateType: string; itemCount: number }>>`
    SELECT id, name, templateType, itemCount
    FROM our_categories
    WHERE shopId = ${target.shopId}
      AND id <> ${target.id}
      AND (templateType = 'single' OR (templateType = 'multiple' AND itemCount <= ${target.itemCount}))
    ORDER BY name, id
  `;
  return Promise.all(sources.map(async (source) => ({
    id: source.id,
    name: source.name,
    templateType: source.templateType === 'multiple' ? 'multiple' : 'single',
    itemCount: source.templateType === 'multiple' ? source.itemCount : 1,
    imageTemplates: await getCategoryImageTemplateViews(source.id),
  })));
}

export async function getOurCategoryEditorData(categoryId?: string, createType: OurTemplateType = 'single'): Promise<OurCategoryEditorData> {
  if (!categoryId) {
    const shop = await defaultShop();
    const [options, singleTemplates] = await Promise.all([editorOptions(shop.id), getSingleTemplateOptions(shop.id)]);
    return {
      categoryId: null,
      shopId: options.shopId,
      values: defaultOurCategoryValues(createType),
      sizes: ETSY_PRODUCT_SIZES.map(({ key, label }) => ({ key, label })),
      frames: ETSY_PRODUCT_FRAMES.map(({ key, label }) => ({ key, label })),
      etsySections: options.etsySections,
      imageTemplates: [],
      singleTemplates,
      followedImageTemplates: [],
      copySourceTemplates: [],
    };
  }

  const id = Number(categoryId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid category id.');
  const category = await prisma.ourCategory.findUnique({ where: { id }, select: { id: true, shopId: true } });
  if (!category) throw new Error('Our Template not found.');
  const [settings, imageTemplates, options, singleTemplates] = await Promise.all([
    getOurCategorySettings(id),
    getCategoryImageTemplateViews(id),
    editorOptions(category.shopId),
    getSingleTemplateOptions(category.shopId, id),
  ]);
  if (!settings) throw new Error('Our Template not found.');
  const values = settingsRowValues(settings);
  const [followedImageTemplates, copySourceTemplates] = await Promise.all([
    values.templateType === 'multiple' && values.followedTemplateId
      ? getCategoryImageTemplateViews(values.followedTemplateId)
      : Promise.resolve([]),
    getCopySourceTemplates(settings),
  ]);
  return {
    categoryId: String(category.id),
    shopId: options.shopId,
    values,
    sizes: ETSY_PRODUCT_SIZES.map(({ key, label }) => ({ key, label })),
    frames: ETSY_PRODUCT_FRAMES.map(({ key, label }) => ({ key, label })),
    etsySections: options.etsySections,
    imageTemplates,
    singleTemplates,
    followedImageTemplates,
    copySourceTemplates,
  };
}

export async function createOurCategoryEtsySection(shopId: string, title: string, usages: EtsySectionUsage[]) {
  if (!/^\d+$/.test(shopId)) throw new Error('Choose a valid Etsy shop.');
  if (!Array.isArray(usages) || usages.length === 0) {
    throw new Error('Select at least one Etsy section product type.');
  }
  const section = await registerEtsySection(shopId, title, usages);
  return {
    id: section.id,
    title: section.title,
    useForPrintFrames: section.useForPrintFrames,
    useForCustomisedPrints: section.useForCustomisedPrints,
    useForDigitalDownloads: section.useForDigitalDownloads,
  };
}

export async function createOurCategoryDownloadSection(shopId: string, title: string) {
  return createOurCategoryEtsySection(shopId, title, ['digitalDownloads']);
}

async function assertCategoryEtsySections(shopId: number, values: OurCategoryFormValues) {
  const shop = await prisma.etsyShop.findUnique({ where: { id: shopId }, select: { etsyShopId: true } });
  if (!shop) throw new Error('The category shop no longer exists.');
  const sections = await prisma.$queryRaw<Array<OurCategoryEtsySectionOption>>`
    SELECT id, title, useForPrintFrames, useForCustomisedPrints, useForDigitalDownloads
    FROM etsy_download_sections
    WHERE etsyShopId = ${shop.etsyShopId}
  `;
  const byId = new Map(sections.map((section) => [section.id, section]));
  const assertSelection = (
    sectionId: number | null,
    flag: keyof Pick<OurCategoryEtsySectionOption, 'useForPrintFrames' | 'useForCustomisedPrints' | 'useForDigitalDownloads'>,
    label: string,
  ) => {
    if (sectionId === null) return;
    const section = byId.get(sectionId);
    if (!section || !Boolean(section[flag])) throw new Error(`Choose a valid ${label} from this shop.`);
  };
  assertSelection(values.printFrameSectionId, 'useForPrintFrames', 'Etsy Print / Frame Section');
  assertSelection(values.customisedSectionId, 'useForCustomisedPrints', 'Etsy Customised Section');
  assertSelection(values.downloadSectionId, 'useForDigitalDownloads', 'Digital Download Section');
}

async function normalizeTemplateValues(shopId: number, values: OurCategoryFormValues, existingId?: number) {
  if (values.templateType === 'single') {
    return { ...values, followedTemplateId: null, itemCount: 1 };
  }
  if (!values.followedTemplateId || values.followedTemplateId === existingId) throw new Error('Choose a valid Followed Template.');
  const followed = await getOurCategorySettings(values.followedTemplateId);
  if (!followed || followed.shopId !== shopId || followed.templateType !== 'single') {
    throw new Error('Choose a valid single Followed Template from this shop.');
  }
  const allowed = settingsRowValues(followed);
  if (values.printsFrames && !allowed.printsFrames) throw new Error('The Followed Template does not allow Print / Frames.');
  if (values.customisePrints && !allowed.customisePrints) throw new Error('The Followed Template does not allow Customised Prints.');
  if (values.digitalDownload && !allowed.digitalDownload) throw new Error('The Followed Template does not allow Digital Downloads.');
  if (values.customisePrints && values.customTop && !allowed.customTop) throw new Error('The Followed Template does not allow customised top text.');
  if (values.customisePrints && values.customBottom && !allowed.customBottom) throw new Error('The Followed Template does not allow customised bottom text.');
  if (Object.keys(values.sizes).some((key) => values.sizes[key] && !allowed.sizes[key])) {
    throw new Error('A selected print size is not allowed by the Followed Template.');
  }
  if (Object.keys(values.frames).some((key) => values.frames[key] && !allowed.frames[key])) {
    throw new Error('A selected frame is not allowed by the Followed Template.');
  }
  return {
    ...values,
    roomTheme: allowed.roomTheme,
    customTop: values.customisePrints && values.customTop,
    customBottom: values.customisePrints && values.customBottom,
    printFrameSectionId: values.printsFrames ? values.printFrameSectionId : null,
    customisedSectionId: values.customisePrints ? values.customisedSectionId : null,
    downloadSectionId: values.digitalDownload ? values.downloadSectionId : null,
    sizes: Object.fromEntries(SIZE_KEYS.map((key) => [key, values.printsFrames && allowed.sizes[key] && values.sizes[key]])),
    frames: Object.fromEntries(FRAME_KEYS.map((key) => [key, values.printsFrames && allowed.frames[key] && values.frames[key]])),
  };
}

async function assertCategoryNameAvailable(shopId: number, name: string, excludingId?: number) {
  const existing = await prisma.ourCategory.findFirst({
    where: { shopId, name, ...(excludingId ? { id: { not: excludingId } } : {}) },
    select: { id: true },
  });
  if (existing) throw new Error(`An Our Template named "${name}" already exists.`);
}

async function saveOurCategoryEtsySectionIds(
  client: Pick<typeof prisma, '$executeRaw'>,
  categoryId: number,
  values: Pick<OurCategoryFormValues, 'printFrameSectionId' | 'customisedSectionId'>,
) {
  await client.$executeRaw`
    UPDATE our_categories
    SET printFrameSectionId = ${values.printFrameSectionId}, customisedSectionId = ${values.customisedSectionId}
    WHERE id = ${categoryId}
  `;
}

async function saveOurTemplateMetadata(
  client: Pick<typeof prisma, '$executeRaw'>,
  categoryId: number,
  values: Pick<OurCategoryFormValues, 'templateType' | 'followedTemplateId' | 'itemCount'>,
) {
  await client.$executeRaw`
    UPDATE our_categories
    SET templateType = ${values.templateType}, followedTemplateId = ${values.followedTemplateId}, itemCount = ${values.itemCount}
    WHERE id = ${categoryId}
  `;
}

export async function createOurCategory(input: unknown) {
  const submittedValues = validateCategoryInput(input);
  const shop = await defaultShop();
  const values = await normalizeTemplateValues(shop.id, submittedValues);
  await Promise.all([
    assertCategoryEtsySections(shop.id, values),
    assertCategoryNameAvailable(shop.id, values.name),
  ]);
  const category = await prisma.$transaction(async (transaction) => {
    const created = await transaction.ourCategory.create({
      data: {
        shopId: shop.id,
        name: values.name,
        roomTheme: values.roomTheme,
        backgroundColour: values.backgroundColour,
        printsFrames: values.printsFrames,
        customisePrints: values.customisePrints,
        digitalDownload: values.digitalDownload,
        customTop: values.customTop,
        customBottom: values.customBottom,
        downloadSectionId: values.downloadSectionId,
        sizes: values.sizes as Prisma.InputJsonValue,
        frames: values.frames as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await saveOurCategoryEtsySectionIds(transaction as Pick<typeof prisma, '$executeRaw'>, created.id, values);
    await saveOurTemplateMetadata(transaction as Pick<typeof prisma, '$executeRaw'>, created.id, values);
    return created;
  });
  return getOurCategoryEditorData(String(category.id));
}

export async function updateOurCategory(categoryId: string, input: unknown) {
  const id = Number(categoryId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid category id.');
  const submittedValues = validateCategoryInput(input);
  const category = await prisma.ourCategory.findUnique({ where: { id }, select: { shopId: true } });
  if (!category) throw new Error('Our Template not found.');
  const existingSettings = await getOurCategorySettings(id);
  if (!existingSettings) throw new Error('Our Template not found.');
  const existingType: OurTemplateType = existingSettings.templateType === 'multiple' ? 'multiple' : 'single';
  if (submittedValues.templateType !== existingType) throw new Error('The template type cannot be changed after creation.');
  const values = await normalizeTemplateValues(category.shopId, submittedValues, id);
  if (existingType === 'multiple'
    && (values.followedTemplateId !== existingSettings.followedTemplateId || values.itemCount !== existingSettings.itemCount)) {
    const linkedImages = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM our_category_image_templates
      WHERE categoryId = ${id} AND linkedSourceImageTemplateId IS NOT NULL
    `;
    if (Number(linkedImages[0]?.count ?? 0) > 0) {
      throw new Error('Delete linked image templates before changing the Followed Template or No of Items.');
    }
  }
  await Promise.all([
    assertCategoryEtsySections(category.shopId, values),
    assertCategoryNameAvailable(category.shopId, values.name, id),
  ]);
  await prisma.$transaction(async (transaction) => {
    await transaction.ourCategory.update({
      where: { id },
      data: {
        name: values.name,
        roomTheme: values.roomTheme,
        backgroundColour: values.backgroundColour,
        printsFrames: values.printsFrames,
        customisePrints: values.customisePrints,
        digitalDownload: values.digitalDownload,
        customTop: values.customTop,
        customBottom: values.customBottom,
        downloadSectionId: values.downloadSectionId,
        sizes: values.sizes as Prisma.InputJsonValue,
        frames: values.frames as Prisma.InputJsonValue,
      },
    });
    if (values.backgroundColour !== settingsRowValues(existingSettings).backgroundColour) {
      await transaction.etsyListing.updateMany({
        where: { ourCategoryId: id, backgroundColour: null },
        data: {
          imagesChanged: true,
          downloadsChanged: true,
          downloadsRevision: { increment: 1 },
          lastLocalChangeAt: new Date(),
        },
      });
    }
    await saveOurCategoryEtsySectionIds(transaction as Pick<typeof prisma, '$executeRaw'>, id, values);
    await saveOurTemplateMetadata(transaction as Pick<typeof prisma, '$executeRaw'>, id, values);
    if (!values.printsFrames || !values.customisePrints || !values.digitalDownload) {
      await transaction.ourCategoryImageTemplate.updateMany({
        where: { categoryId: id },
        data: {
          ...(!values.printsFrames ? { useOnPrints: false } : {}),
          ...(!values.customisePrints ? { useOnCustomised: false } : {}),
          ...(!values.digitalDownload ? { useOnDigital: false } : {}),
        },
      });
    }
  });
  return getOurCategoryEditorData(categoryId);
}

export async function deleteOurCategory(categoryId: string) {
  const id = Number(categoryId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid category id.');
  const category = await prisma.ourCategory.findUnique({
    where: { id },
    select: { id: true, _count: { select: { listings: true } } },
  });
  if (!category) throw new Error('Our Template not found.');
  if (category._count.listings > 0) throw new Error('This template cannot be deleted while listings use it.');
  const followers = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM our_categories WHERE followedTemplateId = ${id}
  `;
  if (Number(followers[0]?.count ?? 0) > 0) throw new Error('This template cannot be deleted while multiple templates follow it.');
  await prisma.ourCategory.delete({ where: { id } });
  const directory = path.join(ETSY_LISTINGS_DIRECTORY, TEMPLATE_DIRECTORY, String(id));
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    console.error(`Unable to remove image-template storage for category ${id}:`, error);
  }
  return getOurCategories();
}

function formBoolean(formData: FormData, key: string) {
  const value = formData.get(key);
  if (value !== 'true' && value !== 'false') throw new Error(`Missing ${key}.`);
  return value === 'true';
}

export async function createOurCategoryImageTemplate(categoryId: string, formData: FormData) {
  const id = Number(categoryId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid category id.');
  const category = await prisma.ourCategory.findUnique({ where: { id }, select: { id: true } });
  if (!category) throw new Error('Create the template before adding image templates.');
  const categorySettings = await getOurCategorySettings(id);
  if (!categorySettings) throw new Error('Create the template before adding image templates.');
  const categoryValues = settingsRowValues(categorySettings);
  const nameValue = formData.get('name');
  const descriptionValue = formData.get('description');
  const file = formData.get('file');
  const displayFonts = formBoolean(formData, 'displayFonts');
  const name = typeof nameValue === 'string' ? nameValue.trim() : '';
  const description = typeof descriptionValue === 'string' ? descriptionValue.trim() : '';
  if (!name) throw new Error('Enter a template name.');
  if (name.length > 100) throw new Error('Template Name must be 100 characters or fewer.');
  if (!description) throw new Error('Enter a template description.');
  if (description.length > 500) throw new Error('Template Description must be 500 characters or fewer.');
  let contents: Buffer;
  let originalFileName: string;
  let contentType: string;
  let calibration: ReturnType<typeof calibrationFromForm>;
  if (displayFonts) {
    contents = await createFontShowcaseImage();
    originalFileName = 'font-showcase.png';
    contentType = 'image/png';
    calibration = {
      imageWidth: FONT_SHOWCASE_WIDTH,
      imageHeight: FONT_SHOWCASE_HEIGHT,
      openingRegions: [],
      topText: '',
      bottomText: '',
      fontId: DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
    };
  } else {
    if (!(file instanceof File) || file.size === 0) throw new Error('Choose a template image.');
    if (file.size > MAX_TEMPLATE_BYTES) throw new Error('The template image must be 25 MB or smaller.');
    const extension = path.extname(file.name).toLocaleLowerCase();
    if (!TEMPLATE_IMAGE_EXTENSIONS.has(extension)) throw new Error('Choose a PNG template image with a transparent opening.');
    contents = Buffer.from(await file.arrayBuffer());
    let imageWidth = 0;
    let imageHeight = 0;
    try {
      const dimensions = imageSize(contents);
      if (!dimensions.width || !dimensions.height) throw new Error('Invalid dimensions.');
      imageWidth = dimensions.width;
      imageHeight = dimensions.height;
    } catch {
      throw new Error('The uploaded file is not a valid image.');
    }
    calibration = calibrationFromForm(formData, imageWidth, imageHeight, categoryValues.templateType, categoryValues.itemCount);
    originalFileName = file.name.slice(0, 255);
    contentType = CONTENT_TYPES[extension] ?? file.type ?? 'application/octet-stream';
  }
  const uses = assertImageTemplateUses(formData, categoryValues);
  const border = imageTemplateBorderFromForm(formData);
  const existingTemplate = await prisma.ourCategoryImageTemplate.findFirst({
    where: { categoryId: id, name },
    select: { id: true },
  });
  if (existingTemplate) throw new Error(`An image template named "${name}" already exists in this category.`);

  const directory = path.join(ETSY_LISTINGS_DIRECTORY, TEMPLATE_DIRECTORY, String(id));
  const fileName = `${randomUUID()}.png`;
  const imagePath = path.join(directory, fileName);
  await mkdir(directory, { recursive: true });
  await writeFile(imagePath, contents);
  let createdId: number | null = null;
  try {
    const created = await prisma.ourCategoryImageTemplate.create({
      data: {
        categoryId: id,
        name,
        description,
        imagePath,
        originalFileName,
        contentType,
        sizeBytes: contents.length,
        displayFonts,
        borderEnabled: border.enabled,
        borderSizePercent: border.sizePercent,
        useOnPrints: uses.prints,
        useOnCustomised: uses.customised,
        useOnDigital: uses.digital,
      },
    });
    createdId = created.id;
    await appendTemplatePosition(created.id, id);
    await saveTemplateCalibration(
      prisma,
      created.id,
      calibration.imageWidth,
      calibration.imageHeight,
      calibration.openingRegions,
      calibration.topText,
      calibration.bottomText,
      calibration.fontId,
    );
    return templateView({ ...created, ...calibration });
  } catch (error) {
    if (createdId) await prisma.ourCategoryImageTemplate.delete({ where: { id: createdId } }).catch(() => undefined);
    await unlink(imagePath).catch(() => undefined);
    throw error;
  }
}

export async function updateOurCategoryImageTemplate(templateId: string, formData: FormData) {
  const id = Number(templateId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid image template id.');
  const existing = await prisma.ourCategoryImageTemplate.findUnique({
    where: { id },
    select: { categoryId: true, imagePath: true, displayFonts: true },
  });
  if (!existing) throw new Error('Image template not found.');
  const existingLink = await templateLink(id);
  if (existingLink?.linkedSourceImageTemplateId) throw new Error('Linked image templates cannot be edited. Delete the link and create or copy an image template instead.');
  const categorySettings = await getOurCategorySettings(existing.categoryId);
  if (!categorySettings) throw new Error('Our Template not found.');
  const categoryValues = settingsRowValues(categorySettings);

  const nameValue = formData.get('name');
  const descriptionValue = formData.get('description');
  const fileValue = formData.get('file');
  const displayFonts = formBoolean(formData, 'displayFonts');
  const name = typeof nameValue === 'string' ? nameValue.trim() : '';
  const description = typeof descriptionValue === 'string' ? descriptionValue.trim() : '';
  if (!name) throw new Error('Enter a template name.');
  if (name.length > 100) throw new Error('Template Name must be 100 characters or fewer.');
  if (!description) throw new Error('Enter a template description.');
  if (description.length > 500) throw new Error('Template Description must be 500 characters or fewer.');

  const duplicate = await prisma.ourCategoryImageTemplate.findFirst({
    where: { categoryId: existing.categoryId, name, id: { not: id } },
    select: { id: true },
  });
  if (duplicate) throw new Error(`An image template named "${name}" already exists in this category.`);

  const replacement = !displayFonts && fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  let replacementPath: string | null = null;
  let replacementDetails: { originalFileName: string; contentType: string; sizeBytes: number } | null = null;
  let imageContents: Buffer;
  if (displayFonts) {
    imageContents = await createFontShowcaseImage();
    const directory = path.join(ETSY_LISTINGS_DIRECTORY, TEMPLATE_DIRECTORY, String(existing.categoryId));
    replacementPath = path.join(directory, `${randomUUID()}.png`);
    await mkdir(directory, { recursive: true });
    await writeFile(replacementPath, imageContents);
    replacementDetails = {
      originalFileName: 'font-showcase.png',
      contentType: 'image/png',
      sizeBytes: imageContents.length,
    };
  } else if (replacement) {
    if (replacement.size > MAX_TEMPLATE_BYTES) throw new Error('The template image must be 25 MB or smaller.');
    const extension = path.extname(replacement.name).toLocaleLowerCase();
    if (!TEMPLATE_IMAGE_EXTENSIONS.has(extension)) throw new Error('Choose a PNG template image with a transparent opening.');
    const contents = Buffer.from(await replacement.arrayBuffer());
    imageContents = contents;
    try {
      const dimensions = imageSize(contents);
      if (!dimensions.width || !dimensions.height) throw new Error('Invalid dimensions.');
    } catch {
      throw new Error('The uploaded file is not a valid image.');
    }
    const normalizedExtension = extension === '.jpeg' ? '.jpg' : extension;
    const directory = path.join(ETSY_LISTINGS_DIRECTORY, TEMPLATE_DIRECTORY, String(existing.categoryId));
    replacementPath = path.join(directory, `${randomUUID()}${normalizedExtension}`);
    await mkdir(directory, { recursive: true });
    await writeFile(replacementPath, contents);
    replacementDetails = {
      originalFileName: replacement.name.slice(0, 255),
      contentType: CONTENT_TYPES[extension] ?? replacement.type ?? 'application/octet-stream',
      sizeBytes: replacement.size,
    };
  } else {
    if (existing.displayFonts) throw new Error('Choose a template image when Display fonts is switched off.');
    imageContents = await readFile(existing.imagePath);
  }

  let actualWidth = 0;
  let actualHeight = 0;
  try {
    const dimensions = imageSize(imageContents);
    if (!dimensions.width || !dimensions.height) throw new Error('Invalid dimensions.');
    actualWidth = dimensions.width;
    actualHeight = dimensions.height;
  } catch {
    throw new Error('The stored template file is not a valid image.');
  }
  let calibration: ReturnType<typeof calibrationFromForm>;
  if (displayFonts) {
    calibration = {
      imageWidth: actualWidth,
      imageHeight: actualHeight,
      openingRegions: [],
      topText: '',
      bottomText: '',
      fontId: DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
    };
  } else {
    try {
      calibration = calibrationFromForm(formData, actualWidth, actualHeight, categoryValues.templateType, categoryValues.itemCount);
    } catch (error) {
      if (replacementPath) await unlink(replacementPath).catch(() => undefined);
      throw error;
    }
  }

  try {
    const uses = assertImageTemplateUses(formData, categoryValues);
    const border = imageTemplateBorderFromForm(formData);
    const updated = await prisma.$transaction(async (transaction) => {
      const record = await transaction.ourCategoryImageTemplate.update({
        where: { id },
        data: {
          name,
          description,
          displayFonts,
          borderEnabled: border.enabled,
          borderSizePercent: border.sizePercent,
          useOnPrints: uses.prints,
          useOnCustomised: uses.customised,
          useOnDigital: uses.digital,
          ...(replacementPath && replacementDetails ? {
            imagePath: replacementPath,
            ...replacementDetails,
          } : {}),
        },
      });
      await saveTemplateCalibration(
        transaction as Pick<typeof prisma, '$executeRaw'>,
        id,
        calibration.imageWidth,
        calibration.imageHeight,
        calibration.openingRegions,
        calibration.topText,
        calibration.bottomText,
        calibration.fontId,
      );
      return record;
    });
    if (replacementPath) {
      await unlink(existing.imagePath).catch((error) => console.error(`Unable to remove replaced S3 image for template ${id}:`, error));
    }
    return templateView({ ...updated, ...calibration });
  } catch (error) {
    if (replacementPath) await unlink(replacementPath).catch(() => undefined);
    throw error;
  }
}

export async function copyOurCategoryImageTemplate(
  categoryId: string,
  sourceCategoryId: string,
  sourceTemplateId: string,
  imageItemNumbersValue: unknown,
) {
  const targetId = Number(categoryId);
  const sourceCategory = Number(sourceCategoryId);
  const sourceId = Number(sourceTemplateId);
  if (!Number.isSafeInteger(targetId) || targetId <= 0 || !Number.isSafeInteger(sourceCategory) || sourceCategory <= 0
    || !Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw new Error('Choose a valid image template.');
  }
  const [targetSettings, sourceSettings] = await Promise.all([
    getOurCategorySettings(targetId),
    getOurCategorySettings(sourceCategory),
  ]);
  if (!targetSettings || targetSettings.templateType !== 'multiple') {
    throw new Error('Choose a saved multiple template before copying an image template.');
  }
  const compatible = sourceSettings
    && sourceSettings.shopId === targetSettings.shopId
    && sourceSettings.id !== targetSettings.id
    && (sourceSettings.templateType === 'single'
      || sourceSettings.templateType === 'multiple' && sourceSettings.itemCount <= targetSettings.itemCount);
  if (!compatible || !sourceSettings) {
    throw new Error('Choose a single template or a multiple template with no more items than this template.');
  }
  const sourceImageCount = sourceSettings.templateType === 'multiple' ? sourceSettings.itemCount : 1;
  if (!Array.isArray(imageItemNumbersValue) || imageItemNumbersValue.length !== sourceImageCount) {
    throw new Error(`Select ${sourceImageCount} image${sourceImageCount === 1 ? '' : 's'} for the copied template.`);
  }
  const imageItemNumbers = imageItemNumbersValue.map(Number);
  if (imageItemNumbers.some((itemNumber) => !Number.isSafeInteger(itemNumber) || itemNumber < 1 || itemNumber > targetSettings.itemCount)) {
    throw new Error(`Choose image numbers from 1 to ${targetSettings.itemCount}.`);
  }
  if (new Set(imageItemNumbers).size !== imageItemNumbers.length) {
    throw new Error('Choose a different target image for each source image.');
  }
  if (sourceSettings.templateType === 'multiple' && sourceSettings.itemCount === targetSettings.itemCount
    && imageItemNumbers.some((itemNumber, index) => itemNumber !== index + 1)) {
    throw new Error('All images must be copied when both templates have the same number of items.');
  }
  const source = await prisma.ourCategoryImageTemplate.findUnique({ where: { id: sourceId } });
  if (!source || source.categoryId !== sourceSettings.id) {
    throw new Error('Choose an image template from the selected template.');
  }
  const duplicate = await prisma.ourCategoryImageTemplate.findFirst({
    where: { categoryId: targetId, name: source.name },
    select: { id: true },
  });
  if (duplicate) throw new Error(`An image template named "${source.name}" already exists in this template.`);
  const [sourceView, storedSource] = await Promise.all([
    resolvedImageTemplateView(source),
    resolvedStoredImageTemplate(source),
  ]);
  if (!sourceView.imageWidth || !sourceView.imageHeight) throw new Error('Edit and save the source image template before copying it.');
  const openingRegions = sourceView.openingRegions.map((region) => {
    if (region.grid) {
      return {
        ...region,
        grid: {
          ...region.grid,
          cells: region.grid.cells.map((cell, cellIndex) => {
            if (cell.imageItemNumber > sourceImageCount) {
              throw new Error(`Edit the source image template and choose an image item number from 1 to ${sourceImageCount} for ${region.name}, Image ${cellIndex + 1}.`);
            }
            return { ...cell, imageItemNumber: imageItemNumbers[cell.imageItemNumber - 1] };
          }),
        },
      };
    }
    const sourceImageItemNumber = sourceSettings.templateType === 'multiple' ? region.imageItemNumber : 1;
    if (!sourceImageItemNumber || sourceImageItemNumber > sourceImageCount) {
      throw new Error(`Edit the source image template and choose an image item number from 1 to ${sourceImageCount} for ${region.name}.`);
    }
    return {
      ...region,
      imageItemNumber: imageItemNumbers[sourceImageItemNumber - 1],
      ...(sourceSettings.templateType === 'single' ? {
        topText: sourceView.topText,
        bottomText: sourceView.bottomText,
        fontId: sourceView.fontId,
      } : {}),
    };
  });
  const contents = await readFile(storedSource.imagePath);
  const extension = path.extname(storedSource.originalFileName) || path.extname(storedSource.imagePath) || '.png';
  const directory = path.join(ETSY_LISTINGS_DIRECTORY, TEMPLATE_DIRECTORY, String(targetId));
  const imagePath = path.join(directory, `${randomUUID()}${extension.toLocaleLowerCase()}`);
  await mkdir(directory, { recursive: true });
  await writeFile(imagePath, contents);
  let createdId: number | null = null;
  try {
    const targetValues = settingsRowValues(targetSettings);
    const created = await prisma.ourCategoryImageTemplate.create({
      data: {
        categoryId: targetId,
        name: source.name,
        description: source.description,
        imagePath,
        originalFileName: storedSource.originalFileName,
        contentType: storedSource.contentType,
        sizeBytes: storedSource.sizeBytes,
        displayFonts: sourceView.displayFonts,
        borderEnabled: sourceView.borderEnabled,
        borderSizePercent: sourceView.borderSizePercent,
        useOnPrints: source.useOnPrints && targetValues.printsFrames,
        useOnCustomised: source.useOnCustomised && targetValues.customisePrints,
        useOnDigital: source.useOnDigital && targetValues.digitalDownload,
      },
    });
    createdId = created.id;
    await appendTemplatePosition(created.id, targetId);
    await saveTemplateCalibration(
      prisma,
      created.id,
      sourceView.imageWidth,
      sourceView.imageHeight,
      openingRegions,
      '',
      '',
      DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
    );
    return templateView({
      ...created,
      imageWidth: sourceView.imageWidth,
      imageHeight: sourceView.imageHeight,
      openingRegions,
      topText: '',
      bottomText: '',
      fontId: DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
      displayFonts: sourceView.displayFonts,
      borderEnabled: sourceView.borderEnabled,
      borderSizePercent: sourceView.borderSizePercent,
    });
  } catch (error) {
    if (createdId) await prisma.ourCategoryImageTemplate.delete({ where: { id: createdId } }).catch(() => undefined);
    await unlink(imagePath).catch(() => undefined);
    throw error;
  }
}

export async function duplicateOurCategoryImageTemplate(templateId: string) {
  const sourceId = Number(templateId);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) throw new Error('Choose a valid image template.');
  const source = await prisma.ourCategoryImageTemplate.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error('Image template not found.');

  const [sourceView, storedSource, existingTemplates] = await Promise.all([
    resolvedImageTemplateView(source),
    resolvedStoredImageTemplate(source),
    prisma.ourCategoryImageTemplate.findMany({
      where: { categoryId: source.categoryId },
      select: { name: true },
    }),
  ]);
  if (!sourceView.imageWidth || !sourceView.imageHeight) {
    throw new Error('Edit and save the image template before making a copy.');
  }

  const existingNames = new Set(existingTemplates.map(({ name }) => name.toLocaleLowerCase()));
  const requestedName = `Copied from ${source.name}`;
  const baseName = requestedName.slice(0, 100);
  let name = baseName;
  for (let suffix = 2; existingNames.has(name.toLocaleLowerCase()); suffix += 1) {
    const suffixText = ` ${suffix}`;
    name = `${baseName.slice(0, 100 - suffixText.length)}${suffixText}`;
  }

  const extension = path.extname(storedSource.originalFileName) || path.extname(storedSource.imagePath) || '.png';
  const directory = path.join(ETSY_LISTINGS_DIRECTORY, TEMPLATE_DIRECTORY, String(source.categoryId));
  const imagePath = path.join(directory, `${randomUUID()}${extension.toLocaleLowerCase()}`);
  await mkdir(directory, { recursive: true });
  await writeFile(imagePath, await readFile(storedSource.imagePath));

  let createdId: number | null = null;
  try {
    const created = await prisma.ourCategoryImageTemplate.create({
      data: {
        categoryId: source.categoryId,
        name,
        description: source.description,
        imagePath,
        originalFileName: storedSource.originalFileName,
        contentType: storedSource.contentType,
        sizeBytes: storedSource.sizeBytes,
        displayFonts: sourceView.displayFonts,
        borderEnabled: sourceView.borderEnabled,
        borderSizePercent: sourceView.borderSizePercent,
        useOnPrints: sourceView.useOnPrints,
        useOnCustomised: sourceView.useOnCustomised,
        useOnDigital: sourceView.useOnDigital,
      },
    });
    createdId = created.id;
    await appendTemplatePosition(created.id, source.categoryId);
    await saveTemplateCalibration(
      prisma,
      created.id,
      sourceView.imageWidth,
      sourceView.imageHeight,
      sourceView.openingRegions,
      sourceView.topText,
      sourceView.bottomText,
      sourceView.fontId,
    );
    return templateView({
      ...created,
      imageWidth: sourceView.imageWidth,
      imageHeight: sourceView.imageHeight,
      openingRegions: sourceView.openingRegions,
      topText: sourceView.topText,
      bottomText: sourceView.bottomText,
      fontId: sourceView.fontId,
      displayFonts: sourceView.displayFonts,
      borderEnabled: sourceView.borderEnabled,
      borderSizePercent: sourceView.borderSizePercent,
    });
  } catch (error) {
    if (createdId) await prisma.ourCategoryImageTemplate.delete({ where: { id: createdId } }).catch(() => undefined);
    await unlink(imagePath).catch(() => undefined);
    throw error;
  }
}

export async function linkFollowedOurCategoryImageTemplate(
  categoryId: string,
  sourceTemplateId: string,
  imageItemNumberValue: unknown,
) {
  const targetId = Number(categoryId);
  const sourceId = Number(sourceTemplateId);
  const imageItemNumber = Number(imageItemNumberValue);
  if (!Number.isSafeInteger(targetId) || targetId <= 0 || !Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw new Error('Choose a valid image template.');
  }
  const targetSettings = await getOurCategorySettings(targetId);
  if (!targetSettings || targetSettings.templateType !== 'multiple' || !targetSettings.followedTemplateId) {
    throw new Error('Choose and save a Followed Template before linking one of its image templates.');
  }
  if (!Number.isSafeInteger(imageItemNumber) || imageItemNumber < 1 || imageItemNumber > targetSettings.itemCount) {
    throw new Error(`Choose an image number from 1 to ${targetSettings.itemCount}.`);
  }
  const source = await prisma.ourCategoryImageTemplate.findUnique({ where: { id: sourceId } });
  if (!source || source.categoryId !== targetSettings.followedTemplateId) {
    throw new Error('Choose an image template from the Followed Template.');
  }
  const sourceLink = await templateLink(source.id);
  if (sourceLink?.linkedSourceImageTemplateId) throw new Error('Choose an original image template to link.');
  const duplicate = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id
    FROM our_category_image_templates
    WHERE categoryId = ${targetId}
      AND linkedSourceImageTemplateId = ${sourceId}
      AND linkedImageItemNumber = ${imageItemNumber}
    LIMIT 1
  `;
  if (duplicate.length > 0) throw new Error(`${source.name} is already linked to Image ${imageItemNumber}.`);

  const targetValues = settingsRowValues(targetSettings);
  const existingNames = new Set((await prisma.ourCategoryImageTemplate.findMany({
    where: { categoryId: targetId },
    select: { name: true },
  })).map(({ name }) => name));
  const baseName = `${source.name} - Image ${imageItemNumber}`.slice(0, 100);
  let name = baseName;
  for (let suffix = 2; existingNames.has(name); suffix += 1) {
    const suffixText = ` ${suffix}`;
    name = `${baseName.slice(0, 100 - suffixText.length)}${suffixText}`;
  }

  let createdId: number | null = null;
  try {
    const created = await prisma.ourCategoryImageTemplate.create({
      data: {
        categoryId: targetId,
        name,
        description: source.description,
        imagePath: source.imagePath,
        originalFileName: source.originalFileName,
        contentType: source.contentType,
        sizeBytes: source.sizeBytes,
        useOnPrints: source.useOnPrints && targetValues.printsFrames,
        useOnCustomised: source.useOnCustomised && targetValues.customisePrints,
        useOnDigital: source.useOnDigital && targetValues.digitalDownload,
      },
    });
    createdId = created.id;
    await prisma.$executeRaw`
      UPDATE our_category_image_templates
      SET linkedSourceCategoryId = ${source.categoryId}, linkedSourceImageTemplateId = ${source.id},
          linkedImageItemNumber = ${imageItemNumber}
      WHERE id = ${created.id}
    `;
    await appendTemplatePosition(created.id, targetId);
    return await resolvedImageTemplateView(created);
  } catch (error) {
    if (createdId) await prisma.ourCategoryImageTemplate.delete({ where: { id: createdId } }).catch(() => undefined);
    throw error;
  }
}

export async function getOurCategoryTemplateImage(templateId: string, preview = false) {
  const id = Number(templateId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid image template id.');
  const template = await prisma.ourCategoryImageTemplate.findUnique({ where: { id } });
  if (!template) throw new Error('Image template not found.');
  const [resolvedView, storedTemplate] = await Promise.all([
    resolvedImageTemplateView(template),
    resolvedStoredImageTemplate(template),
  ]);
  if (resolvedView.displayFonts) {
    const contents = await createFontShowcaseImage();
    return {
      contents: preview
        ? await sharp(contents).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer()
        : contents,
      contentType: preview ? 'image/webp' : 'image/png',
      fileName: 'font-showcase.png',
    };
  }
  return {
    contents: preview ? await readImagePreview(storedTemplate.imagePath) : await readFile(storedTemplate.imagePath),
    contentType: preview ? 'image/webp' : storedTemplate.contentType,
    fileName: storedTemplate.originalFileName,
  };
}

async function imageTemplateDeletionPlan(templateId: string) {
  const id = Number(templateId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid image template id.');
  const template = await prisma.ourCategoryImageTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      imagePath: true,
      linkedSourceImageTemplateId: true,
      category: { select: { templateType: true } },
    },
  });
  if (!template) throw new Error('Image template not found.');

  const dependentTemplates: Array<{ id: number }> = [];
  const visitedIds = new Set([id]);
  let sourceIds = [id];
  while (sourceIds.length > 0) {
    const linkedTemplates = await prisma.ourCategoryImageTemplate.findMany({
      where: { linkedSourceImageTemplateId: { in: sourceIds } },
      select: { id: true },
    });
    sourceIds = linkedTemplates
      .map(({ id: linkedId }) => linkedId)
      .filter((linkedId) => {
        if (visitedIds.has(linkedId)) return false;
        visitedIds.add(linkedId);
        dependentTemplates.push({ id: linkedId });
        return true;
      });
  }

  const affectedTemplateIds = [id, ...dependentTemplates.map(({ id: dependentId }) => dependentId)];
  const listingImages = await prisma.etsyListingImage.findMany({
    where: { ourCategoryImageTemplateId: { in: affectedTemplateIds } },
    select: {
      id: true,
      listingId: true,
      localFileName: true,
      listing: {
        select: {
          id: true,
          shopId: true,
          localDirectoryName: true,
          subSection: {
            select: {
              name: true,
              shopSection: {
                select: {
                  title: true,
                  shop: { select: { etsyShopId: true, shopName: true, title: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  const affectedListingIds = [...new Set(listingImages.map(({ listingId }) => listingId))];
  const templateType: OurTemplateType = template.category.templateType === 'multiple' ? 'multiple' : 'single';

  return {
    template,
    dependentTemplates,
    affectedTemplateIds,
    listingImages,
    affectedListingIds,
    impact: {
      templateId: String(id),
      templateType,
      dependentTemplateImageCount: dependentTemplates.length,
      generatedListingImageCount: listingImages.length,
      affectedListingCount: affectedListingIds.length,
      requiresCascade: dependentTemplates.length > 0 || listingImages.length > 0,
    } satisfies OurCategoryImageTemplateDeletionImpact,
  };
}

export async function getOurCategoryImageTemplateDeletionImpact(templateId: string) {
  return (await imageTemplateDeletionPlan(templateId)).impact;
}

type ImageRemovalGroup = {
  directoryPath: string;
  images: Array<{ localFileName: string | null }>;
};

async function removeImageGroups(
  groups: readonly ImageRemovalGroup[],
  index: number,
  deleteDatabaseRows: () => Promise<void>,
): Promise<void> {
  const group = groups[index];
  if (!group) {
    await deleteDatabaseRows();
    return;
  }
  await removeListingImages(group.directoryPath, group.images, () => (
    removeImageGroups(groups, index + 1, deleteDatabaseRows)
  ));
}

export async function deleteOurCategoryImageTemplate(templateId: string) {
  const plan = await imageTemplateDeletionPlan(templateId);
  const fallbackShopIds = [...new Set(plan.listingImages.flatMap(({ listing }) => (
    listing.subSection?.shopSection.shop || !/^\d+$/.test(listing.shopId) ? [] : [BigInt(listing.shopId)]
  )))];
  const fallbackShops = fallbackShopIds.length > 0
    ? await prisma.etsyShop.findMany({
      where: { etsyShopId: { in: fallbackShopIds } },
      select: { etsyShopId: true, shopName: true, title: true },
    })
    : [];
  const fallbackShopById = new Map(fallbackShops.map((shop) => [shop.etsyShopId.toString(), shop]));
  const removalGroupsByPath = new Map<string, ImageRemovalGroup>();

  for (const image of plan.listingImages) {
    if (!image.localFileName) continue;
    const subSection = image.listing.subSection;
    const section = subSection?.shopSection;
    const shop = section?.shop ?? fallbackShopById.get(image.listing.shopId);
    if (!subSection || !section || !shop) {
      throw new Error(`The storage location for listing ${image.listing.id} could not be resolved. No images were deleted.`);
    }
    const directoryPath = getListingDirectoryPath(
      shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`,
      section.title,
      subSection.name,
      image.listing.localDirectoryName ?? `Listing-${image.listing.id}`,
    );
    const group = removalGroupsByPath.get(directoryPath) ?? { directoryPath, images: [] };
    group.images.push({ localFileName: image.localFileName });
    removalGroupsByPath.set(directoryPath, group);
  }

  const removalGroups = [...removalGroupsByPath.values()];
  if (!plan.template.linkedSourceImageTemplateId) {
    removalGroups.push({
      directoryPath: path.dirname(plan.template.imagePath),
      images: [{ localFileName: path.basename(plan.template.imagePath) }],
    });
  }

  await removeImageGroups(removalGroups, 0, async () => {
    await prisma.$transaction(async (transaction) => {
      if (plan.listingImages.length > 0) {
        await transaction.etsyListingImage.deleteMany({
          where: { id: { in: plan.listingImages.map(({ id: imageId }) => imageId) } },
        });
      }
      if (plan.affectedListingIds.length > 0) {
        await transaction.etsyListing.updateMany({
          where: { id: { in: plan.affectedListingIds } },
          data: { imagesChanged: true, lastLocalChangeAt: new Date() },
        });
      }
      if (plan.dependentTemplates.length > 0) {
        await transaction.ourCategoryImageTemplate.deleteMany({
          where: { id: { in: plan.dependentTemplates.map(({ id: dependentId }) => dependentId) } },
        });
      }
      await transaction.ourCategoryImageTemplate.delete({ where: { id: plan.template.id } });
    });
  });

  return {
    deletedId: String(plan.template.id),
    deletedTemplateIds: plan.affectedTemplateIds.map(String),
    deletedListingImageCount: plan.listingImages.length,
  };
}

export async function reorderOurCategoryImageTemplates(categoryId: string, order: unknown) {
  const id = Number(categoryId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid category id.');
  const category = await prisma.ourCategory.findUnique({
    where: { id },
    select: { imageTemplates: { select: { id: true } } },
  });
  if (!category) throw new Error('Our Template not found.');
  const requestedIds = validateOurCategoryTemplateOrder(
    order,
    category.imageTemplates.map((template) => template.id),
  );
  await prisma.$transaction(async (transaction) => {
    for (const [position, templateId] of requestedIds.entries()) {
      await transaction.$executeRaw`
        UPDATE our_category_image_templates
        SET position = ${position}
        WHERE id = ${templateId} AND categoryId = ${id}
      `;
    }
  });
  return requestedIds.map(String);
}

export async function testOurCategoryImageTemplate(templateId: string, files: File[]) {
  const id = Number(templateId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid image template id.');
  const template = await prisma.ourCategoryImageTemplate.findUnique({
    where: { id },
  });
  if (!template) throw new Error('Image template not found.');
  const categorySettings = await getOurCategorySettings(template.categoryId);
  if (!categorySettings) throw new Error('Our Template not found.');
  const categoryValues = settingsRowValues(categorySettings);
  const resolvedView = await resolvedImageTemplateView(template);
  if (!resolvedView.imageWidth || !resolvedView.imageHeight) {
    throw new Error('Edit and save this image template before testing it.');
  }
  if (resolvedView.displayFonts) {
    if (files.length > 0) throw new Error('A Display fonts template does not require an attached image.');
    return renderOurCategoryImageTemplate(id, new Map());
  }
  const openingRegions = resolvedView.openingRegions;
  const requiredImageItemNumbers = categoryValues.templateType === 'multiple'
    ? [...new Set(openingRegions.flatMap((region) => {
      if (region.grid) return region.grid.cells.map((cell, cellIndex) => {
        if (cell.imageItemNumber > categoryValues.itemCount) {
          throw new Error(`Edit this image template and choose an image item number from 1 to ${categoryValues.itemCount} for ${region.name}, Image ${cellIndex + 1}.`);
        }
        return cell.imageItemNumber;
      });
      if (!region.imageItemNumber || region.imageItemNumber > categoryValues.itemCount) {
        throw new Error(`Edit this image template and choose an image item number from 1 to ${categoryValues.itemCount} for ${region.name}.`);
      }
      return [region.imageItemNumber];
    }))].sort((first, second) => first - second)
    : [1];
  if (requiredImageItemNumbers.length === 0) {
    throw new Error('Edit this image template and add an artwork region before testing it.');
  }
  const expectedImageCount = requiredImageItemNumbers.length;
  if (files.length !== expectedImageCount) {
    throw new Error(categoryValues.templateType === 'multiple'
      ? `Choose all ${expectedImageCount} images required by this image template.`
      : 'Choose an image to attach.');
  }
  for (const file of files) {
    if (file.size === 0) throw new Error('Choose an image to attach.');
    if (file.size > MAX_TEMPLATE_BYTES) throw new Error('Each attached image must be 25 MB or smaller.');
    const extension = path.extname(file.name).toLocaleLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('Choose JPG, PNG, or WEBP images.');
  }
  const sourceImages = await Promise.all(files.map(async (file) => Buffer.from(await file.arrayBuffer())));
  return renderOurCategoryImageTemplate(id, new Map(
    requiredImageItemNumbers.map((itemNumber, index) => [itemNumber, sourceImages[index]]),
  ));
}

export async function renderOurCategoryImageTemplate(
  templateId: number,
  sourceImagesByItemNumber: Map<number, Buffer>,
  listingTextAreasByItemNumber?: Map<number, ListingPersonalisationTextAreaSettings | null>,
  listingCustomisationByItemNumber?: Map<number, ListingCustomisationSettings>,
  listingTextRatioByItemNumber?: Map<number, PrintableDownloadRatio>,
  listingPrintCropsByItemNumber?: Map<number, ListingPrintCropSettings | null>,
  listingBackgroundColour?: ArtworkBackgroundColour,
) {
  const template = await prisma.ourCategoryImageTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error('Image template not found.');
  const categorySettings = await getOurCategorySettings(template.categoryId);
  if (!categorySettings) throw new Error('Our Template not found.');
  const categoryValues = settingsRowValues(categorySettings);
  const backgroundColour = normalizeArtworkBackgroundColour(
    listingBackgroundColour ?? categoryValues.backgroundColour,
  );
  const [resolvedView, storedTemplate] = await Promise.all([
    resolvedImageTemplateView(template),
    resolvedStoredImageTemplate(template),
  ]);
  if (!resolvedView.imageWidth || !resolvedView.imageHeight) {
    throw new Error('Edit and save this image template before generating it.');
  }
  const openingRegions = resolvedView.openingRegions;
  const effectiveTextPlacement = (itemNumber: number, ratio?: PrintableDownloadRatio) => {
    if (!listingTextAreasByItemNumber) return undefined;
    return effectiveListingPersonalisationTextAreas(
      listingTextAreasByItemNumber.get(itemNumber) ?? null,
      listingCustomisationByItemNumber?.get(itemNumber) ?? categoryValues,
      ratio ?? listingTextRatioByItemNumber?.get(itemNumber) ?? '2x3',
    );
  };
  const textPlacement = (itemNumber: number, ratio?: PrintableDownloadRatio) => {
    const effective = effectiveTextPlacement(itemNumber, ratio);
    if (!effective) return undefined;
    return {
      showTop: effective.showTop,
      showBottom: effective.showBottom,
      ...(effective.saved && effective.showTop ? { top: effective.top } : {}),
      ...(effective.saved && effective.showBottom ? { bottom: effective.bottom } : {}),
    };
  };
  const prepareTemplateArtwork = async (
    sourceImage: Buffer,
    personalisation: ReturnType<typeof validateOurCategoryTemplatePersonalisation>,
    itemNumber: number,
    ratio: PrintableDownloadRatio = 'iso-a1',
    orientation?: ListingArtworkOrientation,
  ) => {
    const cropSettings = listingPrintCropsByItemNumber?.get(itemNumber) ?? null;
    if (listingPrintCropsByItemNumber && !cropSettings) {
      throw new Error(`Complete Set Size for Image ${itemNumber} before generating listing images.`);
    }
    if (cropSettings) {
      const ratioText = effectiveTextPlacement(itemNumber, ratio)
        ?? DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS;
      const topText = ratioText.showTop ? personalisation.topText : '';
      const bottomText = ratioText.showBottom ? personalisation.bottomText : '';
      const preview = await createListingPersonalisationPreview(sourceImage, {
        sizeKey: TEMPLATE_PREVIEW_SIZE_BY_RATIO[ratio],
        topText,
        bottomText,
        fontId: personalisation.fontId,
        borderEnabled: false,
        borderSizePercent: 5,
        textAreas: {
          showTop: ratioText.showTop,
          showBottom: ratioText.showBottom,
          top: ratioText.top,
          bottom: ratioText.bottom,
        },
        cropRegion: cropSettings.regions[ratio],
        artworkPlacement: cropSettings.placements[ratio],
        orientation: cropSettings.orientation,
        backgroundColour,
      });
      return orientation && orientation !== cropSettings.orientation
        ? sharp(preview.buffer, { failOn: 'error' }).rotate(90).webp({ quality: 88, effort: 4 }).toBuffer()
        : preview.buffer;
    }
    const prepared = await prepareOurCategoryTemplateArtwork(
      sourceImage,
      personalisation,
      textPlacement(itemNumber, ratio),
    );
    return sharp(prepared, { failOn: 'error' })
      .flatten({ background: backgroundColour })
      .png({ compressionLevel: 9 })
      .toBuffer();
  };
  try {
    if (resolvedView.displayFonts) return createFontShowcaseImage();
    const templateImage = await readFile(storedTemplate.imagePath);
    const singlePersonalisation = validateOurCategoryTemplatePersonalisation(
      resolvedView.topText,
      resolvedView.bottomText,
      resolvedView.fontId,
    );
    const regionArtworks = await Promise.all(openingRegions.map(async (region) => {
      const personalisation = categoryValues.templateType === 'multiple'
        ? validateOurCategoryTemplatePersonalisation(
          region.topText ?? '',
          region.bottomText ?? '',
          region.fontId ?? DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
        )
        : singlePersonalisation;
      if (region.grid) {
        const cellArtworks = await Promise.all(region.grid.cells.map(async (cell, cellIndex) => {
          if (cell.imageItemNumber > categoryValues.itemCount) {
            throw new Error(`Edit this image template and choose an image item number from 1 to ${categoryValues.itemCount} for ${region.name}, Image ${cellIndex + 1}.`);
          }
          const sourceImage = sourceImagesByItemNumber.get(cell.imageItemNumber);
          if (!sourceImage) throw new Error(`Image ${cell.imageItemNumber} is required to generate ${template.name}.`);
          const cellPersonalisation = validateOurCategoryTemplatePersonalisation(
            cell.topText,
            cell.bottomText,
            cell.fontId,
          );
          return prepareTemplateArtwork(sourceImage, cellPersonalisation, cell.imageItemNumber, cell.ratio, cell.orientation);
        }));
        return { region, cellArtworks };
      }
      const imageItemNumber = categoryValues.templateType === 'multiple' ? region.imageItemNumber : 1;
      if (!imageItemNumber || imageItemNumber > categoryValues.itemCount) {
        throw new Error(`Edit this image template and choose an image item number from 1 to ${categoryValues.itemCount} for ${region.name}.`);
      }
      const sourceImage = sourceImagesByItemNumber.get(imageItemNumber);
      if (!sourceImage) throw new Error(`Image ${imageItemNumber} is required to generate ${template.name}.`);
      return {
        region,
        artwork: await prepareTemplateArtwork(sourceImage, personalisation, imageItemNumber),
      };
    }));
    return await composeOurCategoryTemplateWithArtworks(templateImage, regionArtworks, {
      borderEnabled: resolvedView.borderEnabled,
      borderSizePercent: resolvedView.borderSizePercent,
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith('The S3 template image')
      || error.message.startsWith('Edit this image template')
      || error.message.startsWith('Image ')
      || error.message.startsWith('Complete Set Size')
      || error.message.startsWith('The image-template border size')
    )) throw error;
    throw new Error('The attached file or S3 template is not a valid image.');
  }
}
