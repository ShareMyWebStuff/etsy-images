const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const checkOnly = process.argv.includes('--check');

async function listingColumns() {
  return prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_listings'
       AND COLUMN_NAME IN ('etsyId', 'etsyPrintId', 'etsyDownloadId')`
  );
}

async function hasUniqueIndex(columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_listings'
       AND COLUMN_NAME = ? AND NON_UNIQUE = 0`,
    columnName
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function uniqueIndexNames(columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_listings'
       AND COLUMN_NAME = ? AND NON_UNIQUE = 0`,
    columnName
  );
  return rows.map((row) => row.INDEX_NAME);
}

async function listingIds(columnName) {
  if (columnName !== 'etsyId' && columnName !== 'etsyPrintId') throw new Error('Unexpected Etsy ID column.');
  return prisma.$queryRawUnsafe(`SELECT id, ${columnName} AS etsyPrintId FROM etsy_listings ORDER BY id`);
}

async function main() {
  const columns = await listingColumns();
  const names = new Set(columns.map((column) => column.COLUMN_NAME));
  const hasOld = names.has('etsyId');
  const hasPrint = names.has('etsyPrintId');
  const hasDownload = names.has('etsyDownloadId');
  if (hasOld === hasPrint) {
    throw new Error('Expected exactly one of etsyId and etsyPrintId; no database changes were made.');
  }

  const currentColumn = hasOld ? 'etsyId' : 'etsyPrintId';
  const before = await listingIds(currentColumn);
  const downloadIdRows = hasDownload
    ? await prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM etsy_listings WHERE etsyDownloadId IS NOT NULL')
    : [];
  let prismaMappingValid = null;
  if (checkOnly && hasPrint && hasDownload) {
    const mapped = await prisma.etsyListing.findMany({
      select: { id: true, etsyId: true, etsyDownloadId: true },
      orderBy: { id: 'asc' },
    });
    prismaMappingValid = mapped.length === before.length
      && mapped.every((listing, index) =>
        listing.id === before[index]?.id && listing.etsyId === before[index]?.etsyPrintId);
    if (!prismaMappingValid) throw new Error('Prisma Etsy ID mapping does not match the database column.');
  }
  console.log(JSON.stringify({
    mode: checkOnly ? 'check' : 'migrate',
    columns,
    listings: before.length,
    linkedListings: before.filter((listing) => listing.etsyPrintId !== null).length,
    linkedDownloadListings: hasDownload ? Number(downloadIdRows[0]?.count ?? 0) : null,
    currentIdIsUnique: await hasUniqueIndex(currentColumn),
    currentIdUniqueIndexes: await uniqueIndexNames(currentColumn),
    downloadIdIsUnique: hasDownload ? await hasUniqueIndex('etsyDownloadId') : false,
    prismaMappingValid,
  }));
  if (checkOnly) return;

  if (!await hasUniqueIndex(currentColumn)) {
    throw new Error('The existing Etsy listing ID is not uniquely indexed; no database changes were made.');
  }

  if (hasOld) {
    await prisma.$executeRawUnsafe('ALTER TABLE etsy_listings RENAME COLUMN etsyId TO etsyPrintId');
  }
  if (!hasDownload) {
    await prisma.$executeRawUnsafe('ALTER TABLE etsy_listings ADD COLUMN etsyDownloadId VARCHAR(191) NULL');
  }
  if (!await hasUniqueIndex('etsyDownloadId')) {
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX etsy_listings_etsyDownloadId_key ON etsy_listings (etsyDownloadId)');
  }

  const after = await listingIds('etsyPrintId');
  if (before.length !== after.length || before.some((listing, index) =>
    listing.id !== after[index]?.id || listing.etsyPrintId !== after[index]?.etsyPrintId)) {
    throw new Error('Etsy listing ID verification failed after migration.');
  }
  const finalColumns = await listingColumns();
  const finalNames = new Set(finalColumns.map((column) => column.COLUMN_NAME));
  if (finalNames.has('etsyId') || !finalNames.has('etsyPrintId') || !finalNames.has('etsyDownloadId')) {
    throw new Error('The expected Etsy listing ID columns were not found after migration.');
  }
  console.log(`Preserved ${after.length} listing rows and all existing Etsy IDs; etsyDownloadId is nullable.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
