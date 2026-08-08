const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_shop_sections'
    ORDER BY ORDINAL_POSITION
  `);
  const backupColumns = new Set((await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_shop_sections_bk'
  `)).map((column) => column.COLUMN_NAME));
  const shared = columns.map((column) => column.COLUMN_NAME).filter((name) => backupColumns.has(name));
  const quoted = shared.map((name) => `\`${name.replaceAll('`', '``')}\``).join(', ');
  await prisma.$transaction([
    prisma.$executeRawUnsafe('DELETE FROM etsy_shop_sections_bk'),
    prisma.$executeRawUnsafe(`INSERT INTO etsy_shop_sections_bk (${quoted}) SELECT ${quoted} FROM etsy_shop_sections`),
  ]);

  if (!columns.some((column) => column.COLUMN_NAME === 'sourceSectionId')) {
    await prisma.$executeRawUnsafe('ALTER TABLE etsy_shop_sections ADD COLUMN sourceSectionId INT NULL');
  }

  const dinosaur = await prisma.$queryRawUnsafe(`
    SELECT s.id FROM etsy_shop_sections s
    JOIN etsy_shops shop ON shop.id = s.shopId
    WHERE shop.etsyShopId = 66615491 AND s.title = 'Dinosaur Wall Art'
  `);
  if (dinosaur.length !== 1) throw new Error('Dinosaur Wall Art was not found uniquely.');
  const result = await prisma.$executeRawUnsafe(`
    UPDATE etsy_shop_sections s
    JOIN etsy_shops shop ON shop.id = s.shopId
    SET s.sourceSectionId = ?
    WHERE shop.etsyShopId = 66615491
      AND s.title IN ('Sets of 3', 'Sets of 6', 'Sets of 12', 'Complete Sets')
  `, dinosaur[0].id);
  if (result !== 4) throw new Error(`Expected to update 4 sections but updated ${result}.`);

  const mappings = await prisma.$queryRawUnsafe(`
    SELECT target.title, source.title AS sourceTitle
    FROM etsy_shop_sections target
    LEFT JOIN etsy_shop_sections source ON source.id = target.sourceSectionId
    WHERE target.title IN ('Sets of 3', 'Sets of 6', 'Sets of 12', 'Complete Sets')
    ORDER BY target.title
  `);
  console.log(JSON.stringify(mappings));
}

main().finally(() => prisma.$disconnect());
