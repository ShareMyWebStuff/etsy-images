UPDATE `etsy_listings` listing
JOIN `etsy_shops` shop
  ON shop.`etsyShopId` = CAST(listing.`shopId` AS UNSIGNED)
JOIN `our_categories` template
  ON template.`shopId` = shop.`id`
 AND template.`name` = 'Sea Creatures Kids'
SET listing.`ourCategoryId` = template.`id`,
    listing.`roomTheme` = COALESCE(NULLIF(listing.`roomTheme`, ''), template.`roomTheme`)
WHERE listing.`ourCategoryId` IS NULL;
