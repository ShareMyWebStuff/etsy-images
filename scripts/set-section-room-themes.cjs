const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const themes = new Map([
  ['Dinosaur Wall Art', 'Dinosaurs'],
  ['Bugs Wall Art', 'Bugs'],
  ['Woodland Wall Art', 'Woodland'],
  ['Farm Animal Wall Art', 'Farm Animals'],
  ['Jungle & Safari Wall Art', 'Jungle & Safari'],
  ['See Creatures Wall Art', 'Sea Creatures'],
]);

async function main() {
  const sections = await prisma.etsyShopSection.findMany({
    where: { OR: [{ etsyShopId: 66615491n }, { shop: { etsyShopId: 66615491n } }] },
    select: { id: true, title: true, numberOfDownloads: true, includeAllDownloads: true },
  });
  for (const section of sections) {
    const hasMultipleDownloads = section.includeAllDownloads || (section.numberOfDownloads ?? 1) > 1;
    const roomTheme = hasMultipleDownloads ? null : themes.get(section.title) ?? null;
    await prisma.etsyShopSection.update({ where: { id: section.id }, data: { roomTheme } });
    console.log(`${section.title}: ${roomTheme ?? '(blank)'}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
