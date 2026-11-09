const fs = require('node:fs');
const path = require('node:path');
const databaseLine = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find(line => line.startsWith('DATABASE_URL='));
if (!databaseLine) throw new Error('DATABASE_URL is missing.');
process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', 'etsy_shops', 'currencyCode');
  const statements = fs.readFileSync(path.join(__dirname, '../prisma/manual-migrations/add-markets-delivery.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean);
  for (const statement of statements) {
    if (statement.startsWith('ALTER TABLE') && Number(rows[0]?.count ?? 0) > 0) continue;
    await prisma.$executeRawUnsafe(statement);
  }
  console.log('Markets & Delivery tables are ready. Existing listing assignments were preserved.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
