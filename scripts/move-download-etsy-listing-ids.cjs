const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');
const backupTable = 'etsy_listing_ids_backup_20261004';

const targetWhere = `
  listing.etsyPrintId IS NOT NULL
  AND LOWER(CONCAT_WS(' ', section.title, subsection.name)) NOT LIKE '%sea creature%'
`;

async function loadTargets() {
  return prisma.$queryRawUnsafe(`
    SELECT listing.id,
           listing.title,
           listing.etsyPrintId,
           listing.etsyDownloadId,
           section.title AS sectionTitle,
           subsection.name AS subSectionName
      FROM etsy_listings listing
      LEFT JOIN etsy_shop_sub_sections subsection ON subsection.id = listing.subSectionId
      LEFT JOIN etsy_shop_sections section ON section.id = subsection.shopSectionId
     WHERE ${targetWhere}
     ORDER BY listing.id
  `);
}

async function main() {
  const targets = await loadTargets();
  const conflicts = targets.filter((listing) => (
    listing.etsyDownloadId && String(listing.etsyDownloadId) !== String(listing.etsyPrintId)
  ));
  const crossListingConflicts = await prisma.$queryRawUnsafe(`
    SELECT source.id AS sourceId,
           source.etsyPrintId,
           existing.id AS existingId,
           existing.etsyDownloadId
      FROM etsy_listings source
      LEFT JOIN etsy_shop_sub_sections subsection ON subsection.id = source.subSectionId
      LEFT JOIN etsy_shop_sections section ON section.id = subsection.shopSectionId
      JOIN etsy_listings existing
        ON existing.etsyDownloadId = source.etsyPrintId
       AND existing.id <> source.id
     WHERE ${targetWhere.replaceAll('listing.', 'source.')}
  `);
  const bySection = Object.entries(targets.reduce((counts, listing) => {
    const name = listing.sectionTitle ?? '(No section)';
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {}));

  console.log(JSON.stringify({
    dryRun,
    targetCount: targets.length,
    conflicts: conflicts.map(({ id, title, etsyPrintId, etsyDownloadId }) => ({ id, title, etsyPrintId, etsyDownloadId })),
    crossListingConflicts,
    bySection: Object.fromEntries(bySection),
  }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));

  if (dryRun) return;
  if (conflicts.length > 0 || crossListingConflicts.length > 0) {
    throw new Error('The Etsy ID migration was not applied because one or more download IDs would be overwritten.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${backupTable} (
        listingId INT NOT NULL,
        etsyPrintId VARCHAR(191) NULL,
        etsyDownloadId VARCHAR(191) NULL,
        state VARCHAR(191) NULL,
        url TEXT NULL,
        rawJson JSON NULL,
        shopSectionId INT NULL,
        lastSyncedAt DATETIME(3) NULL,
        etsyDownloadState VARCHAR(191) NULL,
        etsyDownloadUrl TEXT NULL,
        etsyDownloadRawJson JSON NULL,
        etsyDownloadShopSectionId INT NULL,
        etsyDownloadLastSyncedAt DATETIME(3) NULL,
        backedUpAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (listingId)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await tx.$executeRawUnsafe(`
      INSERT IGNORE INTO ${backupTable}
        (listingId, etsyPrintId, etsyDownloadId, state, url, rawJson, shopSectionId, lastSyncedAt,
         etsyDownloadState, etsyDownloadUrl, etsyDownloadRawJson, etsyDownloadShopSectionId,
         etsyDownloadLastSyncedAt)
      SELECT id, etsyPrintId, etsyDownloadId, state, url, rawJson, shopSectionId, lastSyncedAt,
             etsyDownloadState, etsyDownloadUrl, etsyDownloadRawJson, etsyDownloadShopSectionId,
             etsyDownloadLastSyncedAt
        FROM etsy_listings
    `);
    const backupRows = await tx.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM ${backupTable}`);
    const listingRows = await tx.$queryRawUnsafe('SELECT COUNT(*) AS count FROM etsy_listings');
    if (Number(backupRows[0]?.count ?? 0) !== Number(listingRows[0]?.count ?? 0)) {
      throw new Error('The Etsy listing ID safety backup is incomplete.');
    }

    await tx.$executeRawUnsafe(`
      UPDATE etsy_listings listing
      LEFT JOIN etsy_shop_sub_sections subsection ON subsection.id = listing.subSectionId
      LEFT JOIN etsy_shop_sections section ON section.id = subsection.shopSectionId
         SET listing.etsyDownloadId = listing.etsyPrintId,
             listing.etsyDownloadState = COALESCE(listing.etsyDownloadState, listing.state),
             listing.etsyDownloadUrl = COALESCE(listing.etsyDownloadUrl, listing.url),
             listing.etsyDownloadRawJson = COALESCE(listing.etsyDownloadRawJson, listing.rawJson),
             listing.etsyDownloadShopSectionId = COALESCE(listing.etsyDownloadShopSectionId, listing.shopSectionId),
             listing.etsyDownloadLastSyncedAt = COALESCE(listing.etsyDownloadLastSyncedAt, listing.lastSyncedAt),
             listing.etsyPrintId = NULL,
             listing.state = 'local',
             listing.url = NULL,
             listing.rawJson = NULL,
             listing.shopSectionId = NULL,
             listing.lastSyncedAt = NULL
       WHERE ${targetWhere}
    `);

    await tx.$executeRawUnsafe(`
      UPDATE etsy_listing_products product
      JOIN etsy_listings listing ON listing.id = product.listingId
         SET product.etsyListingId = CASE
           WHEN product.productType = 'digital' THEN listing.etsyDownloadId
           ELSE listing.etsyPrintId
         END
    `);

    await tx.$executeRawUnsafe(`
      UPDATE etsy_order_items item
      JOIN etsy_listings listing
        ON item.etsyListingId = CAST(listing.etsyPrintId AS UNSIGNED)
        OR item.etsyListingId = CAST(listing.etsyDownloadId AS UNSIGNED)
         SET item.listingId = listing.id
    `);
    await tx.$executeRawUnsafe(`
      UPDATE etsy_order_items item
      JOIN etsy_listing_products product ON BINARY product.sku = BINARY item.sku
         SET item.listingId = product.listingId
       WHERE item.listingId IS NULL
    `);
    await tx.$executeRawUnsafe(`
      UPDATE etsy_order_items item
      JOIN etsy_listing_product_configs config ON BINARY config.sku = BINARY item.sku
         SET item.listingId = config.listingId
       WHERE item.listingId IS NULL
    `);
  }, { timeout: 120000 });

  const remainingTargets = await loadTargets();
  const [idCounts] = await prisma.$queryRawUnsafe(`
    SELECT SUM(etsyPrintId IS NOT NULL) AS printIds,
           SUM(etsyDownloadId IS NOT NULL) AS downloadIds
      FROM etsy_listings
  `);
  const [orderCounts] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS total,
           SUM(listingId IS NOT NULL) AS linked,
           SUM(listingId IS NULL) AS unlinked
      FROM etsy_order_items
  `);
  const remainingPrintListings = await prisma.$queryRawUnsafe(`
    SELECT listing.id, listing.title, listing.etsyPrintId, section.title AS sectionTitle
      FROM etsy_listings listing
      LEFT JOIN etsy_shop_sub_sections subsection ON subsection.id = listing.subSectionId
      LEFT JOIN etsy_shop_sections section ON section.id = subsection.shopSectionId
     WHERE listing.etsyPrintId IS NOT NULL
     ORDER BY listing.id
  `);
  console.log(JSON.stringify({
    migrated: targets.length,
    remainingTargets: remainingTargets.length,
    printIds: Number(idCounts?.printIds ?? 0),
    downloadIds: Number(idCounts?.downloadIds ?? 0),
    remainingPrintListings,
    orderItems: {
      total: Number(orderCounts?.total ?? 0),
      linked: Number(orderCounts?.linked ?? 0),
      unlinked: Number(orderCounts?.unlinked ?? 0),
    },
    backupTable,
  }, null, 2));
  if (remainingTargets.length > 0) throw new Error('Some non-Sea-Creature Etsy IDs were not migrated.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
