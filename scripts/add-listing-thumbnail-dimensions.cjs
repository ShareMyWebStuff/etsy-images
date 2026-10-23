const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function hasColumn(columnName) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    'etsy_listings',
    columnName,
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function addColumn(columnName, sql) {
  if (await hasColumn(columnName)) {
    console.log(`etsy_listings.${columnName} already exists.`);
    return;
  }
  await prisma.$executeRawUnsafe(sql);
  console.log(`Added etsy_listings.${columnName}.`);
}

async function main() {
  await addColumn(
    'thumbnailWidthPixels',
    'ALTER TABLE etsy_listings ADD COLUMN thumbnailWidthPixels INT NULL AFTER thumbnailUpdatedAt',
  );
  await addColumn(
    'thumbnailHeightPixels',
    'ALTER TABLE etsy_listings ADD COLUMN thumbnailHeightPixels INT NULL AFTER thumbnailWidthPixels',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
