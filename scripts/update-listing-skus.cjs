const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SHOP_ID = 66615491n;
const SKU_MAX_LENGTH = 32;
const SECTION_PREFIXES = new Map([
  [1, 'DINOSAUR'],
  [2, 'WOODLAND'],
  [3, 'SET3'],
  [4, 'SET6'],
  [5, 'SET12'],
  [6, 'COMPLETE'],
  [7, 'WOODLAND'],
  [8, 'FARM'],
  [9, 'JUNGLE'],
  [10, 'SEA'],
]);

const cleanSkuPart = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/&/g, ' AND ')
  .replace(/[^A-Z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .replace(/-+/g, '-');

function fitSku(prefix, listingName, suffix = '') {
  const cleanPrefix = cleanSkuPart(prefix);
  const cleanName = cleanSkuPart(listingName) || 'LISTING';
  const ending = suffix ? `-${suffix}` : '';
  const availableNameLength = SKU_MAX_LENGTH - cleanPrefix.length - 1 - ending.length;
  if (availableNameLength < 1) throw new Error(`SKU prefix ${cleanPrefix} is too long.`);
  const fittedName = cleanName.slice(0, availableNameLength).replace(/-+$/g, '') || 'X';
  return `${cleanPrefix}-${fittedName}${ending}`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sections = await prisma.etsyShopSection.findMany({
    where: { OR: [{ etsyShopId: SHOP_ID }, { shop: { etsyShopId: SHOP_ID } }] },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      subSections: {
        select: {
          listings: {
            orderBy: { id: 'asc' },
            select: { id: true, title: true, localDirectoryName: true, productConfig: { select: { sku: true } } },
          },
        },
      },
    },
  });

  const missingMappings = sections.filter(({ id }) => !SECTION_PREFIXES.has(id));
  if (missingMappings.length) {
    throw new Error(`Add SKU prefixes for: ${missingMappings.map(({ id, title }) => `${id} (${title})`).join(', ')}`);
  }

  const used = new Set();
  const changes = [];
  for (const section of sections) {
    const prefix = SECTION_PREFIXES.get(section.id);
    for (const listing of section.subSections.flatMap(({ listings }) => listings)) {
      const listingName = listing.localDirectoryName || listing.title;
      let sku = fitSku(prefix, listingName);
      const collisionAdjusted = used.has(sku);
      if (collisionAdjusted) sku = fitSku(prefix, listingName, String(listing.id));
      let attempt = 2;
      while (used.has(sku)) sku = fitSku(prefix, listingName, `${listing.id}-${attempt++}`);
      used.add(sku);
      changes.push({ listingId: listing.id, sectionId: section.id, oldSku: listing.productConfig?.sku ?? null, sku, collisionAdjusted });
    }
  }

  const overLength = changes.filter(({ sku }) => Array.from(sku).length > SKU_MAX_LENGTH);
  if (overLength.length) throw new Error(`${overLength.length} generated SKUs exceed ${SKU_MAX_LENGTH} characters.`);
  if (new Set(changes.map(({ sku }) => sku)).size !== changes.length) throw new Error('Generated SKUs are not unique.');

  for (const section of sections) {
    const sectionChanges = changes.filter(({ sectionId }) => sectionId === section.id);
    console.log(`${section.title}: ${SECTION_PREFIXES.get(section.id)} (${sectionChanges.length})`);
    console.log(`  ${sectionChanges.slice(0, 3).map(({ sku }) => sku).join(', ')}`);
  }
  const requestedExamples = changes.filter(({ sku }) => sku === 'WOODLAND-ANT' || sku.includes('RHINOCEROSBEETLE'));
  console.log(`Requested examples: ${requestedExamples.map(({ sku }) => sku).join(', ')}`);
  const collisionAdjustments = changes.filter(({ collisionAdjusted }) => collisionAdjusted);
  console.log(`Collision adjustments: ${collisionAdjustments.map(({ sku }) => sku).join(', ') || 'none'}`);
  const changed = changes.filter(({ oldSku, sku }) => oldSku !== sku);
  console.log(`${apply ? 'Applying' : 'Previewed'} ${changed.length} SKU changes (${changes.length} listings total; max ${Math.max(...changes.map(({ sku }) => sku.length))} characters).`);
  if (!apply) {
    console.log('Run with --apply to save these SKUs.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const change of changed) {
      await tx.etsyListingProductConfig.upsert({
        where: { listingId: change.listingId },
        create: { listingId: change.listingId, sku: change.sku },
        update: { sku: change.sku },
      });
      await tx.etsyListing.update({
        where: { id: change.listingId },
        data: { productsChanged: true, lastLocalChangeAt: new Date() },
      });
    }
  }, { timeout: 120000 });
  console.log(`Saved ${changed.length} SKU changes. Etsy will receive them when each listing is next synced.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
