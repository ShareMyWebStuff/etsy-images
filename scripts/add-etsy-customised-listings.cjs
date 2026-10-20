const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addColumns(tableName, additions) {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'`);
  const names = new Set(columns.map((column) => column.COLUMN_NAME));
  for (const [name, definition] of additions) {
    if (!names.has(name)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
    }
  }
}

async function addUniqueIndex(tableName, indexName, columns) {
  const indexes = await prisma.$queryRawUnsafe(`
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}' AND INDEX_NAME = '${indexName}'`);
  if (indexes.length === 0) {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columns})`);
  }
}

async function main() {
  await addColumns('etsy_listings', [
    ['etsyCustomisedId', 'VARCHAR(191) NULL'],
    ['etsyCustomisedState', 'VARCHAR(191) NULL'],
    ['etsyCustomisedUrl', 'TEXT NULL'],
    ['etsyCustomisedRawJson', 'JSON NULL'],
    ['etsyCustomisedShopSectionId', 'INT NULL'],
    ['etsyCustomisedLastSyncedAt', 'DATETIME(3) NULL'],
  ]);
  await addUniqueIndex('etsy_listings', 'etsy_listings_etsyCustomisedId_key', 'etsyCustomisedId');

  await addColumns('etsy_listing_images', [
    ['etsyCustomisedImageId', 'VARCHAR(191) NULL'],
  ]);
  await addUniqueIndex(
    'etsy_listing_images',
    'etsy_listing_images_listingId_etsyCustomisedImageId_key',
    'listingId, etsyCustomisedImageId',
  );
  console.log('Customised Etsy listing metadata and image IDs are stored separately.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
