ALTER TABLE `etsy_listings`
  ADD COLUMN `thumbnailUpdatedAt` DATETIME(3) NULL AFTER `thumbnailOriginalFileName`;

ALTER TABLE `etsy_listing_product_configs`
  ADD COLUMN `confirmedAt` DATETIME(3) NULL AFTER `sku`;

ALTER TABLE `etsy_listing_images`
  ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
