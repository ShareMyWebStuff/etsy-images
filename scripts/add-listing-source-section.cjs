const { PrismaClient } = require('@prisma/client');

if (process.loadEnvFile) process.loadEnvFile('.env.local');
const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'etsy_listings'
      AND COLUMN_NAME = 'sourceSectionId'
  `);
  if (columns.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE etsy_listings
        ADD COLUMN sourceSectionId INT NULL,
        ADD INDEX etsy_listings_sourceSectionId_idx (sourceSectionId),
        ADD CONSTRAINT etsy_listings_sourceSectionId_fkey
          FOREIGN KEY (sourceSectionId) REFERENCES etsy_shop_sections(id)
          ON DELETE SET NULL ON UPDATE CASCADE
    `);
    console.log('Added nullable listing source-section relationship.');
  } else {
    console.log('Listing source-section relationship already exists.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
