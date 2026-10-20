CREATE TABLE IF NOT EXISTS `our_categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shopId` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `roomTheme` VARCHAR(200) NOT NULL,
  `printsFrames` BOOLEAN NOT NULL DEFAULT TRUE,
  `customisePrints` BOOLEAN NOT NULL DEFAULT TRUE,
  `digitalDownload` BOOLEAN NOT NULL DEFAULT TRUE,
  `customTop` BOOLEAN NOT NULL DEFAULT TRUE,
  `customBottom` BOOLEAN NOT NULL DEFAULT TRUE,
  `printFrameSectionId` INT NULL,
  `customisedSectionId` INT NULL,
  `downloadSectionId` INT NULL,
  `sizes` JSON NOT NULL,
  `frames` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `our_categories_shopId_name_key` (`shopId`, `name`),
  INDEX `our_categories_printFrameSectionId_idx` (`printFrameSectionId`),
  INDEX `our_categories_customisedSectionId_idx` (`customisedSectionId`),
  INDEX `our_categories_downloadSectionId_idx` (`downloadSectionId`),
  CONSTRAINT `our_categories_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `etsy_shops` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `our_categories_printFrameSectionId_fkey` FOREIGN KEY (`printFrameSectionId`) REFERENCES `etsy_download_sections` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `our_categories_customisedSectionId_fkey` FOREIGN KEY (`customisedSectionId`) REFERENCES `etsy_download_sections` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `our_categories_downloadSectionId_fkey` FOREIGN KEY (`downloadSectionId`) REFERENCES `etsy_download_sections` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `our_category_image_templates` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `categoryId` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(500) NOT NULL,
  `imagePath` VARCHAR(500) NOT NULL,
  `originalFileName` VARCHAR(255) NOT NULL,
  `contentType` VARCHAR(100) NOT NULL,
  `sizeBytes` INT NOT NULL,
  `imageWidth` INT NULL,
  `imageHeight` INT NULL,
  `openingCorners` JSON NULL,
  `openingRegions` JSON NULL,
  `topText` VARCHAR(40) NOT NULL DEFAULT '',
  `bottomText` VARCHAR(40) NOT NULL DEFAULT '',
  `fontId` VARCHAR(50) NOT NULL DEFAULT 'nunito-semibold',
  `position` INT NOT NULL DEFAULT 0,
  `useOnPrints` BOOLEAN NOT NULL DEFAULT TRUE,
  `useOnCustomised` BOOLEAN NOT NULL DEFAULT TRUE,
  `useOnDigital` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `our_category_image_templates_categoryId_name_key` (`categoryId`, `name`),
  INDEX `our_category_image_templates_categoryId_idx` (`categoryId`),
  CONSTRAINT `our_category_image_templates_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `our_categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @our_category_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'etsy_listings'
    AND COLUMN_NAME = 'ourCategoryId'
);
SET @add_our_category_column = IF(
  @our_category_column_exists = 0,
  'ALTER TABLE `etsy_listings` ADD COLUMN `ourCategoryId` INT NULL, ADD INDEX `etsy_listings_ourCategoryId_idx` (`ourCategoryId`), ADD CONSTRAINT `etsy_listings_ourCategoryId_fkey` FOREIGN KEY (`ourCategoryId`) REFERENCES `our_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE add_our_category_column_statement FROM @add_our_category_column;
EXECUTE add_our_category_column_statement;
DEALLOCATE PREPARE add_our_category_column_statement;
