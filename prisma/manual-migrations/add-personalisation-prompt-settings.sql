ALTER TABLE `etsy_listings`
  ADD COLUMN `personalisationHeaderText` VARCHAR(200) NULL,
  ADD COLUMN `personalisationFooterText` VARCHAR(200) NULL,
  ADD COLUMN `personalisationFontId` VARCHAR(64) NULL;
