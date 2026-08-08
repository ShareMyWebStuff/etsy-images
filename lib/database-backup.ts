import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

const BACKUP_SUFFIX = '_bk';

type TableNameRow = {
  TABLE_NAME: string;
};

type CountRow = {
  count: bigint | number | string;
};

type ColumnRow = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
};

export type BackupTableCount = {
  tableName: string;
  backupTableName: string;
  sourceRowCount: string;
  backupRowCount: string;
};

function quoteIdentifier(identifier: string) {
  return `\`${identifier.replaceAll('`', '``')}\``;
}

async function getSourceTableNames(client: Prisma.TransactionClient | typeof prisma = prisma) {
  const rows = await client.$queryRaw<TableNameRow[]>`
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `;

  return rows
    .map((row) => row.TABLE_NAME)
    .filter((tableName) => !tableName.toLowerCase().endsWith(BACKUP_SUFFIX));
}

async function ensureBackupTables(tableNames: string[]) {
  for (const tableName of tableNames) {
    const backupTableName = `${tableName}${BACKUP_SUFFIX}`;

    if (backupTableName.length > 64) {
      throw new Error(`Cannot create backup table for ${tableName}: the resulting name exceeds MySQL's 64-character limit.`);
    }

    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(backupTableName)} AS SELECT * FROM ${quoteIdentifier(tableName)} WHERE 1 = 0`
    );

    const columns = await prisma.$queryRaw<ColumnRow[]>`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${tableName}, ${backupTableName})
      ORDER BY ORDINAL_POSITION
    `;
    const backupColumns = new Set(
      columns.filter((column) => column.TABLE_NAME === backupTableName).map((column) => column.COLUMN_NAME)
    );
    for (const column of columns.filter((candidate) => candidate.TABLE_NAME === tableName)) {
      if (backupColumns.has(column.COLUMN_NAME)) continue;
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${quoteIdentifier(backupTableName)} ADD COLUMN ${quoteIdentifier(column.COLUMN_NAME)} ${column.COLUMN_TYPE} NULL`
      );
    }
  }
}

async function getTableCount(client: Prisma.TransactionClient | typeof prisma, tableName: string) {
  const rows = await client.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`
  );

  return String(rows[0]?.count ?? 0);
}

async function getColumnNames(client: Prisma.TransactionClient | typeof prisma, tableName: string) {
  const columns = await client.$queryRaw<Pick<ColumnRow, 'COLUMN_NAME'>[]>`
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tableName}
    ORDER BY ORDINAL_POSITION
  `;
  return columns.map((column) => column.COLUMN_NAME);
}

async function collectCounts(
  client: Prisma.TransactionClient | typeof prisma,
  tableNames: string[]
): Promise<BackupTableCount[]> {
  const counts: BackupTableCount[] = [];

  for (const tableName of tableNames) {
    const backupTableName = `${tableName}${BACKUP_SUFFIX}`;
    const [sourceRowCount, backupRowCount] = await Promise.all([
      getTableCount(client, tableName),
      getTableCount(client, backupTableName),
    ]);

    counts.push({ tableName, backupTableName, sourceRowCount, backupRowCount });
  }

  return counts;
}

export async function getBackupTableCounts() {
  const tableNames = await getSourceTableNames();
  await ensureBackupTables(tableNames);
  return collectCounts(prisma, tableNames);
}

export async function createDatabaseBackup() {
  const tableNames = await getSourceTableNames();
  await ensureBackupTables(tableNames);

  return prisma.$transaction(
    async (transaction) => {
      for (const tableName of tableNames) {
        const backupTableName = `${tableName}${BACKUP_SUFFIX}`;
        const columns = (await getColumnNames(transaction, tableName)).map(quoteIdentifier).join(', ');
        await transaction.$executeRawUnsafe(`DELETE FROM ${quoteIdentifier(backupTableName)}`);
        await transaction.$executeRawUnsafe(
          `INSERT INTO ${quoteIdentifier(backupTableName)} (${columns}) SELECT ${columns} FROM ${quoteIdentifier(tableName)}`
        );
      }

      return collectCounts(transaction, tableNames);
    },
    { maxWait: 10_000, timeout: 120_000 }
  );
}
