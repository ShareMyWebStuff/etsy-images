const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function hasColumn(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    tableName,
    columnName,
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function addColumn(tableName, columnName, sql) {
  if (await hasColumn(tableName, columnName)) {
    console.log(`${tableName}.${columnName} already exists.`);
    return;
  }
  await prisma.$executeRawUnsafe(sql);
  console.log(`Added ${tableName}.${columnName}.`);
}

async function main() {
  await addColumn(
    'etsy_listings',
    'thumbnailUpdatedAt',
    'ALTER TABLE etsy_listings ADD COLUMN thumbnailUpdatedAt DATETIME(3) NULL AFTER thumbnailOriginalFileName',
  );
  await addColumn(
    'etsy_listing_product_configs',
    'confirmedAt',
    'ALTER TABLE etsy_listing_product_configs ADD COLUMN confirmedAt DATETIME(3) NULL AFTER sku',
  );
  await addColumn(
    'etsy_listing_images',
    'createdAt',
    'ALTER TABLE etsy_listing_images ADD COLUMN createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
  );
  await addColumn(
    'etsy_listing_images',
    'updatedAt',
    'ALTER TABLE etsy_listing_images ADD COLUMN updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
