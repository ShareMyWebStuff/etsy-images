const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SKU_DIGITS = 6;
const SKU_MAX_NUMBER = (10 ** SKU_DIGITS) - 1;
const BACKUP_TABLE = 'etsy_listing_skus_backup_20261011';

function formatSku(sequenceNumber) {
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1 || sequenceNumber > SKU_MAX_NUMBER) {
    throw new Error(`The Etsy SKU sequence number must be between 1 and ${SKU_MAX_NUMBER}.`);
  }
  return `SKU_${String(sequenceNumber).padStart(SKU_DIGITS, '0')}`;
}

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    tableName,
  );
  return Number(rows[0]?.count ?? 0) === 1;
}

async function countRows(tableName) {
  const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM \`${tableName}\``);
  return Number(rows[0]?.count ?? 0);
}

async function createVerifiedBackup(listingCount) {
  if (!await tableExists(BACKUP_TABLE)) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`${BACKUP_TABLE}\` (
        \`listingId\` INT NOT NULL,
        \`sku\` VARCHAR(32) NULL,
        \`productsChanged\` BOOLEAN NOT NULL,
        \`lastLocalChangeAt\` DATETIME(3) NOT NULL,
        \`capturedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`listingId\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO \`${BACKUP_TABLE}\` (\`listingId\`, \`sku\`, \`productsChanged\`, \`lastLocalChangeAt\`)
      SELECT listing.id, config.sku, listing.productsChanged, listing.lastLocalChangeAt
      FROM etsy_listings listing
      LEFT JOIN etsy_listing_product_configs config ON config.listingId = listing.id
      ORDER BY listing.id
    `);
  }
  const backupCount = await countRows(BACKUP_TABLE);
  if (backupCount !== listingCount) {
    throw new Error(`SKU backup verification failed: listings=${listingCount}, backup=${backupCount}. No SKUs were changed.`);
  }
  return backupCount;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const listings = await prisma.etsyListing.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, title: true, localDirectoryName: true, productConfig: { select: { sku: true } } },
  });
  if (listings.length > SKU_MAX_NUMBER) throw new Error('The six-digit Etsy SKU sequence has been exhausted.');

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'preview',
    listings: listings.length,
    first: listings[0] ? { listingId: listings[0].id, oldSku: listings[0].productConfig?.sku ?? null, newSku: 'SKU_000001' } : null,
    last: listings.at(-1) ? { listingId: listings.at(-1).id, oldSku: listings.at(-1).productConfig?.sku ?? null, newSku: formatSku(listings.length) } : null,
  }, null, 2));
  if (!apply) {
    console.log('Run with --apply to create the verified backup and assign sequential SKUs.');
    return;
  }

  const backupRows = await createVerifiedBackup(listings.length);
  const changedAt = new Date();
  const changes = await prisma.$transaction(async (tx) => {
    let changed = 0;
    for (const listing of listings) {
      const allocation = await tx.etsySkuAllocation.upsert({
        where: { listingId: listing.id },
        create: { listingId: listing.id },
        update: {},
        select: { sequenceNumber: true },
      });
      const sku = formatSku(allocation.sequenceNumber);
      if (listing.productConfig?.sku !== sku) changed += 1;
      await tx.etsyListingProductConfig.upsert({
        where: { listingId: listing.id },
        create: { listingId: listing.id, sku },
        update: { sku },
      });
      await tx.etsyListing.update({
        where: { id: listing.id },
        data: { productsChanged: true, lastLocalChangeAt: changedAt },
      });
    }
    return changed;
  }, { maxWait: 10_000, timeout: 120_000, isolationLevel: 'Serializable' });

  const [allocations, configs] = await Promise.all([
    prisma.etsySkuAllocation.findMany({ orderBy: { sequenceNumber: 'asc' } }),
    prisma.etsyListingProductConfig.findMany({
      where: { listingId: { in: listings.map(({ id }) => id) } },
      select: { listingId: true, sku: true },
    }),
  ]);
  const allocationByListing = new Map(allocations.map((item) => [item.listingId, formatSku(item.sequenceNumber)]));
  const invalid = configs.filter(({ listingId, sku }) => sku !== allocationByListing.get(listingId));
  if (allocations.length !== listings.length || configs.length !== listings.length || invalid.length > 0) {
    throw new Error(`SKU verification failed after update: listings=${listings.length}, allocations=${allocations.length}, configs=${configs.length}, invalid=${invalid.length}.`);
  }

  console.log(JSON.stringify({
    changedListings: changes,
    verifiedListings: listings.length,
    backupTable: BACKUP_TABLE,
    backupRows,
    nextSku: formatSku(allocations.at(-1).sequenceNumber + 1),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
