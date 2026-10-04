const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const statements = [
  `CREATE TABLE IF NOT EXISTS etsy_orders (
    id INT NOT NULL AUTO_INCREMENT,
    etsyShopId BIGINT NOT NULL,
    etsyReceiptId BIGINT NOT NULL,
    etsyStatus VARCHAR(50) NULL,
    processingStatus ENUM('UNPROCESSED','BLOCKED','PROCESSING','SUBMITTED','COMPLETED','CANCELED','FAILED','UNKNOWN') NOT NULL DEFAULT 'UNPROCESSED',
    name VARCHAR(255) NULL,
    buyerEmail VARCHAR(320) NULL,
    address1 VARCHAR(500) NULL,
    address2 VARCHAR(500) NULL,
    city VARCHAR(191) NULL,
    state VARCHAR(191) NULL,
    postcode VARCHAR(50) NULL,
    countryIso VARCHAR(2) NULL,
    isPaid BOOLEAN NOT NULL DEFAULT FALSE,
    isShipped BOOLEAN NOT NULL DEFAULT FALSE,
    isCanceled BOOLEAN NOT NULL DEFAULT FALSE,
    isGift BOOLEAN NOT NULL DEFAULT FALSE,
    giftMessage TEXT NULL,
    orderedAt DATETIME(3) NULL,
    updatedAtEtsy DATETIME(3) NULL,
    lastStatusCheckedAt DATETIME(3) NULL,
    printShrimpAttemptedAt DATETIME(3) NULL,
    printShrimpSubmittedAt DATETIME(3) NULL,
    printShrimpOrderId VARCHAR(191) NULL,
    printShrimpPayload JSON NULL,
    printShrimpResponse JSON NULL,
    processError TEXT NULL,
    rawJson JSON NOT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY etsy_orders_shop_receipt_key (etsyShopId, etsyReceiptId),
    KEY etsy_orders_processing_ordered_idx (processingStatus, orderedAt),
    KEY etsy_orders_name_idx (name),
    KEY etsy_orders_postcode_idx (postcode),
    KEY etsy_orders_city_idx (city),
    KEY etsy_orders_email_idx (buyerEmail),
    CONSTRAINT etsy_orders_shop_fkey FOREIGN KEY (etsyShopId) REFERENCES etsy_shops(etsyShopId) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS etsy_order_items (
    id INT NOT NULL AUTO_INCREMENT,
    orderId INT NOT NULL,
    etsyTransactionId BIGINT NOT NULL,
    etsyListingId BIGINT NULL,
    listingId INT NULL,
    sku VARCHAR(100) NULL,
    title VARCHAR(500) NULL,
    quantity INT NOT NULL DEFAULT 1,
    size VARCHAR(30) NULL,
    productType VARCHAR(20) NULL,
    frameColour VARCHAR(30) NULL,
    paperType VARCHAR(30) NULL,
    fontId VARCHAR(50) NULL,
    topText VARCHAR(40) NULL,
    bottomText VARCHAR(40) NULL,
    isCustomised BOOLEAN NOT NULL DEFAULT FALSE,
    artworkUrl TEXT NULL,
    artworkFileName VARCHAR(255) NULL,
    artworkGeneratedAt DATETIME(3) NULL,
    rawJson JSON NOT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY etsy_order_items_order_transaction_key (orderId, etsyTransactionId),
    KEY etsy_order_items_listing_idx (listingId),
    CONSTRAINT etsy_order_items_order_fkey FOREIGN KEY (orderId) REFERENCES etsy_orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT etsy_order_items_listing_fkey FOREIGN KEY (listingId) REFERENCES etsy_listings(id) ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS printshrimp_order_attempts (
    id INT NOT NULL AUTO_INCREMENT,
    orderId INT NOT NULL,
    attemptNumber INT NOT NULL,
    explicitResend BOOLEAN NOT NULL DEFAULT FALSE,
    status ENUM('SUBMITTING','SUBMITTED','FAILED','UNKNOWN') NOT NULL DEFAULT 'SUBMITTING',
    payload JSON NOT NULL,
    response JSON NULL,
    error TEXT NULL,
    attemptedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    completedAt DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY printshrimp_order_attempt_number_key (orderId, attemptNumber),
    KEY printshrimp_order_attempt_status_idx (status, attemptedAt),
    CONSTRAINT printshrimp_order_attempts_order_fkey FOREIGN KEY (orderId) REFERENCES etsy_orders(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS etsy_order_sync_states (
    id INT NOT NULL AUTO_INCREMENT,
    etsyShopId BIGINT NOT NULL,
    lastSuccessfulSyncAt DATETIME(3) NULL,
    syncStartedAt DATETIME(3) NULL,
    lastError TEXT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY etsy_order_sync_states_etsyShopId_key (etsyShopId),
    CONSTRAINT etsy_order_sync_states_shop_fkey FOREIGN KEY (etsyShopId) REFERENCES etsy_shops(etsyShopId) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
];

async function main() {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  console.log('Etsy order workflow tables are ready.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
