const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const quoteIdentifier = (value) => `\`${String(value).replaceAll('`', '``')}\``;

function stableRow(value) {
  return JSON.stringify(value, (_, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (Buffer.isBuffer(item)) return item.toString('base64');
    return item;
  });
}

async function auditLegacyBackupData() {
  const backupTables = await prisma.$queryRawUnsafe(
    `SELECT current_backup.TABLE_NAME
       FROM information_schema.TABLES current_backup
      WHERE current_backup.TABLE_SCHEMA = DATABASE()
        AND current_backup.TABLE_NAME LIKE ?
        AND EXISTS (
          SELECT 1 FROM information_schema.TABLES prior_backup
           WHERE prior_backup.TABLE_SCHEMA = current_backup.TABLE_SCHEMA
             AND prior_backup.TABLE_NAME = CONCAT(
               LEFT(current_backup.TABLE_NAME, CHAR_LENGTH(current_backup.TABLE_NAME) - CHAR_LENGTH('_2026_09_09')),
               '_2026_09_08'
             )
        )
      ORDER BY current_backup.TABLE_NAME`,
    '%_2026_09_09'
  );
  const mismatches = [];
  let rowsChecked = 0;

  for (const { TABLE_NAME: backupTableValue } of backupTables) {
    const backupTable = String(backupTableValue);
    const sourceTable = backupTable.replace(/_2026_09_09$/, '');
    const sourceExists = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      sourceTable
    );
    if (Number(sourceExists[0]?.count ?? 0) !== 1) {
      mismatches.push(`${sourceTable}: source table missing`);
      continue;
    }

    const columns = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      backupTable
    );
    const comparableColumns = columns
      .map(({ COLUMN_NAME }) => String(COLUMN_NAME))
      // The migration deliberately re-categorises existing listings as Giclée Prints.
      .filter((column) => !(sourceTable === 'etsy_listings' && column === 'taxonomyId'));
    const projection = comparableColumns.map(quoteIdentifier).join(', ');
    const [backupRows, sourceRows] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT ${projection} FROM ${quoteIdentifier(backupTable)}`),
      prisma.$queryRawUnsafe(`SELECT ${projection} FROM ${quoteIdentifier(sourceTable)}`),
    ]);
    rowsChecked += backupRows.length;

    const remainingRows = new Map();
    for (const row of sourceRows) {
      const serialized = stableRow(row);
      remainingRows.set(serialized, (remainingRows.get(serialized) ?? 0) + 1);
    }
    let missingRows = 0;
    for (const row of backupRows) {
      const serialized = stableRow(row);
      const count = remainingRows.get(serialized) ?? 0;
      if (count === 0) {
        missingRows += 1;
      } else if (count === 1) {
        remainingRows.delete(serialized);
      } else {
        remainingRows.set(serialized, count - 1);
      }
    }
    if (missingRows > 0) mismatches.push(`${sourceTable}: ${missingRows} prior row(s) missing or changed`);
  }

  return {
    tablesChecked: backupTables.length,
    rowsChecked,
    matches: mismatches.length === 0,
    mismatches,
  };
}

async function main() {
  const [listings, configs, sizes, frames, products, prices, backups, priorBackups, listingBackupRows, legacyAudit] = await Promise.all([
    prisma.etsyListing.findMany({
      select: {
        id: true,
        etsyId: true,
        etsyProductType: true,
        numberOfItems: true,
        includeAllItems: true,
        subSection: {
          select: {
            numberOfDownloads: true,
            includeAllDownloads: true,
          },
        },
      },
    }),
    prisma.etsyListingProductConfig.findMany(),
    prisma.etsyListingSizeOption.findMany(),
    prisma.etsyListingFrameOption.findMany(),
    prisma.etsyListingProduct.findMany({
      select: {
        listingId: true,
        sku: true,
        etsyListingId: true,
      },
    }),
    prisma.adminProductPrice.findMany({
      where: { productKey: { in: ['customisation_fee', 'framed_20x28', 'unframed_20x28'] } },
      select: { productKey: true, amountPence: true },
      orderBy: { productKey: 'asc' },
    }),
    prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?",
      '%_2026_09_09'
    ),
    prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?",
      '%_2026_09_08'
    ),
    prisma.$queryRawUnsafe('SELECT id, etsyId FROM etsy_listings_2026_09_09 ORDER BY id'),
    auditLegacyBackupData(),
  ]);

  const listingEtsyIds = new Map(listings.map((listing) => [listing.id, listing.etsyId]));
  const normalizedSkus = new Set();
  let duplicateSkus = 0;
  let maximumSkuLength = 0;
  let etsyListingIdMismatches = 0;

  for (const product of products) {
    const normalizedSku = product.sku.toLocaleLowerCase();
    if (normalizedSkus.has(normalizedSku)) duplicateSkus += 1;
    normalizedSkus.add(normalizedSku);
    maximumSkuLength = Math.max(maximumSkuLength, Array.from(product.sku).length);
    if ((product.etsyListingId ?? null) !== (listingEtsyIds.get(product.listingId) ?? null)) {
      etsyListingIdMismatches += 1;
    }
  }

  const itemCountInheritanceMismatches = listings.filter((listing) => {
    const subSection = listing.subSection;
    return subSection && (
      listing.includeAllItems !== subSection.includeAllDownloads
      || (!subSection.includeAllDownloads && listing.numberOfItems !== subSection.numberOfDownloads)
    );
  }).length;
  const currentIdentity = listings
    .map((listing) => `${listing.id}:${listing.etsyId ?? ''}`)
    .sort();
  const backupIdentity = listingBackupRows
    .map((listing) => `${listing.id}:${listing.etsyId ?? ''}`)
    .sort();

  console.log(JSON.stringify({
    listings: listings.length,
    listingsWithEtsyId: listings.filter((listing) => listing.etsyId).length,
    nonPhysicalListings: listings.filter((listing) => listing.etsyProductType !== 'physical').length,
    configs: configs.length,
    digitalDownloadEnabled: configs.filter((config) => config.digitalDownload).length,
    customTopDisabled: configs.filter((config) => !config.customTop).length,
    customBottomDisabled: configs.filter((config) => !config.customBottom).length,
    sizeRows: sizes.length,
    disabledSizeRows: sizes.filter((size) => !size.enabled).length,
    frameRows: frames.length,
    enabledFrames: Object.fromEntries(
      ['no_frame', 'black', 'white', 'oak'].map((key) => [
        key,
        frames.filter((frame) => frame.frameKey === key && frame.enabled).length,
      ])
    ),
    products: products.length,
    duplicateSkus,
    maximumSkuLength,
    etsyListingIdMismatches,
    itemCountInheritanceMismatches,
    configuredPrices: Object.fromEntries(prices.map((price) => [price.productKey, price.amountPence])),
    datedBackupTables: Number(backups[0]?.count ?? 0),
    priorDatedBackupTables: Number(priorBackups[0]?.count ?? 0),
    listingIdentityMatchesBackup: JSON.stringify(currentIdentity) === JSON.stringify(backupIdentity),
    legacyBackupTablesChecked: legacyAudit.tablesChecked,
    legacyBackupRowsChecked: legacyAudit.rowsChecked,
    legacyDataMatchesBackup: legacyAudit.matches,
    legacyDataMismatches: legacyAudit.mismatches,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
