SET @opening_regions_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'our_category_image_templates'
    AND COLUMN_NAME = 'openingRegions'
);
SET @add_opening_regions_column = IF(
  @opening_regions_column_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `openingRegions` JSON NULL',
  'SELECT 1'
);
PREPARE add_opening_regions_column_statement FROM @add_opening_regions_column;
EXECUTE add_opening_regions_column_statement;
DEALLOCATE PREPARE add_opening_regions_column_statement;

UPDATE `our_category_image_templates`
SET `openingRegions` = JSON_ARRAY(
  JSON_OBJECT(
    'id', CONCAT('area-', `id`, '-1'),
    'name', 'Area 1',
    'corners', `openingCorners`
  )
)
WHERE `openingRegions` IS NULL
  AND `openingCorners` IS NOT NULL;
