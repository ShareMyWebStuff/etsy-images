const fs = require('node:fs');
const databaseLine = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS our_template_images (
    id VARCHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL,
    originalFileName VARCHAR(255) NOT NULL, imagePath VARCHAR(500) NOT NULL,
    whiteImagePath VARCHAR(500) NULL, blackImagePath VARCHAR(500) NULL,
    definition JSON NOT NULL, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX our_template_images_createdAt_id_idx (createdAt, id)
  )`);
  const columns = await prisma.$queryRawUnsafe(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    'our_category_image_templates', 'ourTemplateImageId');
  if (!columns.length) {
    await prisma.$executeRawUnsafe('ALTER TABLE our_category_image_templates ADD COLUMN ourTemplateImageId VARCHAR(36) NULL, ADD INDEX our_category_image_templates_ourTemplateImageId_idx (ourTemplateImageId)');
  }
  const mappings = await prisma.$queryRawUnsafe(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    'our_category_image_templates', 'ourTemplateImageItemMapping');
  if (!mappings.length) await prisma.$executeRawUnsafe('ALTER TABLE our_category_image_templates ADD COLUMN ourTemplateImageItemMapping JSON NULL');
  for (const column of ['listingImagesRevision', 'listingImagesGeneratedRevision']) {
    const existing = await prisma.$queryRawUnsafe(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      'etsy_listings', column);
    if (!existing.length) await prisma.$executeRawUnsafe(`ALTER TABLE etsy_listings ADD COLUMN ${column} INT NOT NULL DEFAULT 0`);
  }
  const imageColumns = await prisma.$queryRawUnsafe(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    'etsy_listing_images', 'templateGenerationRevision');
  if (!imageColumns.length) await prisma.$executeRawUnsafe('ALTER TABLE etsy_listing_images ADD COLUMN templateGenerationRevision INT NOT NULL DEFAULT 0');
  console.log('Our Template Images storage is ready.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
