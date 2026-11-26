import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { TemplateImageDefinitionMode, TemplateImageVariantSlot } from '@/lib/our-template-image-definition-types';

export type TemplateImageDefinitionRow = { id: string; name: string; mode: TemplateImageDefinitionMode; createdAt: Date | string; updatedAt: Date | string };
export type TemplateImageDefinitionContext = { definitionId: string; mode: TemplateImageDefinitionMode; variantSlot: TemplateImageVariantSlot };

export function templateDefinitionId(value: string) {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) throw new Error('Choose a valid template image definition.');
  return value;
}

export async function getStoredTemplateImageDefinition(id: string): Promise<TemplateImageDefinitionRow> {
  const rows = await prisma.$queryRaw<TemplateImageDefinitionRow[]>`
    SELECT id, name, mode, createdAt, updatedAt FROM our_template_image_definitions WHERE id = ${templateDefinitionId(id)} LIMIT 1`;
  if (!rows[0] || !['no-areas', 'both', 'combined'].includes(rows[0].mode)) throw new Error('Template image definition not found.');
  return rows[0];
}

export async function getSceneDefinitionContexts(ids: string[]) {
  const result = new Map<string, TemplateImageDefinitionContext[]>();
  if (!ids.length) return result;
  const rows = await prisma.$queryRaw<Array<TemplateImageDefinitionContext & { sceneId: string }>>(Prisma.sql`
    SELECT association.sceneId, association.definitionId, association.variantSlot, parent.mode
    FROM our_template_image_definition_images association
    INNER JOIN our_template_image_definitions parent ON parent.id = association.definitionId
    WHERE association.sceneId IN (${Prisma.join(ids)}) ORDER BY parent.createdAt, parent.id`);
  for (const row of rows) {
    if (!ids.includes(row.sceneId) || !['no-areas', 'both', 'combined'].includes(row.mode)
      || !['portrait', 'landscape', 'single'].includes(row.variantSlot)) continue;
    result.set(row.sceneId, [...(result.get(row.sceneId) ?? []), row]);
  }
  return result;
}
