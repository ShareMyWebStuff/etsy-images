const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKUP_SUFFIX = '_2026_09_09';
const SKU_MAX_LENGTH = 32;
const SIZES = [
  ['a4', 'A4'],
  ['a3', 'A3'],
  ['a2', 'A2'],
  ['8x10', '8X10'],
  ['11x14', '11X14'],
  ['12x16', '12X16'],
  ['16x20', '16X20'],
  ['18x24', '18X24'],
  ['20x28', '20X28'],
  ['24x36', '24X36'],
];
const FRAMES = [
  ['no_frame', false],
  ['black', true],
  ['white', true],
  ['oak', true],
];

const quote = (name) => `\`${String(name).replaceAll('`', '``')}\``;

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    tableName
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function columnExists(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    tableName,
    columnName
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function tableRowCount(tableName) {
  const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM ${quote(tableName)}`);
  return Number(rows[0]?.count ?? 0);
}

async function tableColumns(tableName) {
  return prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME, COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    tableName
  );
}

async function tablePrimaryKeyColumns(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION`,
    tableName
  );
  return rows.map((row) => String(row.COLUMN_NAME));
}

async function verifySafetyBackup(source, backup, requireSameCount) {
  const [sourceCount, backupCount, sourceColumns, backupColumns, sourcePrimaryKey, backupPrimaryKey] = await Promise.all([
    tableRowCount(source),
    tableRowCount(backup),
    tableColumns(source),
    tableColumns(backup),
    tablePrimaryKeyColumns(source),
    tablePrimaryKeyColumns(backup),
  ]);
  if (backupCount > sourceCount || (requireSameCount && backupCount !== sourceCount)) {
    throw new Error(`Safety backup row count mismatch for ${source}: source=${sourceCount}, backup=${backupCount}.`);
  }

  const sourceColumnTypes = new Map(sourceColumns.map((column) => [
    String(column.COLUMN_NAME),
    String(column.COLUMN_TYPE).toLowerCase(),
  ]));
  for (const column of backupColumns) {
    const name = String(column.COLUMN_NAME);
    if (sourceColumnTypes.get(name) !== String(column.COLUMN_TYPE).toLowerCase()) {
      throw new Error(`Safety backup schema mismatch for ${source}.${name}.`);
    }
  }
  if (backupColumns.length === 0) throw new Error(`Safety backup ${backup} has no columns.`);
  if (JSON.stringify(sourcePrimaryKey) !== JSON.stringify(backupPrimaryKey)) {
    throw new Error(`Safety backup primary key mismatch for ${source}.`);
  }

  if (backupPrimaryKey.length > 0 && backupCount > 0) {
    const join = backupPrimaryKey
      .map((column) => `src.${quote(column)} = bak.${quote(column)}`)
      .join(' AND ');
    const missingRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
        FROM ${quote(backup)} bak
        LEFT JOIN ${quote(source)} src ON ${join}
       WHERE src.${quote(backupPrimaryKey[0])} IS NULL
    `);
    if (Number(missingRows[0]?.count ?? 0) > 0) {
      throw new Error(`Safety backup row identity mismatch for ${source}.`);
    }
  }
}

async function createSafetyBackups() {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
  );
  const sourceTables = rows
    .map((row) => String(row.TABLE_NAME))
    .filter((name) => !/_bk$/i.test(name) && !/_\d{4}_\d{2}_\d{2}$/i.test(name));
  let created = 0;
  for (const source of sourceTables) {
    const backup = `${source}${BACKUP_SUFFIX}`;
    const backupAlreadyExists = await tableExists(backup);
    if (!backupAlreadyExists) {
      await prisma.$executeRawUnsafe(`CREATE TABLE ${quote(backup)} LIKE ${quote(source)}`);
      await prisma.$executeRawUnsafe(`INSERT INTO ${quote(backup)} SELECT * FROM ${quote(source)}`);
      created += 1;
    }
    // New copies must be exact. On later safe retries, the source may contain
    // rows appended by this migration, but every backed-up row and key must
    // still be present and the copied schema must remain compatible.
    await verifySafetyBackup(source, backup, !backupAlreadyExists);
  }
  return { sourceTables: sourceTables.length, created, verified: sourceTables.length };
}

async function addColumn(columnName, definition) {
  if (!await columnExists('etsy_listings', columnName)) {
    await prisma.$executeRawUnsafe(`ALTER TABLE etsy_listings ADD COLUMN ${quote(columnName)} ${definition}`);
    return true;
  }
  return false;
}

async function ensureSchema() {
  const firstRun = !await columnExists('etsy_listings', 'etsyProductType');

  await addColumn('productsChanged', 'BOOLEAN NOT NULL DEFAULT FALSE');
  const numberOfItemsAdded = await addColumn('numberOfItems', 'INT NULL DEFAULT 1');
  await addColumn('includeAllItems', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await addColumn('etsyProductType', "VARCHAR(16) NOT NULL DEFAULT 'physical'");
  const downloadsRevisionAdded = await addColumn('downloadsRevision', 'INT NOT NULL DEFAULT 0');
  await addColumn('zippedRevision', 'INT NOT NULL DEFAULT 0');
  await addColumn('hasEverZipped', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await addColumn('dropboxRevision', 'INT NOT NULL DEFAULT 0');
  await addColumn('dropboxSyncedAt', 'DATETIME(3) NULL');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS etsy_listing_product_configs (
      id INT NOT NULL AUTO_INCREMENT,
      listingId INT NOT NULL,
      listOnEtsy BOOLEAN NOT NULL DEFAULT TRUE,
      digitalDownload BOOLEAN NOT NULL DEFAULT FALSE,
      customTop BOOLEAN NOT NULL DEFAULT TRUE,
      customBottom BOOLEAN NOT NULL DEFAULT TRUE,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY etsy_listing_product_configs_listingId_key (listingId),
      CONSTRAINT etsy_listing_product_configs_listingId_fkey
        FOREIGN KEY (listingId) REFERENCES etsy_listings(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS etsy_listing_size_options (
      id INT NOT NULL AUTO_INCREMENT,
      listingId INT NOT NULL,
      sizeKey VARCHAR(16) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      position INT NOT NULL DEFAULT 0,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY etsy_listing_size_options_listingId_sizeKey_key (listingId, sizeKey),
      KEY etsy_listing_size_options_listingId_position_idx (listingId, position),
      CONSTRAINT etsy_listing_size_options_listingId_fkey
        FOREIGN KEY (listingId) REFERENCES etsy_listings(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS etsy_listing_frame_options (
      id INT NOT NULL AUTO_INCREMENT,
      listingId INT NOT NULL,
      frameKey VARCHAR(16) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      position INT NOT NULL DEFAULT 0,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY etsy_listing_frame_options_listingId_frameKey_key (listingId, frameKey),
      KEY etsy_listing_frame_options_listingId_position_idx (listingId, position),
      CONSTRAINT etsy_listing_frame_options_listingId_fkey
        FOREIGN KEY (listingId) REFERENCES etsy_listings(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS etsy_listing_products (
      id INT NOT NULL AUTO_INCREMENT,
      listingId INT NOT NULL,
      productKey VARCHAR(64) NOT NULL,
      productType VARCHAR(16) NOT NULL,
      sizeKey VARCHAR(16) NULL,
      frameKey VARCHAR(16) NULL,
      sku VARCHAR(32) NOT NULL,
      priceKey VARCHAR(64) NOT NULL,
      position INT NOT NULL DEFAULT 0,
      etsyListingId VARCHAR(64) NULL,
      etsyProductId VARCHAR(64) NULL,
      etsyOfferingId VARCHAR(64) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY etsy_listing_products_sku_key (sku),
      UNIQUE KEY etsy_listing_products_listingId_productKey_key (listingId, productKey),
      KEY etsy_listing_products_listingId_position_idx (listingId, position),
      KEY etsy_listing_products_priceKey_idx (priceKey),
      CONSTRAINT etsy_listing_products_listingId_fkey
        FOREIGN KEY (listingId) REFERENCES etsy_listings(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  return { firstRun, numberOfItemsAdded, downloadsRevisionAdded };
}

function subjectCode(value, listingId) {
  const words = String(value || '')
    .toUpperCase()
    .match(/[A-Z0-9]+/g) || [];
  const useful = words.filter((word) => !['LISTING', 'PRINT', 'ART', 'WALL'].includes(word));
  return (useful.join('-') || `ITEM-${listingId}`).slice(0, 14);
}

function uniqueSku(base, used) {
  let candidate = base.slice(0, SKU_MAX_LENGTH);
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = `-${counter}`;
    candidate = `${base.slice(0, SKU_MAX_LENGTH - suffix.length)}${suffix}`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function digitalPriceKey(listing) {
  if (Boolean(listing.includeAllItems)) return 'digital_complete';
  if (Number(listing.numberOfItems) === 3) return 'digital_3';
  if (Number(listing.numberOfItems) === 6) return 'digital_6';
  if (Number(listing.numberOfItems) === 12) return 'digital_12';
  return 'digital_1';
}

function desiredProductsForListing(listing, config, sizeOptions, frameOptions) {
  const products = [];
  let position = 0;
  if (Boolean(config.digitalDownload)) {
    products.push({
      productKey: 'digital',
      productType: 'digital',
      sizeKey: null,
      frameKey: null,
      priceKey: digitalPriceKey(listing),
      position: position++,
      skuPart: 'DG',
    });
  }

  const framed = ['black', 'white', 'oak'].some((key) => Boolean(frameOptions.get(key)));
  for (const [sizeKey, sizeSku] of SIZES) {
    if (!Boolean(sizeOptions.get(sizeKey))) continue;
    if (Boolean(frameOptions.get('no_frame'))) {
      products.push({
        productKey: `unframed_${sizeKey}`,
        productType: 'physical',
        sizeKey,
        frameKey: 'no_frame',
        priceKey: `unframed_${sizeKey}`,
        position: position++,
        skuPart: `UF-${sizeSku}`,
      });
    }
    if (framed) {
      products.push({
        productKey: `framed_${sizeKey}`,
        productType: 'physical',
        sizeKey,
        frameKey: 'frame',
        priceKey: `framed_${sizeKey}`,
        position: position++,
        skuPart: `FR-${sizeSku}`,
      });
    }
  }
  return products;
}

function addListingOption(map, row, keyName) {
  const listingId = Number(row.listingId);
  const options = map.get(listingId) ?? new Map();
  options.set(String(row[keyName]), Boolean(row.enabled));
  map.set(listingId, options);
}

async function verifyConfigurationBackfill() {
  const missingConfigs = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS count
      FROM etsy_listings listing
     WHERE NOT EXISTS (
       SELECT 1 FROM etsy_listing_product_configs config WHERE config.listingId = listing.id
     )
  `);
  if (Number(missingConfigs[0]?.count ?? 0) !== 0) {
    throw new Error('Unable to backfill an Etsy product configuration for every listing.');
  }
  for (const [sizeKey] of SIZES) {
    const missing = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
        FROM etsy_listings listing
       WHERE NOT EXISTS (
         SELECT 1 FROM etsy_listing_size_options sizeOption
          WHERE sizeOption.listingId = listing.id AND sizeOption.sizeKey = ?
       )
    `, sizeKey);
    if (Number(missing[0]?.count ?? 0) !== 0) {
      throw new Error(`Unable to backfill size option ${sizeKey} for every listing.`);
    }
  }
  for (const [frameKey] of FRAMES) {
    const missing = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
        FROM etsy_listings listing
       WHERE NOT EXISTS (
         SELECT 1 FROM etsy_listing_frame_options frameOption
          WHERE frameOption.listingId = listing.id AND frameOption.frameKey = ?
       )
    `, frameKey);
    if (Number(missing[0]?.count ?? 0) !== 0) {
      throw new Error(`Unable to backfill frame option ${frameKey} for every listing.`);
    }
  }
}

async function backfillMissingProducts() {
  const [listings, configs, sizeRows, frameRows, existingProducts] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT id, etsyPrintId AS etsyId, title, localDirectoryName, numberOfItems, includeAllItems
        FROM etsy_listings
       ORDER BY id
    `),
    prisma.$queryRawUnsafe('SELECT listingId, digitalDownload FROM etsy_listing_product_configs'),
    prisma.$queryRawUnsafe('SELECT listingId, sizeKey, enabled FROM etsy_listing_size_options'),
    prisma.$queryRawUnsafe('SELECT listingId, frameKey, enabled FROM etsy_listing_frame_options'),
    prisma.$queryRawUnsafe('SELECT listingId, productKey, sku FROM etsy_listing_products'),
  ]);
  const configByListing = new Map(configs.map((config) => [Number(config.listingId), config]));
  const sizesByListing = new Map();
  const framesByListing = new Map();
  sizeRows.forEach((row) => addListingOption(sizesByListing, row, 'sizeKey'));
  frameRows.forEach((row) => addListingOption(framesByListing, row, 'frameKey'));
  const existingKeysByListing = new Map();
  const usedSkus = new Set();
  for (const product of existingProducts) {
    const listingId = Number(product.listingId);
    const keys = existingKeysByListing.get(listingId) ?? new Set();
    keys.add(String(product.productKey));
    existingKeysByListing.set(listingId, keys);
    usedSkus.add(String(product.sku).toLowerCase());
  }

  const requiredKeysByListing = new Map();
  let inserted = 0;
  await prisma.$transaction(async (tx) => {
    for (const listing of listings) {
      const listingId = Number(listing.id);
      const config = configByListing.get(listingId);
      if (!config) throw new Error(`Listing ${listingId} is missing its Etsy product configuration.`);
      const desired = desiredProductsForListing(
        listing,
        config,
        sizesByListing.get(listingId) ?? new Map(),
        framesByListing.get(listingId) ?? new Map(),
      );
      requiredKeysByListing.set(listingId, new Set(desired.map(({ productKey }) => productKey)));
      const existingKeys = existingKeysByListing.get(listingId) ?? new Set();
      const code = subjectCode(listing.localDirectoryName || listing.title, listingId);
      for (const product of desired) {
        if (existingKeys.has(product.productKey)) continue;
        const sku = uniqueSku(`${product.skuPart}-${code}-${listingId}`, usedSkus);
        await tx.$executeRawUnsafe(`
          INSERT INTO etsy_listing_products
            (listingId, productKey, productType, sizeKey, frameKey, sku, priceKey, position,
             etsyListingId, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
        `,
        listingId,
        product.productKey,
        product.productType,
        product.sizeKey,
        product.frameKey,
        sku,
        product.priceKey,
        product.position,
        listing.etsyId);
        existingKeys.add(product.productKey);
        inserted += 1;
      }
      existingKeysByListing.set(listingId, existingKeys);
    }
  }, { timeout: 120000 });

  const persistedProducts = await prisma.$queryRawUnsafe(
    'SELECT listingId, productKey FROM etsy_listing_products'
  );
  const persistedKeysByListing = new Map();
  for (const product of persistedProducts) {
    const listingId = Number(product.listingId);
    const keys = persistedKeysByListing.get(listingId) ?? new Set();
    keys.add(String(product.productKey));
    persistedKeysByListing.set(listingId, keys);
  }
  for (const [listingId, requiredKeys] of requiredKeysByListing) {
    const persistedKeys = persistedKeysByListing.get(listingId) ?? new Set();
    for (const productKey of requiredKeys) {
      if (!persistedKeys.has(productKey)) {
        throw new Error(`Unable to backfill product ${productKey} for listing ${listingId}.`);
      }
    }
  }
  return inserted;
}

async function seedDefaults(state) {
  if (state.numberOfItemsAdded) {
    await prisma.$executeRawUnsafe(`
      UPDATE etsy_listings l
      LEFT JOIN etsy_shop_sub_sections ss ON ss.id = l.subSectionId
      LEFT JOIN etsy_shop_sections s ON s.id = ss.shopSectionId
      SET l.includeAllItems = COALESCE(ss.includeAllDownloads, s.includeAllDownloads, FALSE),
          l.numberOfItems = CASE
            WHEN COALESCE(ss.includeAllDownloads, s.includeAllDownloads, FALSE) THEN NULL
            ELSE COALESCE(ss.numberOfDownloads, s.numberOfDownloads, 1)
          END
    `);
  }
  if (state.firstRun) {
    await prisma.$executeRawUnsafe(`
      UPDATE etsy_listings
      SET etsyProductType = 'physical',
          taxonomyId = 121,
          productsChanged = CASE WHEN etsyPrintId IS NULL THEN productsChanged ELSE TRUE END
    `);
  }
  if (state.downloadsRevisionAdded) {
    await prisma.$executeRawUnsafe(`
      UPDATE etsy_listings l
      SET downloadsRevision = CASE WHEN EXISTS (
            SELECT 1 FROM etsy_listing_files f WHERE f.listingId = l.id
          ) OR EXISTS (
            SELECT 1 FROM etsy_listing_dropbox_files df WHERE df.listingId = l.id
          ) THEN 1 ELSE 0 END,
          zippedRevision = CASE WHEN EXISTS (
            SELECT 1 FROM etsy_listing_zips z WHERE z.listingId = l.id
          ) OR EXISTS (
            SELECT 1 FROM etsy_listing_dropbox_bundles db WHERE db.listingId = l.id
          ) THEN 1 ELSE 0 END,
          hasEverZipped = CASE WHEN EXISTS (
            SELECT 1 FROM etsy_listing_zips z WHERE z.listingId = l.id
          ) OR EXISTS (
            SELECT 1 FROM etsy_listing_dropbox_bundles db WHERE db.listingId = l.id
          ) THEN TRUE ELSE FALSE END,
          dropboxRevision = CASE WHEN EXISTS (
            SELECT 1 FROM etsy_listing_dropbox_bundles db WHERE db.listingId = l.id
          ) THEN 1 ELSE 0 END,
          dropboxSyncedAt = (
            SELECT db.updatedAt FROM etsy_listing_dropbox_bundles db WHERE db.listingId = l.id LIMIT 1
          )
    `);
  }

  await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO etsy_listing_product_configs
      (listingId, listOnEtsy, digitalDownload, customTop, customBottom, createdAt, updatedAt)
    SELECT id, TRUE, etsyProductType = 'digital', TRUE, TRUE, NOW(3), NOW(3) FROM etsy_listings
  `);
  for (let position = 0; position < SIZES.length; position += 1) {
    const [sizeKey] = SIZES[position];
    await prisma.$executeRawUnsafe(`
      INSERT IGNORE INTO etsy_listing_size_options
        (listingId, sizeKey, enabled, position, createdAt, updatedAt)
      SELECT id, ?, TRUE, ?, NOW(3), NOW(3) FROM etsy_listings
    `, sizeKey, position);
  }
  for (let position = 0; position < FRAMES.length; position += 1) {
    const [frameKey, enabled] = FRAMES[position];
    await prisma.$executeRawUnsafe(`
      INSERT IGNORE INTO etsy_listing_frame_options
        (listingId, frameKey, enabled, position, createdAt, updatedAt)
      SELECT id, ?, IF(etsyProductType = 'digital', FALSE, ?), ?, NOW(3), NOW(3) FROM etsy_listings
    `, frameKey, enabled, position);
  }

  await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO admin_product_prices
      (productKey, category, amountPence, currencyCode, etsySyncPending, createdAt, updatedAt)
    VALUES
      ('unframed_20x28', 'unframed', 3999, 'GBP', FALSE, NOW(3), NOW(3)),
      ('framed_20x28', 'framed', 8499, 'GBP', FALSE, NOW(3), NOW(3))
  `);
  await verifyConfigurationBackfill();
  return { productsInserted: await backfillMissingProducts() };
}

async function main() {
  const beforeListings = await prisma.$queryRawUnsafe('SELECT id, etsyPrintId AS etsyId FROM etsy_listings ORDER BY id');
  const backups = await createSafetyBackups();
  const state = await ensureSchema();
  const backfill = await seedDefaults(state);
  const afterListings = await prisma.$queryRawUnsafe('SELECT id, etsyPrintId AS etsyId FROM etsy_listings ORDER BY id');
  const beforeIdentity = beforeListings.map((row) => `${row.id}:${row.etsyId ?? ''}`);
  const afterIdentity = afterListings.map((row) => `${row.id}:${row.etsyId ?? ''}`);
  if (JSON.stringify(beforeIdentity) !== JSON.stringify(afterIdentity)) {
    throw new Error('Listing IDs or Etsy listing numbers changed during migration.');
  }
  const counts = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM etsy_listings) AS listings,
      (SELECT COUNT(*) FROM etsy_listings WHERE etsyPrintId IS NOT NULL) AS etsyListings,
      (SELECT COUNT(*) FROM etsy_listing_product_configs) AS configs,
      (SELECT COUNT(*) FROM etsy_listing_size_options) AS sizes,
      (SELECT COUNT(*) FROM etsy_listing_frame_options) AS frames,
      (SELECT COUNT(*) FROM etsy_listing_products) AS products
  `);
  console.log(JSON.stringify({ backups, backfill, ...counts[0] }, (_, value) => typeof value === 'bigint' ? Number(value) : value));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
