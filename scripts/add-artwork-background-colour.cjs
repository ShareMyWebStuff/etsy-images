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

async function main() {
  if (await hasColumn('our_categories', 'backgroundColour')) {
    console.log('our_categories.backgroundColour already exists.');
  } else {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE our_categories ADD COLUMN backgroundColour VARCHAR(7) NOT NULL DEFAULT '#F5F0E8' AFTER roomTheme",
    );
    console.log('Added our_categories.backgroundColour.');
  }

  if (await hasColumn('etsy_listings', 'backgroundColour')) {
    console.log('etsy_listings.backgroundColour already exists.');
  } else {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE etsy_listings ADD COLUMN backgroundColour VARCHAR(7) NULL AFTER roomTheme',
    );
    console.log('Added etsy_listings.backgroundColour.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
