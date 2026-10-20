SET @top_text_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'our_category_image_templates'
    AND COLUMN_NAME = 'topText'
);
SET @add_top_text_column = IF(
  @top_text_column_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `topText` VARCHAR(40) NOT NULL DEFAULT ''''',
  'SELECT 1'
);
PREPARE add_top_text_column_statement FROM @add_top_text_column;
EXECUTE add_top_text_column_statement;
DEALLOCATE PREPARE add_top_text_column_statement;

SET @bottom_text_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'our_category_image_templates'
    AND COLUMN_NAME = 'bottomText'
);
SET @add_bottom_text_column = IF(
  @bottom_text_column_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `bottomText` VARCHAR(40) NOT NULL DEFAULT ''''',
  'SELECT 1'
);
PREPARE add_bottom_text_column_statement FROM @add_bottom_text_column;
EXECUTE add_bottom_text_column_statement;
DEALLOCATE PREPARE add_bottom_text_column_statement;

SET @font_id_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'our_category_image_templates'
    AND COLUMN_NAME = 'fontId'
);
SET @add_font_id_column = IF(
  @font_id_column_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `fontId` VARCHAR(50) NOT NULL DEFAULT ''nunito-semibold''',
  'SELECT 1'
);
PREPARE add_font_id_column_statement FROM @add_font_id_column;
EXECUTE add_font_id_column_statement;
DEALLOCATE PREPARE add_font_id_column_statement;
