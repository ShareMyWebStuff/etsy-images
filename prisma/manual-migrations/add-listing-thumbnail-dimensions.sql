ALTER TABLE etsy_listings
  ADD COLUMN thumbnailWidthPixels INT NULL AFTER thumbnailUpdatedAt,
  ADD COLUMN thumbnailHeightPixels INT NULL AFTER thumbnailWidthPixels;
