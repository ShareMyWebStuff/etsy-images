ALTER TABLE `our_category_image_templates`
  ADD COLUMN `borderEnabled` BOOLEAN NOT NULL DEFAULT FALSE AFTER `openingRegions`,
  ADD COLUMN `borderSizePercent` DOUBLE NOT NULL DEFAULT 5 AFTER `borderEnabled`;
