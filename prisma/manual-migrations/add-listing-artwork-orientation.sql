ALTER TABLE etsy_listings
  ADD COLUMN artworkOrientation VARCHAR(16) NOT NULL DEFAULT 'portrait' AFTER listingDescription;
