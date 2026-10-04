ALTER TABLE etsy_listing_product_configs
  ADD COLUMN giftMessageEnabled BOOLEAN NOT NULL DEFAULT FALSE AFTER customisePrints;

ALTER TABLE etsy_listing_product_configs
  DROP COLUMN customiseDigitalDownloads;
