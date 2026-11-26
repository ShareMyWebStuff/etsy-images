import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';

import { ETSY_LISTINGS_DIRECTORY } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { mkdir, readFile, readImagePreview, unlink, writeFile } from '@/lib/s3-listing-storage';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { parseCurrentListingPrintCropSettings, type ListingPrintCropSettings } from '@/lib/listing-print-crops';
import { invalidateListingImageGeneration } from '@/lib/listing-image-generation-state';
import { renderOurTemplateImage, validateOurTemplateImagePair } from '@/lib/our-template-image-renderer';
import { validateOurTemplateImageDefinition } from '@/lib/our-template-image-geometry';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';
import { normalizeArtworkBackgroundColour, type ArtworkBackgroundColour } from '@/lib/artwork-background-colours';
import { removeListingImages } from '@/lib/listing-image-reset';
import type { TemplateImageTag } from '@/lib/our-template-image-tag-types';
import { assertTemplateImageTagsExist, getTagsForTemplateImages, saveTemplateImageTagIds, templateImageTagIdsFromForm } from '@/lib/our-template-image-tags';
import { getSceneDefinitionContexts, getStoredTemplateImageDefinition, type TemplateImageDefinitionContext } from '@/lib/our-template-image-definition-context';
import { getDefinitionArtworkItems, validateDefinitionChildMode, type TemplateImageArtworkItem, type TemplateImageVariantSlot } from '@/lib/our-template-image-definition-types';

const MAX_BYTES = 25 * 1024 * 1024;
// Brush masks live in the scene JSON; bound parsing work before inspecting individual strokes.
const MAX_DEFINITION_CHARACTERS = 4 * 1024 * 1024;
const DIRECTORY = path.join(ETSY_LISTINGS_DIRECTORY, 'OurTemplateImages');
type SceneRow = {
  id: string; name: string; originalFileName: string; imagePath: string;
  whiteImagePath: string | null; blackImagePath: string | null;
  definition: OurTemplateImageDefinition | string; createdAt: Date; updatedAt: Date;
};
export type OurTemplateImageView = OurTemplateImageDefinition & {
  id: string; name: string; originalFileName: string; createdAt: string; updatedAt: string;
  tags: TemplateImageTag[];
  parentDefinitionId?: string;
  variantSlot?: TemplateImageVariantSlot;
  artworkItems?: TemplateImageArtworkItem[];
  artworkItemCount?: number;
};

function sceneId(value: string) {
  if (!/^[a-f0-9-]{36}$/i.test(value)) throw new Error('Invalid template image id.');
  return value;
}
function definition(row: SceneRow): OurTemplateImageDefinition {
  return typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition;
}
function view(row: SceneRow, tags: TemplateImageTag[] = [], contexts: TemplateImageDefinitionContext[] = []): OurTemplateImageView {
  const primary = contexts.find((context) => context.definitionId === row.id) ?? contexts[0];
  const configured = definition(row);
  let artworkItems: TemplateImageArtworkItem[];
  try { artworkItems = getDefinitionArtworkItems(configured); }
  catch { artworkItems = [...new Map(configured.openings.map((opening) => [opening.imageItemNumber,
    { imageItemNumber: opening.imageItemNumber, orientation: opening.orientation }])).values()]; }
  return { ...definition(row), id: row.id, name: row.name, originalFileName: row.originalFileName,
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(), tags,
    ...(primary ? { parentDefinitionId: primary.definitionId, variantSlot: primary.variantSlot } : {}),
    artworkItems, artworkItemCount: artworkItems.length };
}
export async function getStoredOurTemplateImage(id: string): Promise<SceneRow> {
  const rows = await prisma.$queryRaw<SceneRow[]>`SELECT * FROM our_template_images WHERE id = ${sceneId(id)} LIMIT 1`;
  if (!rows[0]) throw new Error('Template image not found.');
  return rows[0];
}
export async function getOurTemplateImages(): Promise<OurTemplateImageView[]> {
  const rows = await prisma.$queryRaw<SceneRow[]>`SELECT * FROM our_template_images ORDER BY createdAt DESC, id DESC`;
  const [tags, contexts] = await Promise.all([getTagsForTemplateImages(rows.map(({ id }) => id)), getSceneDefinitionContexts(rows.map(({ id }) => id))]);
  return rows.map((row) => view(row, tags.get(row.id), contexts.get(row.id)));
}
export async function getOurTemplateImage(id: string) {
  const row = await getStoredOurTemplateImage(id);
  const [tags, contexts] = await Promise.all([getTagsForTemplateImages([row.id]), getSceneDefinitionContexts([row.id])]);
  return view(row, tags.get(row.id), contexts.get(row.id));
}
export async function getOurTemplateImageFile(id: string, preview = false) {
  const { imagePath } = await getStoredOurTemplateImage(id);
  return preview ? readImagePreview(imagePath) : readFile(imagePath);
}

export type SceneReferenceRow = { id: number; categoryId: number; ourTemplateImageId: string | null; linkedSourceImageTemplateId: number | null;
  orientationVariants?: unknown; templateImageDefinitionId?: string | null };
/** Resolve all image links before changing references; a deleted source cannot be traversed later. */
export function dependentSceneReferences(rows: SceneReferenceRow[], id: string, definitionIds: readonly string[] = []) {
  const ids = new Set(rows.filter((row) => {
    if (row.templateImageDefinitionId && definitionIds.includes(row.templateImageDefinitionId)) return true;
    if (row.ourTemplateImageId === id) return true;
    let variants = row.orientationVariants;
    if (typeof variants === 'string') { try { variants = JSON.parse(variants); } catch { return false; } }
    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return false;
    return ['portrait', 'landscape'].some((orientation) => {
      const slot = (variants as Record<string, unknown>)[orientation];
      return slot && typeof slot === 'object' && !Array.isArray(slot) && (slot as Record<string, unknown>).ourTemplateImageId === id;
    });
  }).map((row) => row.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (row.linkedSourceImageTemplateId && ids.has(row.linkedSourceImageTemplateId) && !ids.has(row.id)) {
      ids.add(row.id); changed = true;
    }
  }
  return rows.filter((row) => ids.has(row.id));
}
export async function sceneAffectedDependencies(id: string, additionalDefinitionIds: readonly string[] = []) {
  const rows = await prisma.$queryRaw<SceneReferenceRow[]>`
    SELECT id, categoryId, ourTemplateImageId, linkedSourceImageTemplateId, orientationVariants, templateImageDefinitionId FROM our_category_image_templates`;
  const contexts = await getSceneDefinitionContexts([id]);
  const references = dependentSceneReferences(rows, id, [...additionalDefinitionIds, ...(contexts.get(id)?.map((context) => context.definitionId) ?? [])]);
  const categoryIds = [...new Set(references.map((row) => row.categoryId))];
  const listings = categoryIds.length ? await prisma.etsyListing.findMany({
    where: { ourCategoryId: { in: categoryIds } }, select: { id: true },
  }) : [];
  return { references, categoryIds, listingIds: listings.map((listing) => listing.id) };
}
export async function getOurTemplateImageDeletionImpact(id: string) {
  await getStoredOurTemplateImage(id);
  const dependencies = await sceneAffectedDependencies(id);
  return { affectedTemplateCount: dependencies.categoryIds.length,
    affectedImageTemplateCount: dependencies.references.length, affectedListingCount: dependencies.listingIds.length };
}

async function pngFile(file: FormDataEntryValue | null, label: string) {
  if (!(file instanceof File) || !file.size) throw new Error(`Choose ${label}.`);
  if (file.size > MAX_BYTES) throw new Error(`The ${label} must be 25 MB or smaller.`);
  const contents = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(contents, { failOn: 'error' }).metadata().catch(() => null);
  if (!metadata?.width || !metadata.height || metadata.format !== 'png') throw new Error(`The ${label} must be a valid PNG export.`);
  if (metadata.width * metadata.height > 40_000_000) throw new Error('Choose a PNG with no more than 40 million pixels.');
  return { contents, width: metadata.width, height: metadata.height, name: file.name.slice(0, 255) };
}
function readName(form: FormData, previous?: SceneRow) {
  const name = String(form.get('name') ?? previous?.name ?? '').trim();
  if (!name || name.length > 100) throw new Error('Enter a template image name of 1 to 100 characters.');
  return name;
}
async function prepareSceneForm(form: FormData, previous?: SceneRow) {
  const name = readName(form, previous);
  const tagIds = templateImageTagIdsFromForm(form);
  if (tagIds) await assertTemplateImageTagsExist(tagIds);
  const replacement = form.get('file');
  const image = replacement instanceof File && replacement.size ? await pngFile(replacement, 'room scene PNG') : null;
  if (!previous && !image) throw new Error('Choose a room scene PNG.');
  const contents = image?.contents ?? await readFile(previous!.imagePath);
  const metadata = await sharp(contents).metadata();
  let rawDefinition: unknown;
  const serializedDefinition = form.has('definition') ? String(form.get('definition')) : null;
  if (serializedDefinition && serializedDefinition.length > MAX_DEFINITION_CHARACTERS) {
    throw new Error('The scene settings are too large. Remove some Keep in front selections or brush strokes and try again.');
  }
  try { rawDefinition = serializedDefinition !== null ? JSON.parse(serializedDefinition) : previous ? definition(previous) : null; }
  catch { throw new Error('The opening settings are invalid.'); }
  const contexts = previous ? (await getSceneDefinitionContexts([previous.id])).get(previous.id) ?? [] : [];
  if (!previous && form.has('parentDefinitionId')) {
    const parent = await getStoredTemplateImageDefinition(String(form.get('parentDefinitionId')));
    const variantSlot = form.get('variantSlot');
    if (variantSlot !== 'portrait' && variantSlot !== 'landscape' && variantSlot !== 'single') throw new Error('Choose a valid image slot.');
    contexts.push({ definitionId: parent.id, mode: parent.mode, variantSlot });
  }
  if (previous && form.has('parentDefinitionId') && !contexts.some((context) => context.definitionId === form.get('parentDefinitionId')
    && (form.get('variantSlot') === null || context.variantSlot === form.get('variantSlot')))) {
    throw new Error('This image does not belong to the selected template definition and slot.');
  }
  const configured = validateOurTemplateImageDefinition(rawDefinition, undefined, undefined, { allowEmptyOpenings: contexts.some((context) => context.mode === 'no-areas') });
  for (const context of contexts) validateDefinitionChildMode(context.mode, context.variantSlot, configured);
  if (!previous && !contexts.length) validateDefinitionChildMode('both', configured.openings.every((opening) => opening.orientation === 'landscape') ? 'landscape' : 'portrait', configured);
  if (configured.width !== metadata.width || configured.height !== metadata.height) throw new Error('The opening coordinates must match the original PNG dimensions.');
  const whiteFile = form.get('whiteFile'); const blackFile = form.get('blackFile');
  const hasWhite = whiteFile instanceof File && whiteFile.size > 0;
  const hasBlack = blackFile instanceof File && blackFile.size > 0;
  if (hasWhite !== hasBlack) throw new Error('Choose both the white and black Canva PNG exports.');
  const white = hasWhite ? await pngFile(whiteFile, 'white artwork PNG') : null;
  const black = hasBlack ? await pngFile(blackFile, 'black artwork PNG') : null;
  let whiteContents = white?.contents; let blackContents = black?.contents;
  if (configured.lightingMode === 'paired') {
    whiteContents ??= previous?.whiteImagePath ? await readFile(previous.whiteImagePath) : undefined;
    blackContents ??= previous?.blackImagePath ? await readFile(previous.blackImagePath) : undefined;
    if (!whiteContents || !blackContents) throw new Error('Paired lighting needs both the white and black Canva PNG exports.');
    await validateOurTemplateImagePair(whiteContents, blackContents, configured);
  } else if (white || black) {
    throw new Error('Select paired lighting to use the white and black Canva exports.');
  }
  return { name, image, contents, configured, white, black, tagIds, contexts };
}
async function persistPng(id: string, suffix: string, contents: Buffer) {
  const imagePath = path.join(DIRECTORY, id, `${randomUUID()}-${suffix}.png`);
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(imagePath, contents);
  return imagePath;
}
export async function createOurTemplateImage(form: FormData) {
  const prepared = await prepareSceneForm(form); const id = randomUUID(); const paths: string[] = [];
  const dependencies = prepared.contexts[0] ? await sceneAffectedDependencies(id, [prepared.contexts[0].definitionId]) : null;
  let committed = false;
  try {
    const imagePath = await persistPng(id, 'scene', prepared.contents); paths.push(imagePath);
    const whitePath = prepared.white ? await persistPng(id, 'white', prepared.white.contents) : null; if (whitePath) paths.push(whitePath);
    const blackPath = prepared.black ? await persistPng(id, 'black', prepared.black.contents) : null; if (blackPath) paths.push(blackPath);
    const serialized = JSON.stringify(prepared.configured); const now = new Date();
    await prisma.$transaction(async (transaction) => {
      let context = prepared.contexts[0];
      if (!context) {
        const variantSlot = prepared.configured.openings.every((opening) => opening.orientation === 'landscape') ? 'landscape' : 'portrait';
        validateDefinitionChildMode('both', variantSlot, prepared.configured);
        await transaction.$executeRaw`INSERT INTO our_template_image_definitions (id, name, mode, createdAt, updatedAt)
          VALUES (${id}, ${prepared.name}, ${'both'}, ${now}, ${now})`;
        context = { definitionId: id, mode: 'both', variantSlot };
      } else {
        const [parent] = await transaction.$queryRaw<Array<{ id: string }>>`SELECT id FROM our_template_image_definitions WHERE id = ${context.definitionId} FOR UPDATE`;
        if (!parent) throw new Error('The template image definition was deleted. Reload the library.');
        const occupied = await transaction.$queryRaw<Array<{ sceneId: string }>>`SELECT sceneId FROM our_template_image_definition_images
          WHERE definitionId = ${context.definitionId} AND variantSlot = ${context.variantSlot}`;
        if (occupied.length) throw new Error('This image slot is already filled. Edit or delete its current image first.');
      }
      await transaction.$executeRaw`INSERT INTO our_template_images
        (id, name, originalFileName, imagePath, whiteImagePath, blackImagePath, definition, createdAt, updatedAt)
        VALUES (${id}, ${prepared.name}, ${prepared.image!.name}, ${imagePath}, ${whitePath}, ${blackPath}, ${serialized}, ${now}, ${now})`;
      await transaction.$executeRaw`INSERT INTO our_template_image_definition_images (definitionId, variantSlot, sceneId)
        VALUES (${context.definitionId}, ${context.variantSlot}, ${id})`;
      await transaction.$executeRaw`UPDATE our_template_image_definitions SET updatedAt = ${now} WHERE id = ${context.definitionId}`;
      if (prepared.tagIds?.length) await saveTemplateImageTagIds(transaction, id, prepared.tagIds);
      if (dependencies) await invalidateListingImageGeneration(dependencies.listingIds, transaction);
    });
    committed = true;
    return await getOurTemplateImage(id);
  } catch (error) {
    // Reload failures must not remove files owned by the committed scene.
    if (!committed) await Promise.allSettled(paths.map((filePath) => unlink(filePath)));
    if (committed) throw new Error(`${error instanceof Error ? error.message : 'The updated details could not be loaded.'} The template image was saved. Reload the definition before uploading again.`, { cause: error });
    throw error;
  }
}
export async function updateOurTemplateImage(id: string, form: FormData) {
  const previous = await getStoredOurTemplateImage(id); const prepared = await prepareSceneForm(form, previous);
  const changed = renderDefinitionSignature(definition(previous)) !== renderDefinitionSignature(prepared.configured) || !!prepared.image || !!prepared.white || !!prepared.black;
  const dependencies = changed ? await sceneAffectedDependencies(id) : null;
  const paths: string[] = [];
  let committed = false;
  try {
    const imagePath = prepared.image ? await persistPng(id, 'scene', prepared.contents) : previous.imagePath; if (prepared.image) paths.push(imagePath);
    const whitePath = prepared.white ? await persistPng(id, 'white', prepared.white.contents) : previous.whiteImagePath; if (prepared.white && whitePath) paths.push(whitePath);
    const blackPath = prepared.black ? await persistPng(id, 'black', prepared.black.contents) : previous.blackImagePath; if (prepared.black && blackPath) paths.push(blackPath);
    const serialized = JSON.stringify(prepared.configured); const now = new Date(Math.max(Date.now(), new Date(previous.updatedAt).getTime() + 1));
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.$executeRaw`UPDATE our_template_images SET name = ${prepared.name},
        originalFileName = ${prepared.image?.name ?? previous.originalFileName}, imagePath = ${imagePath},
        whiteImagePath = ${whitePath}, blackImagePath = ${blackPath}, definition = ${serialized}, updatedAt = ${now}
        WHERE id = ${id} AND updatedAt = ${previous.updatedAt}`;
      if (Number(updated) !== 1) throw new Error('This image changed or was deleted while saving. Refresh and try again.');
      if (prepared.tagIds !== undefined) await saveTemplateImageTagIds(transaction, id, prepared.tagIds);
      if (dependencies) await invalidateListingImageGeneration(dependencies.listingIds, transaction);
    });
    committed = true;
    // Replaced originals are no longer referenced; failed cleanup must not turn a successful save into an error.
    await Promise.allSettled([previous.imagePath !== imagePath ? previous.imagePath : null,
      previous.whiteImagePath !== whitePath ? previous.whiteImagePath : null,
      previous.blackImagePath !== blackPath ? previous.blackImagePath : null].filter((p): p is string => !!p).map((p) => unlink(p)));
    return await getOurTemplateImage(id);
  } catch (error) {
    // Once committed, replacement files belong to the saved scene even if its reload fails.
    if (!committed) await Promise.allSettled(paths.map((filePath) => unlink(filePath)));
    if (committed) throw new Error(`${error instanceof Error ? error.message : 'The updated details could not be loaded.'} The template image was saved. Reload the definition before uploading again.`, { cause: error });
    throw error;
  }
}

export async function deleteOurTemplateImage(id: string) {
  const previous = await getStoredOurTemplateImage(id);
  const dependencies = await sceneAffectedDependencies(id);
  // Reuse the existing deletion path, which removes generated listing files and linked rows safely.
  const { deleteOurCategoryImageTemplate } = await import('@/lib/our-categories');
  const referenceIds = new Set(dependencies.references.map((reference) => reference.id));
  const roots = dependencies.references.filter((reference) => !reference.linkedSourceImageTemplateId || !referenceIds.has(reference.linkedSourceImageTemplateId));
  // Flag first: a failed storage deletion leaves the scene present and all affected listings visibly stale.
  await invalidateListingImageGeneration(dependencies.listingIds);
  for (const reference of roots) await deleteOurCategoryImageTemplate(String(reference.id), { localSceneChange: true });
  const sourceGroups = new Map<string, Array<{ localFileName: string }>>();
  for (const sourcePath of new Set([previous.imagePath, previous.whiteImagePath, previous.blackImagePath].filter((p): p is string => !!p))) {
    const directory = path.dirname(sourcePath);
    sourceGroups.set(directory, [...(sourceGroups.get(directory) ?? []), { localFileName: path.basename(sourcePath) }]);
  }
  const groups = [...sourceGroups.entries()];
  const removeSources = async (index: number): Promise<void> => {
    const group = groups[index];
    if (group) {
      await removeListingImages(group[0], group[1], () => removeSources(index + 1));
    } else {
      await prisma.$executeRaw`DELETE FROM our_template_images WHERE id = ${id}`;
    }
  };
  // Keep the scene row retryable, and restore sources, if any original/preview deletion fails.
  await removeSources(0);
  return { deletedId: id };
}

export async function renderSavedOurTemplateImage(id: string,
  artworks: Map<number, { contents: Buffer; cropSettings?: ListingPrintCropSettings; backgroundColour?: ArtworkBackgroundColour }>,
  mapItem?: (openingId: string, original: number) => number) {
  const row = await getStoredOurTemplateImage(id); const configured = definition(row);
  if (!configured.openings.length) {
    const contexts = await getSceneDefinitionContexts([id]);
    if (!contexts.get(id)?.some((context) => context.mode === 'no-areas')) throw new Error('The saved scene has no artwork openings.');
    return readFile(row.imagePath);
  }
  const effective = mapItem ? { ...configured, openings: configured.openings.map((opening) => ({
    ...opening, imageItemNumber: mapItem(opening.id, opening.imageItemNumber),
  })) } : configured;
  return renderOurTemplateImage({ scene: await readFile(row.imagePath), definition: effective, artworks,
    whiteScene: row.whiteImagePath ? await readFile(row.whiteImagePath) : undefined,
    blackScene: row.blackImagePath ? await readFile(row.blackImagePath) : undefined });
}

export async function getOurTemplateArtworkOptions() {
  const rows = await prisma.etsyListing.findMany({ where: { thumbnailFileName: { not: null } },
    select: { id: true, title: true, localDirectoryName: true, artworkOrientation: true }, orderBy: [{ id: 'desc' }], take: 500 });
  return rows.map((row) => ({ id: String(row.id), name: row.localDirectoryName || row.title || `Listing ${row.id}`,
    orientation: row.artworkOrientation === 'landscape' ? 'landscape' as const : 'portrait' as const }));
}
async function savedSampleArtwork(value: string) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Choose a valid sample listing.');
  const listing = await prisma.etsyListing.findUnique({ where: { id }, include: {
    subSection: { include: { shopSection: { include: { shop: true } } } },
    ourCategory: true,
  } });
  const section = listing?.subSection?.shopSection; const shop = section?.shop;
  if (!listing?.thumbnailFileName || !listing.subSection || !section || !shop) throw new Error('The sample listing does not have an available artwork image.');
  const directory = getListingDirectoryPath(shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`,
    section.title, listing.subSection.name, listing.localDirectoryName ?? `Listing-${id}`);
  const extras = await prisma.$queryRaw<Array<{ printCropSettings: Prisma.JsonValue; thumbnailUpdatedAt: Date | string | null; artworkOrientation: string }>>`
    SELECT printCropSettings, thumbnailUpdatedAt, artworkOrientation FROM etsy_listings WHERE id = ${id}`;
  const details = extras[0];
  const cropSettings = parseCurrentListingPrintCropSettings(details?.printCropSettings ?? null, {
    fileName: listing.thumbnailFileName,
    updatedAt: details?.thumbnailUpdatedAt instanceof Date ? details.thumbnailUpdatedAt.toISOString() : details?.thumbnailUpdatedAt ?? null,
    orientation: details?.artworkOrientation === 'landscape' ? 'landscape' : 'portrait',
  }) ?? undefined;
  return { contents: await readFile(path.join(directory, 'thumbnail', listing.thumbnailFileName)), cropSettings,
    orientation: details?.artworkOrientation === 'landscape' ? 'landscape' as const : 'portrait' as const,
    backgroundColour: normalizeArtworkBackgroundColour(listing.backgroundColour ?? listing.ourCategory?.backgroundColour) };
}
export async function testOurTemplateImage(id: string, form: FormData) {
  const configured = await getOurTemplateImage(id);
  const items = [...new Set(configured.openings.map((opening) => opening.imageItemNumber))];
  const artworks = new Map<number, { contents: Buffer; cropSettings?: ListingPrintCropSettings; backgroundColour?: ArtworkBackgroundColour }>();
  for (const item of items) {
    const file = form.get(`artwork-${item}`); const listingId = form.get(`listing-${item}`);
    if (file instanceof File && file.size) {
      if (file.size > MAX_BYTES) throw new Error(`Artwork ${item} must be 25 MB or smaller.`);
      const contents = Buffer.from(await file.arrayBuffer());
      const metadata = await sharp(contents, { failOn: 'error' }).metadata().catch(() => null);
      if (!metadata || !['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) throw new Error(`Choose a PNG, JPG or WebP for artwork ${item}.`);
      const dimensions = metadata.autoOrient ?? metadata;
      const orientation = dimensions.width && dimensions.height && dimensions.width > dimensions.height ? 'landscape' : 'portrait';
      if (configured.openings.some((opening) => opening.imageItemNumber === item && opening.orientation !== orientation)) throw new Error(`Artwork item ${item} must match its ${configured.openings.find((opening) => opening.imageItemNumber === item)!.orientation} area orientation.`);
      artworks.set(item, { contents });
    } else if (typeof listingId === 'string' && listingId) {
      const sample = await savedSampleArtwork(listingId);
      if (configured.openings.some((opening) => opening.imageItemNumber === item && opening.orientation !== sample.orientation)) throw new Error(`Artwork item ${item} must match its ${configured.openings.find((opening) => opening.imageItemNumber === item)!.orientation} area orientation.`);
      artworks.set(item, sample);
    }
    else throw new Error(`Supply artwork item ${item}.`);
  }
  return renderSavedOurTemplateImage(id, artworks);
}

/** Stable render fingerprint excludes the display name and creation/update metadata. */
export function ourTemplateImageRenderFingerprint(definitionValue: OurTemplateImageDefinition, scene: Buffer, white?: Buffer, black?: Buffer) {
  return createHash('sha256').update(renderDefinitionSignature(definitionValue)).update(scene).update(white ?? Buffer.alloc(0)).update(black ?? Buffer.alloc(0)).digest('hex');
}

function renderDefinitionSignature(value: OurTemplateImageDefinition) {
  const normalized = validateOurTemplateImageDefinition(value, undefined, undefined, { allowEmptyOpenings: value.openings.length === 0 });
  return JSON.stringify({ ...normalized,
    // Smart selections are strokes with compact regions and no brush points.
    foregroundMask: normalized.foregroundMask?.strokes.length ? normalized.foregroundMask : undefined,
    openings: normalized.openings.map(({ name: _name, ...opening }) => opening) });
}
