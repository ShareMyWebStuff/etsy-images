const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    'etsy_listing_product_configs',
    'customiseDigitalDownloads'
  );
  if (Number(rows[0]?.count ?? 0) > 0) {
    console.log('Customise digital downloads column already exists.');
    return;
  }

  await prisma.$executeRawUnsafe(
    'ALTER TABLE etsy_listing_product_configs ADD COLUMN customiseDigitalDownloads BOOLEAN NOT NULL DEFAULT FALSE AFTER customBottom'
  );
  console.log('Added customiseDigitalDownloads with a default of false.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
