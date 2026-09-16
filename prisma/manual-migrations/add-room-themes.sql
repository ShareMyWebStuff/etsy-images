ALTER TABLE `etsy_shop_sections`
  ADD COLUMN `roomTheme` VARCHAR(200) NULL;

ALTER TABLE `etsy_listings`
  ADD COLUMN `roomTheme` VARCHAR(200) NULL;
