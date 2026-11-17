const fs = require('node:fs');

if (!process.env.DATABASE_URL) {
  const databaseLine = fs.readFileSync('.env', 'utf8').split(/\r?\n/)
    .find((line) => line.startsWith('DATABASE_URL='));
  if (!databaseLine) throw new Error('DATABASE_URL is missing.');
  process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    'pinterest_pins', 'creativeStorageKey',
  );
  if (Number(rows[0]?.count ?? 0) > 0) {
    console.log('pinterest_pins.creativeStorageKey already exists.');
    return;
  }
  await prisma.$executeRawUnsafe('ALTER TABLE pinterest_pins ADD COLUMN creativeStorageKey VARCHAR(512) NULL AFTER creativeType');
  console.log('Added pinterest_pins.creativeStorageKey.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
