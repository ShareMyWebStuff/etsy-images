const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.$queryRawUnsafe(`
    SELECT current.id AS currentId, backup.id AS backupId
    FROM etsy_listings current
    JOIN etsy_listings_bk backup
      ON backup.shopId = current.shopId
     AND backup.localDirectoryName = current.localDirectoryName
    WHERE current.etsyId IS NULL AND backup.etsyId IS NOT NULL
  `);
  if (candidates.length !== 1) throw new Error(`Expected one lost Etsy link but found ${candidates.length}.`);
  const { currentId, backupId } = candidates[0];

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      UPDATE etsy_listings current
      JOIN etsy_listings_bk backup ON backup.id = ?
      SET current.etsyId = backup.etsyId,
          current.state = backup.state,
          current.url = backup.url,
          current.rawJson = backup.rawJson,
          current.lastSyncedAt = backup.lastSyncedAt,
          current.downloadedAt = backup.downloadedAt
      WHERE current.id = ?
    `, backupId, currentId);
    await tx.$executeRawUnsafe(`
      UPDATE etsy_listing_images current
      JOIN etsy_listing_images_bk backup
        ON backup.listingId = ? AND backup.rank = current.rank
      SET current.etsyImageId = backup.etsyImageId
      WHERE current.listingId = ? AND current.etsyImageId IS NULL AND backup.etsyImageId IS NOT NULL
    `, backupId, currentId);
    await tx.$executeRawUnsafe(`
      UPDATE etsy_listing_files current
      JOIN etsy_listing_files_bk backup
        ON backup.listingId = ? AND backup.localFileName = current.localFileName
      SET current.etsyListingFileId = backup.etsyListingFileId
      WHERE current.listingId = ? AND current.etsyListingFileId IS NULL AND backup.etsyListingFileId IS NOT NULL
    `, backupId, currentId);
    await tx.$executeRawUnsafe(`
      UPDATE etsy_listing_zips current
      JOIN etsy_listing_zips_bk backup
        ON backup.listingId = ? AND backup.zipNumber = current.zipNumber
      SET current.etsyListingFileId = backup.etsyListingFileId
      WHERE current.listingId = ? AND current.etsyListingFileId IS NULL AND backup.etsyListingFileId IS NOT NULL
    `, backupId, currentId);
  });

  const restored = await prisma.etsyListing.findUnique({
    where: { id: Number(currentId) },
    select: { id: true, title: true, etsyId: true, state: true, lastSyncedAt: true },
  });
  console.log(JSON.stringify(restored));
}

main().finally(() => prisma.$disconnect());
