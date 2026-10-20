SET @template_type_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_categories' AND COLUMN_NAME = 'templateType'
);
SET @add_template_type = IF(
  @template_type_exists = 0,
  'ALTER TABLE `our_categories` ADD COLUMN `templateType` VARCHAR(16) NOT NULL DEFAULT ''single'' AFTER `name`',
  'SELECT 1'
);
PREPARE add_template_type_statement FROM @add_template_type;
EXECUTE add_template_type_statement;
DEALLOCATE PREPARE add_template_type_statement;

SET @followed_template_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_categories' AND COLUMN_NAME = 'followedTemplateId'
);
SET @add_followed_template = IF(
  @followed_template_exists = 0,
  'ALTER TABLE `our_categories` ADD COLUMN `followedTemplateId` INT NULL AFTER `templateType`',
  'SELECT 1'
);
PREPARE add_followed_template_statement FROM @add_followed_template;
EXECUTE add_followed_template_statement;
DEALLOCATE PREPARE add_followed_template_statement;

SET @item_count_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_categories' AND COLUMN_NAME = 'itemCount'
);
SET @add_item_count = IF(
  @item_count_exists = 0,
  'ALTER TABLE `our_categories` ADD COLUMN `itemCount` INT NOT NULL DEFAULT 1 AFTER `followedTemplateId`',
  'SELECT 1'
);
PREPARE add_item_count_statement FROM @add_item_count;
EXECUTE add_item_count_statement;
DEALLOCATE PREPARE add_item_count_statement;

UPDATE `our_categories`
SET `templateType` = 'single', `followedTemplateId` = NULL, `itemCount` = 1
WHERE `templateType` IS NULL OR `templateType` NOT IN ('single', 'multiple');

SET @followed_template_index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_categories' AND INDEX_NAME = 'our_categories_followedTemplateId_idx'
);
SET @add_followed_template_index = IF(
  @followed_template_index_exists = 0,
  'ALTER TABLE `our_categories` ADD INDEX `our_categories_followedTemplateId_idx` (`followedTemplateId`)',
  'SELECT 1'
);
PREPARE add_followed_template_index_statement FROM @add_followed_template_index;
EXECUTE add_followed_template_index_statement;
DEALLOCATE PREPARE add_followed_template_index_statement;

SET @followed_template_fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'our_categories' AND CONSTRAINT_NAME = 'our_categories_followedTemplateId_fkey'
);
SET @add_followed_template_fk = IF(
  @followed_template_fk_exists = 0,
  'ALTER TABLE `our_categories` ADD CONSTRAINT `our_categories_followedTemplateId_fkey` FOREIGN KEY (`followedTemplateId`) REFERENCES `our_categories` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE add_followed_template_fk_statement FROM @add_followed_template_fk;
EXECUTE add_followed_template_fk_statement;
DEALLOCATE PREPARE add_followed_template_fk_statement;
