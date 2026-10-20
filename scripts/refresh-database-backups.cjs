const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BACKUP_SUFFIX = '_bk';

function quoteIdentifier(identifier) {
  return `\`${identifier.replaceAll('`', '``')}\``;
}

function isBackupTableName(tableName) {
  const normalized = tableName.toLowerCase();
  return normalized.endsWith(BACKUP_SUFFIX)
    || /_20\d{2}_\d{2}_\d{2}$/.test(normalized)
    || /_backup_\d{8,14}$/.test(normalized);
}

async function tableNames() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
  );
  return rows.map((row) => row.TABLE_NAME);
}

async function rowCount(client, tableName) {
  const rows = await client.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`);
  return String(rows[0]?.count ?? 0);
}

async function main() {
  const existingTables = await tableNames();
  const backupTables = existingTables.filter(isBackupTableName);
  const sourceTables = existingTables.filter((tableName) => !isBackupTableName(tableName));
  if (sourceTables.length === 0) throw new Error('No live source tables were found; no tables were changed.');
  if (backupTables.some((tableName) => !isBackupTableName(tableName))) {
    throw new Error('The backup drop list contains an unrecognised table name; no tables were changed.');
  }
  for (const sourceTable of sourceTables) {
    if (`${sourceTable}${BACKUP_SUFFIX}`.length > 64) {
      throw new Error(`Cannot back up ${sourceTable}: the backup name exceeds MySQL's 64-character limit.`);
    }
  }

  for (const backupTable of backupTables) {
    await prisma.$executeRawUnsafe(`DROP TABLE ${quoteIdentifier(backupTable)}`);
  }
  for (const sourceTable of sourceTables) {
    const backupTable = `${sourceTable}${BACKUP_SUFFIX}`;
    await prisma.$executeRawUnsafe(
      `CREATE TABLE ${quoteIdentifier(backupTable)} AS SELECT * FROM ${quoteIdentifier(sourceTable)} WHERE 1 = 0`,
    );
  }

  const counts = await prisma.$transaction(async (transaction) => {
    const results = [];
    for (const sourceTable of sourceTables) {
      const backupTable = `${sourceTable}${BACKUP_SUFFIX}`;
      const columns = await transaction.$queryRawUnsafe(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        sourceTable,
      );
      const columnList = columns.map(({ COLUMN_NAME }) => quoteIdentifier(COLUMN_NAME)).join(', ');
      await transaction.$executeRawUnsafe(
        `INSERT INTO ${quoteIdentifier(backupTable)} (${columnList}) SELECT ${columnList} FROM ${quoteIdentifier(sourceTable)}`,
      );
      const [sourceRows, backupRows] = await Promise.all([
        rowCount(transaction, sourceTable),
        rowCount(transaction, backupTable),
      ]);
      if (sourceRows !== backupRows) {
        throw new Error(`Backup verification failed for ${sourceTable}: source=${sourceRows}, backup=${backupRows}.`);
      }
      results.push({ sourceTable, backupTable, rows: sourceRows });
    }
    return results;
  }, { maxWait: 10_000, timeout: 120_000, isolationLevel: 'Serializable' });

  const finalTables = await tableNames();
  const finalBackups = finalTables.filter(isBackupTableName);
  const expectedBackups = sourceTables.map((tableName) => `${tableName}${BACKUP_SUFFIX}`).sort();
  if (JSON.stringify(finalBackups.sort()) !== JSON.stringify(expectedBackups)) {
    throw new Error('The final backup table set does not match the live source table set.');
  }

  const totalRows = counts.reduce((total, item) => total + BigInt(item.rows), 0n);
  console.log(JSON.stringify({
    removedBackupTables: backupTables.length,
    createdBackupTables: counts.length,
    copiedRows: totalRows.toString(),
    tables: counts,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
