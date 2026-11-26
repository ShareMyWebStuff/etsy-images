async function migrateTemplateOrientations(client) {
  for (const [table, column, definition] of [
    ['our_categories', 'portraitEnabled', 'BOOLEAN NOT NULL DEFAULT TRUE'],
    ['our_categories', 'landscapeEnabled', 'BOOLEAN NOT NULL DEFAULT TRUE'],
    ['our_category_image_templates', 'orientationVariants', 'JSON NULL'],
  ]) {
    const existing = await client.$queryRawUnsafe(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', table, column);
    if (!existing.length) await client.$executeRawUnsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = { migrateTemplateOrientations };

if (require.main === module) {
  require('@next/env').loadEnvConfig(process.cwd());
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  migrateTemplateOrientations(prisma)
    .then(() => console.log('Template orientation flags and image-role variants are ready.'))
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
