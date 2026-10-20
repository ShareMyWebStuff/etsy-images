SET @image_width_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'our_category_image_templates'
    AND COLUMN_NAME = 'imageWidth'
);
SET @add_image_width_column = IF(
  @image_width_column_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `imageWidth` INT NULL',
  'SELECT 1'
);
PREPARE add_image_width_column_statement FROM @add_image_width_column;
EXECUTE add_image_width_column_statement;
DEALLOCATE PREPARE add_image_width_column_statement;

SET @image_height_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'our_category_image_templates'
    AND COLUMN_NAME = 'imageHeight'
);
SET @add_image_height_column = IF(
  @image_height_column_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `imageHeight` INT NULL',
  'SELECT 1'
);
PREPARE add_image_height_column_statement FROM @add_image_height_column;
EXECUTE add_image_height_column_statement;
DEALLOCATE PREPARE add_image_height_column_statement;

SET @opening_corners_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'our_category_image_templates'
    AND COLUMN_NAME = 'openingCorners'
);
SET @add_opening_corners_column = IF(
  @opening_corners_column_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `openingCorners` JSON NULL',
  'SELECT 1'
);
PREPARE add_opening_corners_column_statement FROM @add_opening_corners_column;
EXECUTE add_opening_corners_column_statement;
DEALLOCATE PREPARE add_opening_corners_column_statement;
