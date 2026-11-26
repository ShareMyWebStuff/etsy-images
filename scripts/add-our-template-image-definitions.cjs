const { createHash } = require('node:crypto');

function pairedDefinitionId(portraitId, landscapeId) {
  const hex = createHash('sha256').update(`our-template-image-pair:${portraitId}:${landscapeId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function migrateTemplateImageDefinitions(client) {
  const [character] = await client.$queryRawUnsafe(`SELECT CHARACTER_SET_NAME AS characterSet, COLLATION_NAME AS collationName
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_template_images' AND COLUMN_NAME = 'id'`);
  const charset = character?.characterSet || 'utf8mb4';
  const collation = character?.collationName || 'utf8mb4_unicode_ci';
  if (!/^[a-z0-9_]+$/i.test(charset) || !/^[a-z0-9_]+$/i.test(collation)) throw new Error('The scene table collation is invalid.');
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS our_template_image_definitions (
    id VARCHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, mode VARCHAR(16) NOT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX our_template_image_definitions_createdAt_id_idx (createdAt, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${collation}`);
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS our_template_image_definition_images (
    definitionId VARCHAR(36) NOT NULL, variantSlot VARCHAR(16) NOT NULL, sceneId VARCHAR(36) NOT NULL,
    PRIMARY KEY (definitionId, variantSlot), INDEX our_template_image_definition_images_sceneId_idx (sceneId),
    CONSTRAINT our_template_image_definition_images_definition_fkey FOREIGN KEY (definitionId) REFERENCES our_template_image_definitions(id) ON DELETE CASCADE,
    CONSTRAINT our_template_image_definition_images_scene_fkey FOREIGN KEY (sceneId) REFERENCES our_template_images(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${collation}`);
  for (const [table, column, definition] of [
    ['our_category_image_templates', 'templateImageDefinitionId', 'VARCHAR(36) NULL'],
    ['etsy_listings', 'templateArtworkAssignments', 'JSON NULL'],
  ]) {
    const existing = await client.$queryRawUnsafe('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', table, column);
    if (!existing.length) await client.$executeRawUnsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  const indexes = await client.$queryRawUnsafe(`SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'our_category_image_templates' AND INDEX_NAME = 'our_category_image_templates_templateImageDefinitionId_idx'`);
  if (!indexes.length) await client.$executeRawUnsafe('ALTER TABLE our_category_image_templates ADD INDEX our_category_image_templates_templateImageDefinitionId_idx (templateImageDefinitionId)');

  // DDL is additive. All legacy scene IDs, pixels, masks, tags and old role mappings remain untouched.
  await client.$transaction(async (transaction) => {
    const scenes = await transaction.$queryRawUnsafe('SELECT id, name, definition, createdAt, updatedAt FROM our_template_images ORDER BY id');
    for (const scene of scenes) {
      const links = await transaction.$queryRawUnsafe('SELECT definitionId FROM our_template_image_definition_images WHERE sceneId = ? LIMIT 1', scene.id);
      if (links.length) continue;
      const definition = typeof scene.definition === 'string' ? JSON.parse(scene.definition) : scene.definition;
      // Preserve unusual legacy geometry too; it remains visibly incomplete until edited.
      const orientations = new Set((definition?.openings || []).map((opening) => opening.orientation));
      const slot = orientations.size === 1 && orientations.has('landscape') ? 'landscape' : 'portrait';
      await transaction.$executeRawUnsafe(`INSERT IGNORE INTO our_template_image_definitions (id, name, mode, createdAt, updatedAt) VALUES (?, ?, 'both', ?, ?)`,
        scene.id, scene.name, scene.createdAt, scene.updatedAt);
      await transaction.$executeRawUnsafe('INSERT IGNORE INTO our_template_image_definition_images (definitionId, variantSlot, sceneId) VALUES (?, ?, ?)', scene.id, slot, scene.id);
    }
    const knownSceneIds = new Set(scenes.map((scene) => scene.id));
    const roles = await transaction.$queryRawUnsafe(`SELECT id, name, ourTemplateImageId, orientationVariants, linkedSourceImageTemplateId,
      templateImageDefinitionId FROM our_category_image_templates ORDER BY id`);
    const definitions = new Map(roles.filter((role) => role.templateImageDefinitionId).map((role) => [role.id, role.templateImageDefinitionId]));
    for (const role of roles) {
      if (role.templateImageDefinitionId || role.linkedSourceImageTemplateId) continue;
      const variants = typeof role.orientationVariants === 'string' ? JSON.parse(role.orientationVariants) : role.orientationVariants;
      const portrait = variants?.portrait?.ourTemplateImageId, landscape = variants?.landscape?.ourTemplateImageId;
      let definitionId = null;
      if (portrait && landscape && knownSceneIds.has(portrait) && knownSceneIds.has(landscape)) {
        definitionId = pairedDefinitionId(portrait, landscape);
        await transaction.$executeRawUnsafe(`INSERT IGNORE INTO our_template_image_definitions (id, name, mode) VALUES (?, ?, 'both')`, definitionId, role.name);
        for (const [slot, sceneId] of [['portrait', portrait], ['landscape', landscape]]) {
          await transaction.$executeRawUnsafe('INSERT IGNORE INTO our_template_image_definition_images (definitionId, variantSlot, sceneId) VALUES (?, ?, ?)', definitionId, slot, sceneId);
        }
      } else {
        const sceneId = portrait || landscape || (variants == null ? role.ourTemplateImageId : null);
        if (knownSceneIds.has(sceneId)) definitionId = sceneId;
      }
      if (definitionId) {
        await transaction.$executeRawUnsafe('UPDATE our_category_image_templates SET templateImageDefinitionId = ? WHERE id = ? AND templateImageDefinitionId IS NULL', definitionId, role.id);
        definitions.set(role.id, definitionId);
      }
    }
    for (let depth = 0; depth < roles.length; depth++) {
      let changed = false;
      for (const role of roles) if (!definitions.has(role.id) && definitions.has(role.linkedSourceImageTemplateId)) {
        const definitionId = definitions.get(role.linkedSourceImageTemplateId);
        await transaction.$executeRawUnsafe('UPDATE our_category_image_templates SET templateImageDefinitionId = ? WHERE id = ? AND templateImageDefinitionId IS NULL', definitionId, role.id);
        definitions.set(role.id, definitionId); changed = true;
      }
      if (!changed) break;
    }
  }, { isolationLevel: 'Serializable', timeout: 120000 });
}

module.exports = { migrateTemplateImageDefinitions, pairedDefinitionId };
if (require.main === module) {
  require('@next/env').loadEnvConfig(process.cwd());
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  migrateTemplateImageDefinitions(prisma).then(() => console.log('Template image definitions are ready; existing scenes and role mappings were preserved.'))
    .catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
