SET @linked_source_category_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_category_image_templates' AND COLUMN_NAME = 'linkedSourceCategoryId'
);
SET @add_linked_source_category = IF(
  @linked_source_category_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `linkedSourceCategoryId` INT NULL AFTER `categoryId`',
  'SELECT 1'
);
PREPARE add_linked_source_category_statement FROM @add_linked_source_category;
EXECUTE add_linked_source_category_statement;
DEALLOCATE PREPARE add_linked_source_category_statement;

SET @linked_source_image_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_category_image_templates' AND COLUMN_NAME = 'linkedSourceImageTemplateId'
);
SET @add_linked_source_image = IF(
  @linked_source_image_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `linkedSourceImageTemplateId` INT NULL AFTER `linkedSourceCategoryId`',
  'SELECT 1'
);
PREPARE add_linked_source_image_statement FROM @add_linked_source_image;
EXECUTE add_linked_source_image_statement;
DEALLOCATE PREPARE add_linked_source_image_statement;

SET @linked_image_item_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_category_image_templates' AND COLUMN_NAME = 'linkedImageItemNumber'
);
SET @add_linked_image_item = IF(
  @linked_image_item_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD COLUMN `linkedImageItemNumber` INT NULL AFTER `linkedSourceImageTemplateId`',
  'SELECT 1'
);
PREPARE add_linked_image_item_statement FROM @add_linked_image_item;
EXECUTE add_linked_image_item_statement;
DEALLOCATE PREPARE add_linked_image_item_statement;

SET @linked_source_category_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_category_image_templates' AND INDEX_NAME = 'our_category_image_templates_linkedSourceCategoryId_idx'
);
SET @add_linked_source_category_index = IF(
  @linked_source_category_index_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD INDEX `our_category_image_templates_linkedSourceCategoryId_idx` (`linkedSourceCategoryId`)',
  'SELECT 1'
);
PREPARE add_linked_source_category_index_statement FROM @add_linked_source_category_index;
EXECUTE add_linked_source_category_index_statement;
DEALLOCATE PREPARE add_linked_source_category_index_statement;

SET @linked_source_image_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_category_image_templates' AND INDEX_NAME = 'our_category_image_templates_linkedSourceImageTemplateId_idx'
);
SET @add_linked_source_image_index = IF(
  @linked_source_image_index_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD INDEX `our_category_image_templates_linkedSourceImageTemplateId_idx` (`linkedSourceImageTemplateId`)',
  'SELECT 1'
);
PREPARE add_linked_source_image_index_statement FROM @add_linked_source_image_index;
EXECUTE add_linked_source_image_index_statement;
DEALLOCATE PREPARE add_linked_source_image_index_statement;

SET @linked_source_category_fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'our_category_image_templates' AND CONSTRAINT_NAME = 'our_category_image_templates_linkedSourceCategoryId_fkey'
);
SET @add_linked_source_category_fk = IF(
  @linked_source_category_fk_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD CONSTRAINT `our_category_image_templates_linkedSourceCategoryId_fkey` FOREIGN KEY (`linkedSourceCategoryId`) REFERENCES `our_categories` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE add_linked_source_category_fk_statement FROM @add_linked_source_category_fk;
EXECUTE add_linked_source_category_fk_statement;
DEALLOCATE PREPARE add_linked_source_category_fk_statement;

SET @linked_source_image_fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'our_category_image_templates' AND CONSTRAINT_NAME = 'our_category_image_templates_linkedSourceImageTemplateId_fkey'
);
SET @add_linked_source_image_fk = IF(
  @linked_source_image_fk_exists = 0,
  'ALTER TABLE `our_category_image_templates` ADD CONSTRAINT `our_category_image_templates_linkedSourceImageTemplateId_fkey` FOREIGN KEY (`linkedSourceImageTemplateId`) REFERENCES `our_category_image_templates` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE add_linked_source_image_fk_statement FROM @add_linked_source_image_fk;
EXECUTE add_linked_source_image_fk_statement;
DEALLOCATE PREPARE add_linked_source_image_fk_statement;
