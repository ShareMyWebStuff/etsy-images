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
    'downloadSectionId'
  );
  if (Number(rows[0]?.count ?? 0) === 0) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE etsy_listing_product_configs ADD COLUMN downloadSectionId INT NULL AFTER customiseDigitalDownloads'
    );
    console.log('Added nullable downloadSectionId column.');
  } else {
    console.log('Download section column already exists.');
  }
  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS etsy_download_sections (id INT NOT NULL AUTO_INCREMENT, etsyShopId BIGINT NOT NULL, etsyShopSectionId INT NOT NULL, title VARCHAR(191) NOT NULL, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (id), UNIQUE KEY etsy_download_sections_etsyShopId_etsyShopSectionId_key (etsyShopId, etsyShopSectionId), KEY etsy_download_sections_etsyShopId_idx (etsyShopId))'
  );
  console.log('Download sections table is ready.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
