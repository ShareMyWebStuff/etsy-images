import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { MAX_TEMPLATE_IMAGE_TAGS, type TemplateImageTag } from '@/lib/our-template-image-tag-types';

type TagWriter = Pick<Prisma.TransactionClient, '$executeRaw'>;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export function normalizeTemplateImageTagName(value: unknown) {
  if (typeof value !== 'string') throw new Error('Enter a tag name.');
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name || Array.from(name).length > 100) throw new Error('Enter a tag name of 1 to 100 characters.');
  return { name, normalizedName: name.toLocaleLowerCase('en-GB') };
}

export async function getTemplateImageTags(): Promise<TemplateImageTag[]> {
  return prisma.$queryRaw<TemplateImageTag[]>`
    SELECT id, name FROM our_template_image_tags ORDER BY name ASC, id ASC`;
}

/** A unique normalized name makes simultaneous additions return the same catalogue tag. */
export async function createTemplateImageTag(value: unknown): Promise<TemplateImageTag> {
  const { name, normalizedName } = normalizeTemplateImageTagName(value);
  const id = randomUUID();
  await prisma.$executeRaw`INSERT INTO our_template_image_tags (id, name, normalizedName)
    VALUES (${id}, ${name}, ${normalizedName})
    ON DUPLICATE KEY UPDATE normalizedName = normalizedName`;
  const rows = await prisma.$queryRaw<TemplateImageTag[]>`
    SELECT id, name FROM our_template_image_tags WHERE normalizedName = ${normalizedName} LIMIT 1`;
  if (!rows[0]) throw new Error('The tag could not be saved.');
  return rows[0];
}

export function templateImageTagIdsFromForm(form: FormData): string[] | undefined {
  if (!form.has('tagIds')) return undefined;
  const serialized = form.get('tagIds');
  if (typeof serialized !== 'string' || serialized.length > 4096) throw new Error('The selected template image tags are invalid.');
  let value: unknown;
  try { value = JSON.parse(serialized); }
  catch { throw new Error('The selected template image tags are invalid.'); }
  if (!Array.isArray(value) || value.length > MAX_TEMPLATE_IMAGE_TAGS) throw new Error(`Choose no more than ${MAX_TEMPLATE_IMAGE_TAGS} tags per template image.`);
  const ids = value.map((id) => {
    if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Choose valid template image tags.');
    return id.toLowerCase();
  });
  if (new Set(ids).size !== ids.length) throw new Error('Choose each template image tag only once.');
  return ids;
}

export async function assertTemplateImageTagsExist(ids: string[]) {
  if (!ids.length) return;
  const tags = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM our_template_image_tags WHERE id IN (${Prisma.join(ids)})`);
  const existing = new Set(tags.map(({ id }) => id));
  if (ids.some((id) => !existing.has(id))) throw new Error('A selected tag no longer exists. Refresh the tag list and try again.');
}

export async function getTagsForTemplateImages(ids: string[]): Promise<Map<string, TemplateImageTag[]>> {
  const grouped = new Map<string, TemplateImageTag[]>(ids.map((id) => [id, []]));
  if (!ids.length) return grouped;
  const rows = await prisma.$queryRaw<Array<TemplateImageTag & { templateImageId: string }>>(Prisma.sql`
    SELECT link.templateImageId, tag.id, tag.name
    FROM our_template_image_tag_links link
    INNER JOIN our_template_image_tags tag ON tag.id = link.tagId
    WHERE link.templateImageId IN (${Prisma.join(ids)})
    ORDER BY tag.name ASC, tag.id ASC`);
  for (const { templateImageId, id, name } of rows) grouped.get(templateImageId)?.push({ id, name });
  return grouped;
}

export async function saveTemplateImageTagIds(client: TagWriter, templateImageId: string, ids: string[]) {
  await client.$executeRaw`DELETE FROM our_template_image_tag_links WHERE templateImageId = ${templateImageId}`;
  if (!ids.length) return;
  await client.$executeRaw(Prisma.sql`INSERT INTO our_template_image_tag_links (templateImageId, tagId)
    VALUES ${Prisma.join(ids.map((tagId) => Prisma.sql`(${templateImageId}, ${tagId})`))}`);
}
