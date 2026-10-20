CREATE TABLE IF NOT EXISTS `etsy_sku_allocations` (
  `sequenceNumber` INT NOT NULL AUTO_INCREMENT,
  `listingId` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`sequenceNumber`),
  UNIQUE INDEX `etsy_sku_allocations_listingId_key` (`listingId`),
  CONSTRAINT `etsy_sku_allocations_listingId_fkey`
    FOREIGN KEY (`listingId`) REFERENCES `etsy_listings` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
