const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const statements = [
  `CREATE TABLE IF NOT EXISTS financial_entries (
    id INT NOT NULL AUTO_INCREMENT,
    entryDate DATETIME(3) NOT NULL,
    type ENUM('INCOME','EXPENSE') NOT NULL,
    amountMinorUnits INT NOT NULL,
    currencyCode VARCHAR(3) NOT NULL,
    description VARCHAR(500) NOT NULL,
    category VARCHAR(100) NOT NULL,
    source ENUM('ETSY','MANUAL') NOT NULL,
    etsyShopId BIGINT NULL,
    etsyReceiptId BIGINT NULL,
    etsyTransactionId BIGINT NULL,
    etsyLedgerEntryId BIGINT NULL,
    externalReference VARCHAR(191) NULL,
    dedupeKey VARCHAR(191) NOT NULL,
    rawJson JSON NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX financial_entries_dedupeKey_key (dedupeKey),
    INDEX financial_entries_entryDate_idx (entryDate),
    INDEX financial_entries_type_entryDate_idx (type, entryDate),
    INDEX financial_entries_source_entryDate_idx (source, entryDate),
    INDEX financial_entries_category_entryDate_idx (category, entryDate),
    INDEX financial_entries_etsyShopId_idx (etsyShopId),
    PRIMARY KEY (id),
    CONSTRAINT financial_entries_etsyShopId_fkey FOREIGN KEY (etsyShopId) REFERENCES etsy_shops(etsyShopId) ON DELETE SET NULL ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS etsy_receipts (
    id INT NOT NULL AUTO_INCREMENT,
    etsyShopId BIGINT NOT NULL,
    etsyReceiptId BIGINT NOT NULL,
    status VARCHAR(50) NULL,
    isPaid BOOLEAN NULL,
    isCanceled BOOLEAN NULL,
    grandTotalAmount INT NULL,
    grandTotalDivisor INT NULL,
    currencyCode VARCHAR(3) NULL,
    createdAtEtsy DATETIME(3) NULL,
    updatedAtEtsy DATETIME(3) NULL,
    rawJson JSON NOT NULL,
    financialEntryId INT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX etsy_receipts_shop_receipt_key (etsyShopId, etsyReceiptId),
    UNIQUE INDEX etsy_receipts_financialEntryId_key (financialEntryId),
    INDEX etsy_receipts_createdAtEtsy_idx (createdAtEtsy),
    INDEX etsy_receipts_updatedAtEtsy_idx (updatedAtEtsy),
    PRIMARY KEY (id),
    CONSTRAINT etsy_receipts_etsyShopId_fkey FOREIGN KEY (etsyShopId) REFERENCES etsy_shops(etsyShopId) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT etsy_receipts_financialEntryId_fkey FOREIGN KEY (financialEntryId) REFERENCES financial_entries(id) ON DELETE SET NULL ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS etsy_transactions (
    id INT NOT NULL AUTO_INCREMENT,
    receiptId INT NOT NULL,
    etsyShopId BIGINT NOT NULL,
    etsyReceiptId BIGINT NOT NULL,
    etsyTransactionId BIGINT NOT NULL,
    etsyListingId BIGINT NULL,
    title VARCHAR(500) NULL,
    quantity INT NULL,
    priceAmount INT NULL,
    priceDivisor INT NULL,
    currencyCode VARCHAR(3) NULL,
    createdAtEtsy DATETIME(3) NULL,
    paidAtEtsy DATETIME(3) NULL,
    rawJson JSON NOT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX etsy_transactions_shop_transaction_key (etsyShopId, etsyTransactionId),
    INDEX etsy_transactions_receiptId_idx (receiptId),
    INDEX etsy_transactions_etsyReceiptId_idx (etsyReceiptId),
    INDEX etsy_transactions_createdAtEtsy_idx (createdAtEtsy),
    PRIMARY KEY (id),
    CONSTRAINT etsy_transactions_receiptId_fkey FOREIGN KEY (receiptId) REFERENCES etsy_receipts(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT etsy_transactions_etsyShopId_fkey FOREIGN KEY (etsyShopId) REFERENCES etsy_shops(etsyShopId) ON DELETE CASCADE ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS etsy_payment_ledger_entries (
    id INT NOT NULL AUTO_INCREMENT,
    etsyShopId BIGINT NOT NULL,
    etsyLedgerEntryId BIGINT NOT NULL,
    etsyLedgerId BIGINT NULL,
    sequenceNumber INT NULL,
    amountMinorUnits INT NULL,
    currencyCode VARCHAR(3) NULL,
    balanceMinorUnits INT NULL,
    description VARCHAR(500) NULL,
    ledgerType VARCHAR(100) NULL,
    referenceType VARCHAR(100) NULL,
    referenceId VARCHAR(191) NULL,
    parentEntryId BIGINT NULL,
    createdAtEtsy DATETIME(3) NULL,
    rawJson JSON NOT NULL,
    financialEntryId INT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX etsy_ledger_entries_shop_entry_key (etsyShopId, etsyLedgerEntryId),
    UNIQUE INDEX etsy_payment_ledger_entries_financialEntryId_key (financialEntryId),
    INDEX etsy_payment_ledger_entries_createdAtEtsy_idx (createdAtEtsy),
    INDEX etsy_payment_ledger_entries_ledgerType_idx (ledgerType),
    PRIMARY KEY (id),
    CONSTRAINT etsy_payment_ledger_entries_shop_fkey FOREIGN KEY (etsyShopId) REFERENCES etsy_shops(etsyShopId) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT etsy_payment_ledger_entries_financial_fkey FOREIGN KEY (financialEntryId) REFERENCES financial_entries(id) ON DELETE SET NULL ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS etsy_accounting_sync_states (
    id INT NOT NULL AUTO_INCREMENT,
    etsyShopId BIGINT NOT NULL,
    fullSyncCompleted BOOLEAN NOT NULL DEFAULT false,
    lastSuccessfulReceiptSyncAt DATETIME(3) NULL,
    lastSuccessfulLedgerSyncAt DATETIME(3) NULL,
    overlapSeconds INT NOT NULL DEFAULT 172800,
    status ENUM('IDLE','RUNNING','FAILED') NOT NULL DEFAULT 'IDLE',
    syncStartedAt DATETIME(3) NULL,
    lastSuccessfulSyncAt DATETIME(3) NULL,
    lastError TEXT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX etsy_accounting_sync_states_etsyShopId_key (etsyShopId),
    INDEX etsy_accounting_sync_states_status_idx (status),
    PRIMARY KEY (id),
    CONSTRAINT etsy_accounting_sync_states_shop_fkey FOREIGN KEY (etsyShopId) REFERENCES etsy_shops(etsyShopId) ON DELETE CASCADE ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];

async function main() {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  console.log('Accounts tables are ready.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
