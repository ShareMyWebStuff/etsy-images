const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function columnExists(columnName) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    'etsy_listing_product_configs',
    columnName,
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function main() {
  if (!(await columnExists('giftMessageEnabled'))) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE etsy_listing_product_configs ADD COLUMN giftMessageEnabled BOOLEAN NOT NULL DEFAULT FALSE AFTER customisePrints',
    );
    console.log('Added giftMessageEnabled with a default of false for all listings.');
  } else {
    console.log('Gift message setting already exists.');
  }

  if (await columnExists('customiseDigitalDownloads')) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE etsy_listing_product_configs DROP COLUMN customiseDigitalDownloads',
    );
    console.log('Removed the unused customiseDigitalDownloads setting.');
  } else {
    console.log('Customise digital downloads setting is already absent.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
