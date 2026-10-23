ALTER TABLE `our_categories`
  ADD COLUMN `backgroundColour` VARCHAR(7) NOT NULL DEFAULT '#F5F0E8' AFTER `roomTheme`;

ALTER TABLE `etsy_listings`
  ADD COLUMN `backgroundColour` VARCHAR(7) NULL AFTER `roomTheme`;
