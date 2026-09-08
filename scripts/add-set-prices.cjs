const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const defaultPrices = [
  ['digital_1', 'digital', 349],
  ['digital_3', 'digital', 499],
  ['digital_6', 'digital', 749],
  ['digital_12', 'digital', 999],
  ['digital_complete', 'digital', 1999],
  ['unframed_a4', 'unframed', 1599],
  ['unframed_a3', 'unframed', 1799],
  ['unframed_a2', 'unframed', 2599],
  ['unframed_8x10', 'unframed', 1599],
  ['unframed_11x14', 'unframed', 1999],
  ['unframed_12x16', 'unframed', 2599],
  ['unframed_16x20', 'unframed', 2899],
  ['unframed_18x24', 'unframed', 3599],
  ['unframed_24x36', 'unframed', 4499],
  ['framed_a4', 'framed', 3499],
  ['framed_a3', 'framed', 4499],
  ['framed_a2', 'framed', 6999],
  ['framed_8x10', 'framed', 3499],
  ['framed_11x14', 'framed', 3999],
  ['framed_12x16', 'framed', 4499],
  ['framed_16x20', 'framed', 5999],
  ['framed_18x24', 'framed', 7499],
  ['framed_24x36', 'framed', 10999],
];

async function columnExists(tableName, columnName) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ${tableName}
      AND COLUMN_NAME = ${columnName}
  `;
  return Number(rows[0]?.count ?? 0) > 0;
}

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_product_prices (
      id INT NOT NULL AUTO_INCREMENT,
      productKey VARCHAR(64) NOT NULL,
      category VARCHAR(24) NOT NULL,
      amountPence INT NOT NULL,
      currencyCode VARCHAR(3) NOT NULL DEFAULT 'GBP',
      etsySyncPending BOOLEAN NOT NULL DEFAULT FALSE,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY admin_product_prices_productKey_key (productKey),
      KEY admin_product_prices_category_idx (category)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  if (!await columnExists('admin_product_prices', 'etsySyncPending')) {
    await prisma.$executeRawUnsafe('ALTER TABLE admin_product_prices ADD COLUMN etsySyncPending BOOLEAN NOT NULL DEFAULT FALSE AFTER currencyCode');
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS etsy_listing_price_mappings (
      id INT NOT NULL AUTO_INCREMENT,
      listingId INT NOT NULL,
      productKey VARCHAR(64) NOT NULL,
      etsyProductId VARCHAR(64) NULL,
      etsyOfferingId VARCHAR(64) NULL,
      fulfilmentProvider VARCHAR(64) NULL,
      isSupported BOOLEAN NOT NULL DEFAULT TRUE,
      shippingProfileId VARCHAR(64) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY etsy_listing_price_mappings_productKey_idx (productKey),
      KEY etsy_listing_price_mappings_listingId_idx (listingId),
      CONSTRAINT etsy_listing_price_mappings_listingId_fkey
        FOREIGN KEY (listingId) REFERENCES etsy_listings(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS etsy_price_update_jobs (
      id VARCHAR(36) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'waiting',
      changedPrices JSON NOT NULL,
      total INT NOT NULL DEFAULT 0,
      processed INT NOT NULL DEFAULT 0,
      succeeded INT NOT NULL DEFAULT 0,
      failed INT NOT NULL DEFAULT 0,
      skipped INT NOT NULL DEFAULT 0,
      currentListing VARCHAR(255) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      completedAt DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY etsy_price_update_jobs_status_createdAt_idx (status, createdAt)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS etsy_price_update_items (
      id INT NOT NULL AUTO_INCREMENT,
      jobId VARCHAR(36) NOT NULL,
      listingId INT NOT NULL,
      listingName VARCHAR(255) NOT NULL,
      etsyListingId VARCHAR(64) NOT NULL,
      priceKeys JSON NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'waiting',
      attempts INT NOT NULL DEFAULT 0,
      message TEXT NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY etsy_price_update_items_jobId_listingId_key (jobId, listingId),
      KEY etsy_price_update_items_jobId_status_idx (jobId, status),
      KEY etsy_price_update_items_listingId_idx (listingId),
      CONSTRAINT etsy_price_update_items_jobId_fkey
        FOREIGN KEY (jobId) REFERENCES etsy_price_update_jobs(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT etsy_price_update_items_listingId_fkey
        FOREIGN KEY (listingId) REFERENCES etsy_listings(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  for (const [productKey, category, amountPence] of defaultPrices) {
    await prisma.$executeRaw`
      INSERT IGNORE INTO admin_product_prices
        (productKey, category, amountPence, currencyCode, createdAt, updatedAt)
      VALUES
        (${productKey}, ${category}, ${amountPence}, 'GBP', NOW(3), NOW(3))
    `;
  }

  const rows = await prisma.$queryRaw`SELECT COUNT(*) AS count FROM admin_product_prices`;
  console.log(`Set Prices tables are ready. Product price records: ${String(rows[0]?.count ?? 0)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
