const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const listingColumns = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_listings'`);
  const listingNames = new Set(listingColumns.map((column) => column.COLUMN_NAME));
  const additions = [
    ['etsyDownloadState', 'VARCHAR(191) NULL'],
    ['etsyDownloadUrl', 'TEXT NULL'],
    ['etsyDownloadRawJson', 'JSON NULL'],
    ['etsyDownloadShopSectionId', 'INT NULL'],
    ['etsyDownloadLastSyncedAt', 'DATETIME(3) NULL'],
  ];
  for (const [name, definition] of additions) {
    if (!listingNames.has(name)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE etsy_listings ADD COLUMN ${name} ${definition}`);
    }
  }
  const columns = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_listing_images'
      AND COLUMN_NAME = 'etsyDownloadImageId'`);
  if (columns.length === 0) {
    await prisma.$executeRawUnsafe('ALTER TABLE etsy_listing_images ADD COLUMN etsyDownloadImageId VARCHAR(191) NULL');
  }
  const indexes = await prisma.$queryRawUnsafe(`
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_listing_images'
      AND COLUMN_NAME = 'etsyDownloadImageId' AND NON_UNIQUE = 0`);
  if (indexes.length === 0) {
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX etsy_listing_images_listingId_etsyDownloadImageId_key ON etsy_listing_images (listingId, etsyDownloadImageId)');
  }
  console.log('Digital Etsy listing metadata and image IDs are stored separately from print Etsy data.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
