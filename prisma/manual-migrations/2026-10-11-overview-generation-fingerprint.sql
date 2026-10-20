ALTER TABLE `etsy_listings`
  ADD COLUMN `overviewGenerationFingerprint` VARCHAR(64) NULL AFTER `dropboxSyncedAt`;
