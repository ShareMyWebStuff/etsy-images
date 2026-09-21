const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const OLD_TITLE = 'See Creatures Wall Art';
const NEW_TITLE = 'Sea Creatures Wall Art';

async function main() {
  const sections = await prisma.etsyShopSection.findMany({
    where: { title: OLD_TITLE },
    select: { id: true, shopId: true },
  });

  if (sections.length === 0) {
    console.log(`No sections named "${OLD_TITLE}" remain.`);
    return;
  }

  for (const section of sections) {
    const conflictingSection = section.shopId == null
      ? null
      : await prisma.etsyShopSection.findFirst({
          where: { shopId: section.shopId, title: NEW_TITLE, id: { not: section.id } },
          select: { id: true },
        });
    if (conflictingSection) {
      throw new Error(`Cannot rename section ${section.id}: section ${conflictingSection.id} already uses "${NEW_TITLE}".`);
    }

    await prisma.etsyShopSection.update({
      where: { id: section.id },
      data: { title: NEW_TITLE },
    });
    console.log(`Renamed section ${section.id}: "${OLD_TITLE}" -> "${NEW_TITLE}".`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
