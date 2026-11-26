import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
const { migrateTemplateImageDefinitions, pairedDefinitionId } = createRequire(import.meta.url)('../scripts/add-our-template-image-definitions.cjs') as {
  migrateTemplateImageDefinitions: (client: unknown) => Promise<void>; pairedDefinitionId: (portrait: string, landscape: string) => string;
};
it('preserves scene IDs, geometry and paired-role mappings while repeatably adding canonical and shared-pair definitions', async () => {
  const portrait = '10000000-0000-4000-8000-000000000001', landscape = '10000000-0000-4000-8000-000000000002';
  const scenes = [portrait, landscape].map((id, index) => ({ id, name: index ? 'Landscape room' : 'Portrait room', createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'), definition: { openings: [{ orientation: index ? 'landscape' : 'portrait', imageItemNumber: 1 }], foregroundMask: { strokes: ['original mask'] } } }));
  const variants = JSON.stringify({ portrait: { ourTemplateImageId: portrait, itemMapping: { 1: 2 } }, landscape: { ourTemplateImageId: landscape, itemMapping: { 1: 3 } } });
  const roles = [
    { id: 1, name: 'Legacy room', ourTemplateImageId: portrait, orientationVariants: null, linkedSourceImageTemplateId: null, templateImageDefinitionId: null as string | null },
    { id: 2, name: 'Paired room', ourTemplateImageId: null, orientationVariants: variants, linkedSourceImageTemplateId: null, templateImageDefinitionId: null as string | null },
    { id: 3, name: 'Same pair', ourTemplateImageId: null, orientationVariants: variants, linkedSourceImageTemplateId: null, templateImageDefinitionId: null as string | null },
    { id: 4, name: 'Linked pair', ourTemplateImageId: null, orientationVariants: null, linkedSourceImageTemplateId: 2, templateImageDefinitionId: null as string | null },
    { id: 5, name: 'Generic instructions', ourTemplateImageId: null, orientationVariants: null, linkedSourceImageTemplateId: null, templateImageDefinitionId: null as string | null },
    { id: 6, name: 'Same source in both slots', ourTemplateImageId: null, orientationVariants: JSON.stringify({ portrait: { ourTemplateImageId: portrait },
      landscape: { ourTemplateImageId: portrait } }), linkedSourceImageTemplateId: null, templateImageDefinitionId: null as string | null },
  ];
  const originalScenes = structuredClone(scenes), originalRoles = structuredClone(roles), columns = new Set<string>(), parents = new Map<string, string>();
  let indexed = false; const links: Array<{ definitionId: string; variantSlot: string; sceneId: string }> = [];
  const query = vi.fn(async (sql: string, ...values: unknown[]) => {
    if (sql.includes('CHARACTER_SET_NAME')) return [{ characterSet: 'utf8mb4', collationName: 'utf8mb4_unicode_ci' }];
    if (sql.includes('information_schema.COLUMNS')) return columns.has(`${values[0]}.${values[1]}`) ? [{}] : [];
    if (sql.includes('information_schema.STATISTICS')) return indexed ? [{}] : [];
    if (sql.includes('FROM our_template_images')) return scenes;
    if (sql.includes('FROM our_category_image_templates')) return roles;
    if (sql.includes('FROM our_template_image_definition_images')) return links.filter((link) => link.sceneId === values[0]);
    throw new Error(`Unexpected migration query: ${sql}`);
  });
  const execute = vi.fn(async (sql: string, ...values: unknown[]) => {
    if (sql.startsWith('ALTER TABLE')) {
      const column = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(sql); if (column) columns.add(`${column[1]}.${column[2]}`); else indexed = true;
    } else if (sql.startsWith('INSERT IGNORE INTO our_template_image_definitions')) parents.set(String(values[0]), parents.get(String(values[0])) ?? String(values[1]));
    else if (sql.startsWith('INSERT IGNORE INTO our_template_image_definition_images')) {
      if (!links.some((link) => link.definitionId === values[0] && link.variantSlot === values[1])) links.push({ definitionId: String(values[0]), variantSlot: String(values[1]), sceneId: String(values[2]) });
    } else if (sql.startsWith('UPDATE our_category_image_templates')) roles.find((role) => role.id === values[1])!.templateImageDefinitionId = String(values[0]);
    return 1;
  });
  const client = { $queryRawUnsafe: query, $executeRawUnsafe: execute, $transaction: vi.fn(async (operation) => operation({ $queryRawUnsafe: query, $executeRawUnsafe: execute })) };
  await migrateTemplateImageDefinitions(client); await migrateTemplateImageDefinitions(client);
  expect(scenes).toEqual(originalScenes); expect(parents.size).toBe(4); expect(links).toHaveLength(6);
  expect(links).toContainEqual({ definitionId: portrait, variantSlot: 'portrait', sceneId: portrait });
  expect(links).toContainEqual({ definitionId: landscape, variantSlot: 'landscape', sceneId: landscape });
  const pairId = pairedDefinitionId(portrait, landscape);
  const samePairId = pairedDefinitionId(portrait, portrait);
  expect(roles.map((role) => role.templateImageDefinitionId)).toEqual([portrait, pairId, pairId, pairId, null, samePairId]);
  expect(links).toContainEqual({ definitionId: samePairId, variantSlot: 'portrait', sceneId: portrait });
  expect(links).toContainEqual({ definitionId: samePairId, variantSlot: 'landscape', sceneId: portrait });
  expect(roles.map(({ templateImageDefinitionId: _added, ...role }) => role)).toEqual(originalRoles.map(({ templateImageDefinitionId: _added, ...role }) => role));
  expect(execute.mock.calls.filter(([sql]) => sql.startsWith('ALTER TABLE'))).toHaveLength(3);
  expect(execute.mock.calls.some(([sql]) => /^\s*(?:DELETE|DROP |TRUNCATE |UPDATE our_template_images)/.test(sql))).toBe(false);
  expect(execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT IGNORE INTO our_template_image_definitions')).every(([sql]) => sql.includes("'both'"))).toBe(true);
});
