const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs/promises');
const path = require('node:path');

const prisma = new PrismaClient();
const SHOP_ID = 66615491n;
const ROOT = 'D:/Etsy/EtsyListings';
const SPECIAL_SECTIONS = new Map([
  [3, 'Sets of 3'],
  [6, 'Sets of 6'],
  [12, 'Sets of 12'],
  ['all', 'Complete Sets'],
]);

const quote = (name) => `\`${name.replaceAll('`', '``')}\``;

async function exists(target) {
  try { await fs.stat(target); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function moveEntry(source, destination) {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    try {
      await fs.rm(source, { recursive: true });
    } catch (removeError) {
      await fs.rm(destination, { recursive: true, force: true });
      throw removeError;
    }
  }
}

async function refreshSafetyBackup() {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
  );
  const tables = rows.map((row) => row.TABLE_NAME).filter((name) => !name.toLowerCase().endsWith('_bk'));
  await prisma.$transaction(async (tx) => {
    for (const table of tables) {
      const backup = `${table}_bk`;
      await tx.$executeRawUnsafe(`DELETE FROM ${quote(backup)}`);
      await tx.$executeRawUnsafe(`INSERT INTO ${quote(backup)} SELECT * FROM ${quote(table)}`);
    }
  }, { timeout: 120000 });
}

async function ensureSectionColumns() {
  const columns = await prisma.$queryRawUnsafe(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_shop_sections'"
  );
  const names = new Set(columns.map((column) => column.COLUMN_NAME));
  if (!names.has('numberOfDownloads')) {
    await prisma.$executeRawUnsafe('ALTER TABLE etsy_shop_sections ADD COLUMN numberOfDownloads INT NOT NULL DEFAULT 1');
  }
  if (!names.has('includeAllDownloads')) {
    await prisma.$executeRawUnsafe('ALTER TABLE etsy_shop_sections ADD COLUMN includeAllDownloads BOOLEAN NOT NULL DEFAULT false');
  }
}

function classify(subSection) {
  if (subSection.name.toLowerCase() === 'singlelistings') return { title: subSection.sectionTitle, downloads: 1, all: false };
  if (subSection.includeAllDownloads) return { title: SPECIAL_SECTIONS.get('all'), downloads: 1, all: true };
  const title = SPECIAL_SECTIONS.get(subSection.numberOfDownloads);
  if (!title) throw new Error(`No destination rule for subsection ${subSection.name} (${subSection.numberOfDownloads}).`);
  return { title, downloads: subSection.numberOfDownloads, all: false };
}

async function main() {
  const shops = await prisma.$queryRawUnsafe('SELECT id, etsyShopId, shopName, title FROM etsy_shops WHERE etsyShopId = ?', SHOP_ID);
  if (shops.length !== 1) throw new Error('CosyHousePrints shop was not found uniquely.');
  const shop = shops[0];
  const shopName = shop.shopName || shop.title || `Shop ${SHOP_ID}`;
  const sections = await prisma.$queryRawUnsafe(
    'SELECT id, title FROM etsy_shop_sections WHERE shopId = ? OR etsyShopId = ?', shop.id, SHOP_ID
  );
  const subSections = await prisma.$queryRawUnsafe(
    `SELECT ss.id, ss.name, ss.numberOfDownloads, ss.includeAllDownloads, ss.shopSectionId,
            s.title AS sectionTitle
       FROM etsy_shop_sub_sections ss
       JOIN etsy_shop_sections s ON s.id = ss.shopSectionId
      WHERE s.shopId = ? OR s.etsyShopId = ?`, shop.id, SHOP_ID
  );
  const listings = await prisma.$queryRawUnsafe(
    `SELECT l.id, l.subSectionId, l.localDirectoryName, l.title
       FROM etsy_listings l
       JOIN etsy_shop_sub_sections ss ON ss.id = l.subSectionId
       JOIN etsy_shop_sections s ON s.id = ss.shopSectionId
      WHERE s.shopId = ? OR s.etsyShopId = ?`, shop.id, SHOP_ID
  );
  const rules = new Map(subSections.map((subSection) => [subSection.id, classify(subSection)]));
  const shopPath = path.join(ROOT, shopName);
  const moves = [];

  for (const subSection of subSections) {
    const rule = rules.get(subSection.id);
    const sourceDirectory = path.join(shopPath, subSection.sectionTitle, subSection.name);
    if (!(await exists(sourceDirectory))) continue;
    const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const source = path.join(sourceDirectory, entry.name);
      const destination = path.join(shopPath, rule.title, entry.name);
      if (await exists(destination)) throw new Error(`Migration collision: ${destination} already exists.`);
      moves.push({ source, destination });
    }
  }

  for (const listing of listings) {
    const rule = rules.get(listing.subSectionId);
    if (!rule) throw new Error(`Listing ${listing.id} has no migration rule.`);
    if (!listing.localDirectoryName) continue;
    const sourceSubSection = subSections.find((subSection) => subSection.id === listing.subSectionId);
    const source = path.join(shopPath, sourceSubSection.sectionTitle, sourceSubSection.name, listing.localDirectoryName);
    const destination = path.join(shopPath, rule.title, listing.localDirectoryName);
    if (!(await exists(source)) && !(await exists(destination))) {
      throw new Error(`Listing ${listing.id} directory is missing: ${source}`);
    }
  }

  const sectionColumns = await prisma.$queryRawUnsafe(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_shop_sections' AND COLUMN_NAME IN ('numberOfDownloads', 'includeAllDownloads')"
  );
  if (sectionColumns.length === 0) await refreshSafetyBackup();
  await ensureSectionColumns();
  const completedMoves = [];
  try {
    for (const move of moves) {
      await fs.mkdir(path.dirname(move.destination), { recursive: true });
      await moveEntry(move.source, move.destination);
      completedMoves.push(move);
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('UPDATE etsy_shop_sections SET numberOfDownloads = 1, includeAllDownloads = false');

      const destinationSectionIds = new Map(sections.map((section) => [section.title, section.id]));
      for (const [downloadsKey, title] of SPECIAL_SECTIONS) {
        let sectionId = destinationSectionIds.get(title);
        if (!sectionId) {
          const downloads = downloadsKey === 'all' ? 1 : downloadsKey;
          await tx.$executeRawUnsafe(
            `INSERT INTO etsy_shop_sections
              (shopId, etsyShopId, etsyShopSectionId, title, \`rank\`, activeListingCount, rawJson, downloadedAt, updatedAt, numberOfDownloads, includeAllDownloads)
             VALUES (?, ?, NULL, ?, NULL, NULL, NULL, NOW(), NOW(), ?, ?)`,
            shop.id, SHOP_ID, title, downloads, downloadsKey === 'all'
          );
          const inserted = await tx.$queryRawUnsafe('SELECT LAST_INSERT_ID() AS id');
          sectionId = Number(inserted[0].id);
          destinationSectionIds.set(title, sectionId);
        }
        await tx.$executeRawUnsafe(
          'UPDATE etsy_shop_sections SET numberOfDownloads = ?, includeAllDownloads = ? WHERE id = ?',
          downloadsKey === 'all' ? 1 : downloadsKey, downloadsKey === 'all', sectionId
        );
      }

      const destinationSubSectionIds = new Map();
      for (const subSection of subSections) {
        const rule = rules.get(subSection.id);
        const destinationSectionId = destinationSectionIds.get(rule.title);
        let destinationSubSectionId = destinationSubSectionIds.get(destinationSectionId);
        if (!destinationSubSectionId) {
          const preferred = subSections.find((candidate) =>
            candidate.shopSectionId === destinationSectionId && rules.get(candidate.id).title === rule.title
          );
          if (preferred) {
            destinationSubSectionId = preferred.id;
            await tx.$executeRawUnsafe(
              'UPDATE etsy_shop_sub_sections SET shopSectionId = ?, numberOfDownloads = ?, includeAllDownloads = ?, updatedAt = NOW() WHERE id = ?',
              destinationSectionId, rule.all ? null : rule.downloads, rule.all, destinationSubSectionId
            );
          } else {
            await tx.$executeRawUnsafe(
              'INSERT INTO etsy_shop_sub_sections (shopSectionId, name, numberOfDownloads, includeAllDownloads, createdAt, updatedAt) VALUES (?, ?, ?, ?, NOW(), NOW())',
              destinationSectionId, rule.title, rule.all ? null : rule.downloads, rule.all
            );
            const inserted = await tx.$queryRawUnsafe('SELECT LAST_INSERT_ID() AS id');
            destinationSubSectionId = Number(inserted[0].id);
          }
          destinationSubSectionIds.set(destinationSectionId, destinationSubSectionId);
        }

        const movedToNewSection = destinationSectionId !== subSection.shopSectionId;
        await tx.$executeRawUnsafe(
          `UPDATE etsy_listings
              SET subSectionId = ?,
                  shopSectionId = CASE WHEN ? THEN NULL ELSE shopSectionId END,
                  lastLocalChangeAt = CASE WHEN ? THEN NOW() ELSE lastLocalChangeAt END
            WHERE subSectionId = ?`,
          destinationSubSectionId, movedToNewSection, movedToNewSection, subSection.id
        );
      }

      await tx.$executeRawUnsafe(
        `DELETE ss FROM etsy_shop_sub_sections ss
          LEFT JOIN etsy_listings l ON l.subSectionId = ss.id
         WHERE l.id IS NULL
           AND ss.shopSectionId IN (SELECT id FROM etsy_shop_sections WHERE shopId = ? OR etsyShopId = ?)`,
        shop.id, SHOP_ID
      );
    }, { timeout: 120000 });
  } catch (error) {
    for (const move of completedMoves.reverse()) {
      await fs.mkdir(path.dirname(move.source), { recursive: true });
      await moveEntry(move.destination, move.source);
    }
    throw error;
  }

  for (const subSection of subSections) {
    const oldPath = path.join(shopPath, subSection.sectionTitle, subSection.name);
    try { await fs.rmdir(oldPath); } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error?.code)) throw error; }
  }
  console.log(JSON.stringify({ listings: listings.length, filesystemEntriesMoved: moves.length }));
}

main().finally(() => prisma.$disconnect());
