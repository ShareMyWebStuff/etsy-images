import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createOurTemplateImage, dependentSceneReferences, getOurTemplateImage, getOurTemplateImages, getStoredOurTemplateImage,
  type OurTemplateImageView, type SceneReferenceRow } from '@/lib/our-template-images';
import { getStoredTemplateImageDefinition, templateDefinitionId, type TemplateImageDefinitionRow } from '@/lib/our-template-image-definition-context';
import { removeListingImages } from '@/lib/listing-image-reset';
import type { OurTemplateImageDefinitionView, TemplateImageDefinitionMode, TemplateImageVariantSlot } from '@/lib/our-template-image-definition-types';

export type { OurTemplateImageDefinitionView, TemplateImageDefinitionMode, TemplateImageVariantSlot } from '@/lib/our-template-image-definition-types';
type Association = { definitionId: string; variantSlot: TemplateImageVariantSlot; sceneId: string };
type StoredScene = Awaited<ReturnType<typeof getStoredOurTemplateImage>>;

function name(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw new Error('Enter a template image name of 1 to 100 characters.');
  return value.trim();
}
function asView(row: TemplateImageDefinitionRow, associations: Association[], images: OurTemplateImageView[]): OurTemplateImageDefinitionView {
  const children = associations.filter((association) => association.definitionId === row.id).flatMap((association) => {
    const image = images.find((candidate) => candidate.id === association.sceneId);
    return image ? [{ ...image, parentDefinitionId: row.id, variantSlot: association.variantSlot }] : [];
  }).sort((first, second) => ['portrait', 'landscape', 'single'].indexOf(first.variantSlot) - ['portrait', 'landscape', 'single'].indexOf(second.variantSlot));
  return { id: row.id, name: row.name, mode: row.mode, createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(Math.max(new Date(row.updatedAt).getTime(), ...children.map((child) => Date.parse(child.updatedAt)))).toISOString(), images: children };
}
export async function getOurTemplateImageDefinitions(): Promise<OurTemplateImageDefinitionView[]> {
  const [parents, associations, images] = await Promise.all([
    prisma.$queryRaw<TemplateImageDefinitionRow[]>`SELECT id, name, mode, createdAt, updatedAt FROM our_template_image_definitions ORDER BY createdAt DESC, id DESC`,
    prisma.$queryRaw<Association[]>`SELECT definitionId, variantSlot, sceneId FROM our_template_image_definition_images`,
    getOurTemplateImages(),
  ]);
  return parents.map((parent) => asView(parent, associations, images));
}
export async function getOurTemplateImageDefinition(id: string): Promise<OurTemplateImageDefinitionView> {
  const parent = await getStoredTemplateImageDefinition(id);
  const associations = await prisma.$queryRaw<Association[]>`SELECT definitionId, variantSlot, sceneId
    FROM our_template_image_definition_images WHERE definitionId = ${parent.id}`;
  const images = await Promise.all([...new Set(associations.map((association) => association.sceneId))].map(getOurTemplateImage));
  return asView(parent, associations, images);
}
export async function createOurTemplateImageDefinition(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a template image name and type.');
  const value = input as Record<string, unknown>, definitionName = name(value.name), mode = value.mode;
  if (mode !== 'no-areas' && mode !== 'both' && mode !== 'combined') throw new Error('Choose No areas, Both, or Combined.');
  const id = randomUUID(), now = new Date();
  await prisma.$executeRaw`INSERT INTO our_template_image_definitions (id, name, mode, createdAt, updatedAt)
    VALUES (${id}, ${definitionName}, ${mode}, ${now}, ${now})`;
  try { return await getOurTemplateImageDefinition(id); }
  catch (error) { throw new Error(`The template image definition was created, but its details could not be loaded. Reload the library before trying again. ${error instanceof Error ? error.message : ''}`, { cause: error }); }
}
export async function updateOurTemplateImageDefinition(id: string, input: unknown) {
  const previous = await getStoredTemplateImageDefinition(id);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a template image name.');
  const value = input as Record<string, unknown>;
  if (value.mode !== undefined && value.mode !== previous.mode) throw new Error('The definition type cannot be changed after creation. Create another definition for a different type.');
  const definitionName = name(value.name);
  const updatedAt = new Date(Math.max(Date.now(), new Date(previous.updatedAt).getTime() + 1));
  const updated = await prisma.$executeRaw`UPDATE our_template_image_definitions SET name = ${definitionName}, updatedAt = ${updatedAt}
    WHERE id = ${previous.id} AND updatedAt = ${previous.updatedAt}`;
  if (Number(updated) !== 1) throw new Error('This template image definition changed or was deleted. Refresh and try again.');
  try { return await getOurTemplateImageDefinition(id); }
  catch (error) { throw new Error(`The template image definition was saved, but its details could not be loaded. Reload the library before trying again. ${error instanceof Error ? error.message : ''}`, { cause: error }); }
}
export async function createOurTemplateImageDefinitionImage(id: string, form: FormData) {
  const parent = await getStoredTemplateImageDefinition(id);
  form.set('parentDefinitionId', parent.id);
  if (!form.has('name')) form.set('name', parent.name);
  const image = await createOurTemplateImage(form);
  try { return { image, definition: await getOurTemplateImageDefinition(parent.id) }; }
  catch (error) { throw new Error(`The template image was saved, but the definition could not be reloaded. Reload it before uploading again. ${error instanceof Error ? error.message : ''}`, { cause: error }); }
}

async function dependencies(id: string) {
  const rows = await prisma.$queryRaw<SceneReferenceRow[]>`SELECT id, categoryId, ourTemplateImageId, linkedSourceImageTemplateId,
    orientationVariants, templateImageDefinitionId FROM our_category_image_templates`;
  return dependentSceneReferences(rows, '', [id]);
}
async function legacyReferences(reader: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma, lock = false) {
  return reader.$queryRaw<SceneReferenceRow[]>(Prisma.sql`SELECT id, categoryId, ourTemplateImageId, linkedSourceImageTemplateId,
    orientationVariants, templateImageDefinitionId FROM our_category_image_templates
    WHERE templateImageDefinitionId IS NULL AND linkedSourceImageTemplateId IS NULL ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
}
function legacyUsesScene(rows: SceneReferenceRow[], sceneId: string) {
  return rows.some((row) => {
    // A definition or source-role link is authoritative; its older columns can be stale.
    if (row.templateImageDefinitionId || row.linkedSourceImageTemplateId) return false;
    let variants = row.orientationVariants;
    if (typeof variants === 'string') {
      const serialized = variants;
      try { variants = JSON.parse(variants); }
      catch { return row.ourTemplateImageId === sceneId || serialized.includes(sceneId); }
    }
    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return row.ourTemplateImageId === sceneId;
    return ['portrait', 'landscape'].some((slot) => {
      const value = (variants as Record<string, unknown>)[slot];
      return value && typeof value === 'object' && (value as { ourTemplateImageId?: string }).ourTemplateImageId === sceneId;
    });
  });
}
export async function getOurTemplateImageDefinitionDeletionImpact(id: string) {
  await getStoredTemplateImageDefinition(id);
  const references = await dependencies(id), categoryIds = [...new Set(references.map((reference) => reference.categoryId))];
  const listings = categoryIds.length ? await prisma.etsyListing.findMany({ where: { ourCategoryId: { in: categoryIds } }, select: { id: true } }) : [];
  return { affectedTemplateCount: categoryIds.length, affectedImageTemplateCount: references.length, affectedListingCount: listings.length };
}

async function sourceGroups(scenes: StoredScene[], action: () => Promise<void>) {
  const groups = new Map<string, { localFileName: string }[]>();
  for (const scene of scenes) for (const filePath of new Set([scene.imagePath, scene.whiteImagePath, scene.blackImagePath].filter((value): value is string => Boolean(value)))) {
    const directory = path.dirname(filePath); groups.set(directory, [...(groups.get(directory) ?? []), { localFileName: path.basename(filePath) }]);
  }
  const entries = [...groups];
  const next = async (index: number): Promise<void> => index === entries.length ? action()
    : removeListingImages(entries[index][0], entries[index][1], () => next(index + 1));
  await next(0);
}
async function assertSnapshot(transaction: Prisma.TransactionClient, parent: TemplateImageDefinitionRow, associations: Association[], scenes: StoredScene[]) {
  const [current] = await transaction.$queryRaw<TemplateImageDefinitionRow[]>`SELECT id, name, mode, createdAt, updatedAt
    FROM our_template_image_definitions WHERE id = ${parent.id} FOR UPDATE`;
  if (!current || new Date(current.updatedAt).getTime() !== new Date(parent.updatedAt).getTime()) throw new Error('The definition changed during deletion. Refresh and try again.');
  const links = await transaction.$queryRaw<Association[]>`SELECT definitionId, variantSlot, sceneId FROM our_template_image_definition_images WHERE definitionId = ${parent.id}`;
  const signature = (value: Association[]) => JSON.stringify(value.map(({ definitionId, variantSlot, sceneId }) => [definitionId, variantSlot, sceneId]).sort());
  if (signature(links) !== signature(associations)) throw new Error('The definition images changed during deletion. Refresh and try again.');
  for (const scene of scenes) {
    const [row] = await transaction.$queryRaw<StoredScene[]>`SELECT * FROM our_template_images WHERE id = ${scene.id} FOR UPDATE`;
    const others = await transaction.$queryRaw<Association[]>`SELECT definitionId, variantSlot, sceneId FROM our_template_image_definition_images
      WHERE sceneId = ${scene.id} AND definitionId <> ${parent.id}`;
    if (!row || others.length || row.imagePath !== scene.imagePath || row.whiteImagePath !== scene.whiteImagePath || row.blackImagePath !== scene.blackImagePath
      || new Date(row.updatedAt).getTime() !== new Date(scene.updatedAt).getTime()) throw new Error('A shared image changed during deletion. Refresh and try again.');
  }
  const legacy = scenes.length ? await legacyReferences(transaction, true) : [];
  if (scenes.some((scene) => legacyUsesScene(legacy, scene.id))) throw new Error('This image was linked to another template while deleting. Refresh and try again. Its source files have been retained.');
}

async function deletionSnapshot(id: string) {
  const parent = await getStoredTemplateImageDefinition(templateDefinitionId(id));
  const associations = await prisma.$queryRaw<Association[]>`SELECT definitionId, variantSlot, sceneId FROM our_template_image_definition_images WHERE definitionId = ${id}`;
  const sceneIds = [...new Set(associations.map((association) => association.sceneId))];
  const allLinks = sceneIds.length ? await prisma.$queryRaw<Association[]>(Prisma.sql`SELECT definitionId, variantSlot, sceneId
    FROM our_template_image_definition_images WHERE sceneId IN (${Prisma.join(sceneIds)})`) : [];
  return { parent, associations, allLinks, legacy: await legacyReferences() };
}

export async function deleteOurTemplateImageDefinition(id: string) {
  const { parent, associations, allLinks, legacy } = await deletionSnapshot(id), references = await dependencies(id);
  const unshared = [...new Set(associations.filter((association) => !allLinks.some((other) => other.sceneId === association.sceneId && other.definitionId !== id)
    && !legacyUsesScene(legacy, association.sceneId)).map((association) => association.sceneId))];
  const scenes = await Promise.all(unshared.map(getStoredOurTemplateImage));
  const { removeOurCategoryImageTemplateOutputs } = await import('@/lib/our-categories');
  await sourceGroups(scenes, () => removeOurCategoryImageTemplateOutputs(references.map((reference) => reference.id), async (transaction, affectedRoleIds) => {
    await assertSnapshot(transaction, parent, associations, scenes);
    // Remove linked leaves first because source-role links deliberately restrict deletion.
    const remaining = new Set(affectedRoleIds);
    while (remaining.size) {
      const leaves = [...remaining].filter((roleId) => !references.some((reference) => remaining.has(reference.id) && reference.linkedSourceImageTemplateId === roleId));
      if (!leaves.length) throw new Error('A linked image role contains a cycle. Remove its link before deleting this definition.');
      await transaction.ourCategoryImageTemplate.deleteMany({ where: { id: { in: leaves } } });
      leaves.forEach((roleId) => remaining.delete(roleId));
    }
    await transaction.$executeRaw`DELETE FROM our_template_image_definition_images WHERE definitionId = ${id}`;
    for (const scene of scenes) await transaction.$executeRaw`DELETE FROM our_template_images WHERE id = ${scene.id}`;
    await transaction.$executeRaw`DELETE FROM our_template_image_definitions WHERE id = ${id}`;
  }, { deleteRoleFiles: true }));
  return { deletedId: id };
}

export async function deleteOurTemplateImageDefinitionImage(id: string, sceneId: string) {
  const { parent, associations, allLinks, legacy } = await deletionSnapshot(id);
  if (!associations.some((association) => association.sceneId === sceneId)) throw new Error('This image does not belong to the selected definition.');
  const references = await dependencies(id);
  const scenes = allLinks.some((association) => association.sceneId === sceneId && association.definitionId !== id) || legacyUsesScene(legacy, sceneId)
    ? [] : [await getStoredOurTemplateImage(sceneId)];
  const { removeOurCategoryImageTemplateOutputs } = await import('@/lib/our-categories');
  await sourceGroups(scenes, () => removeOurCategoryImageTemplateOutputs(references.map((reference) => reference.id), async (transaction, affectedRoleIds) => {
    await assertSnapshot(transaction, parent, associations, scenes);
    for (const roleId of affectedRoleIds) {
      const row = references.find((reference) => reference.id === roleId);
      let variants = row?.orientationVariants;
      if (typeof variants === 'string') variants = JSON.parse(variants);
      if (variants && typeof variants === 'object' && !Array.isArray(variants)) {
        for (const slot of ['portrait', 'landscape']) {
          const value = (variants as Record<string, unknown>)[slot];
          if (value && typeof value === 'object' && (value as { ourTemplateImageId?: string }).ourTemplateImageId === sceneId) (variants as Record<string, unknown>)[slot] = null;
        }
        await transaction.$executeRaw`UPDATE our_category_image_templates SET orientationVariants = ${JSON.stringify(variants)} WHERE id = ${roleId}`;
      }
      await transaction.$executeRaw`UPDATE our_category_image_templates SET ourTemplateImageId = NULL,
        ourTemplateImageItemMapping = NULL WHERE id = ${roleId} AND ourTemplateImageId = ${sceneId}`;
    }
    await transaction.$executeRaw`DELETE FROM our_template_image_definition_images WHERE definitionId = ${id} AND sceneId = ${sceneId}`;
    for (const scene of scenes) await transaction.$executeRaw`DELETE FROM our_template_images WHERE id = ${scene.id}`;
    await transaction.$executeRaw`UPDATE our_template_image_definitions SET updatedAt = ${new Date()} WHERE id = ${id}`;
  }));
  return { deletedId: sceneId, definitionId: id };
}
