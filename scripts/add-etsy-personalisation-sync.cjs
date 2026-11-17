const fs = require('node:fs');

const databaseLine = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find(line => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  for (const column of ['etsyPrintPersonalisationFingerprint', 'etsyCustomisedPersonalisationFingerprint']) {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      'etsy_listings', column,
    );
    if (Number(rows[0]?.count ?? 0) > 0) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE etsy_listings ADD COLUMN ${column} CHAR(64) NULL`);
    console.log(`Added etsy_listings.${column}.`);
  }
  console.log('Personalisation sync tracking is ready. Existing Etsy links and sync timestamps are unchanged.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
