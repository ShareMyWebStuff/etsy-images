SET @image_template_position_column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'our_category_image_templates'
    AND COLUMN_NAME = 'position'
);
SET @add_image_template_position_column = IF(
  @image_template_position_column_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `position` INT NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE add_image_template_position_column_statement FROM @add_image_template_position_column;
EXECUTE add_image_template_position_column_statement;
DEALLOCATE PREPARE add_image_template_position_column_statement;

SET @backfill_image_template_positions = IF(
  @image_template_position_column_exists = 0,
  'UPDATE `our_category_image_templates` AS current_template SET `position` = (SELECT COUNT(*) FROM (SELECT `id`, `categoryId`, `name` FROM `our_category_image_templates`) AS ordered_template WHERE ordered_template.`categoryId` = current_template.`categoryId` AND (ordered_template.`name` < current_template.`name` OR (ordered_template.`name` = current_template.`name` AND ordered_template.`id` < current_template.`id`)))',
  'SELECT 1'
);
PREPARE backfill_image_template_positions_statement FROM @backfill_image_template_positions;
EXECUTE backfill_image_template_positions_statement;
DEALLOCATE PREPARE backfill_image_template_positions_statement;
