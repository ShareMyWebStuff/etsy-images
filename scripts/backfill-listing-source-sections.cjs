const { PrismaClient } = require('@prisma/client');

if (process.loadEnvFile) process.loadEnvFile('.env.local');

const prisma = new PrismaClient();
const shouldApply = process.argv.includes('--apply');

async function main() {
  const listings = await prisma.$queryRawUnsafe(`
    SELECT l.id, l.localDirectoryName, l.title, target.title AS targetSection,
           target.numberOfDownloads, target.sourceSectionId AS defaultSourceSectionId,
           defaultSource.title AS defaultSourceSectionName
    FROM etsy_listings l
    INNER JOIN etsy_shop_sub_sections ss ON ss.id = l.subSectionId
    INNER JOIN etsy_shop_sections target ON target.id = ss.shopSectionId
    LEFT JOIN etsy_shop_sections defaultSource ON defaultSource.id = target.sourceSectionId
    WHERE target.numberOfDownloads > 1 OR target.includeAllDownloads = TRUE
    ORDER BY l.id
  `);

  const sourceRows = await prisma.$queryRawUnsafe(`
    SELECT l.id, l.localDirectoryName, source.id AS sourceSectionId, source.title AS sourceSectionName
    FROM etsy_listings l
    INNER JOIN etsy_shop_sub_sections ss ON ss.id = l.subSectionId
    INNER JOIN etsy_shop_sections source ON source.id = ss.shopSectionId
    WHERE source.numberOfDownloads = 1 AND source.includeAllDownloads = FALSE
  `);
  const sourceById = new Map(sourceRows.map((row) => [Number(row.id), row]));

  const dropboxRows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT d.listingId, sourceSection.id AS sourceSectionId, sourceSection.title AS sourceSectionName
    FROM etsy_listing_dropbox_files d
    INNER JOIN etsy_listings sourceListing ON sourceListing.id = d.sourceListingId
    INNER JOIN etsy_shop_sub_sections sourceSubSection ON sourceSubSection.id = sourceListing.subSectionId
    INNER JOIN etsy_shop_sections sourceSection ON sourceSection.id = sourceSubSection.shopSectionId
    WHERE d.sourceListingId IS NOT NULL
  `);
  const dropboxSources = new Map();
  for (const row of dropboxRows) {
    const listingId = Number(row.listingId);
    const values = dropboxSources.get(listingId) ?? new Map();
    values.set(Number(row.sourceSectionId), row.sourceSectionName);
    dropboxSources.set(listingId, values);
  }

  const fileRows = await prisma.$queryRawUnsafe(`
    SELECT listingId, localFileName
    FROM etsy_listing_files
    WHERE localFileName IS NOT NULL
  `);
  const filesByListing = new Map();
  for (const row of fileRows) {
    const listingId = Number(row.listingId);
    const values = filesByListing.get(listingId) ?? [];
    values.push(row.localFileName);
    filesByListing.set(listingId, values);
  }

  const results = [];
  for (const listing of listings) {
    const listingId = Number(listing.id);
    let candidates = dropboxSources.get(listingId) ?? new Map();
    let evidence = candidates.size ? 'stored source listing IDs' : null;

    if (candidates.size === 0) {
      candidates = new Map();
      for (const fileName of filesByListing.get(listingId) ?? []) {
        for (const source of sourceRows) {
          if (fileName.toLocaleLowerCase().startsWith(`${source.localDirectoryName}_`.toLocaleLowerCase())) {
            candidates.set(Number(source.sourceSectionId), source.sourceSectionName);
          }
        }
      }
      if (candidates.size) evidence = 'copied source filenames';
    }

    if (candidates.size === 0 && Number(listing.numberOfDownloads) === 3 && listing.defaultSourceSectionId !== null) {
      candidates.set(Number(listing.defaultSourceSectionId), listing.defaultSourceSectionName);
      evidence = 'legacy three-item section default';
    }

    const match = candidates.size === 1 ? [...candidates.entries()][0] : null;
    results.push({
      listingId,
      listingName: listing.localDirectoryName ?? listing.title,
      targetSection: listing.targetSection,
      sourceSectionId: match?.[0] ?? null,
      sourceSectionName: match?.[1] ?? null,
      evidence,
      ambiguousCandidates: candidates.size > 1 ? [...candidates.values()] : [],
    });
  }

  const resolved = results.filter((result) => result.sourceSectionId !== null);
  const unresolved = results.filter((result) => result.sourceSectionId === null);
  console.log(JSON.stringify({ mode: shouldApply ? 'apply' : 'dry-run', total: results.length, resolved: resolved.length, unresolved: unresolved.length, results }, null, 2));

  if (shouldApply) {
    for (const result of resolved) {
      await prisma.$executeRawUnsafe(
        'UPDATE etsy_listings SET sourceSectionId = ? WHERE id = ? AND sourceSectionId IS NULL',
        result.sourceSectionId,
        result.listingId
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
