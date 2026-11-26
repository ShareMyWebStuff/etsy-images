-- Additive and repeatable. Existing image-role IDs, assets and legacy scene references stay intact.
SET @ddl = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE our_categories ADD COLUMN portraitEnabled BOOLEAN NOT NULL DEFAULT TRUE', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_categories' AND COLUMN_NAME = 'portraitEnabled');
PREPARE template_orientation_statement FROM @ddl;
EXECUTE template_orientation_statement;
DEALLOCATE PREPARE template_orientation_statement;
SET @ddl = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE our_categories ADD COLUMN landscapeEnabled BOOLEAN NOT NULL DEFAULT TRUE', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_categories' AND COLUMN_NAME = 'landscapeEnabled');
PREPARE template_orientation_statement FROM @ddl;
EXECUTE template_orientation_statement;
DEALLOCATE PREPARE template_orientation_statement;
SET @ddl = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE our_category_image_templates ADD COLUMN orientationVariants JSON NULL', 'SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_category_image_templates' AND COLUMN_NAME = 'orientationVariants');
PREPARE template_orientation_statement FROM @ddl;
EXECUTE template_orientation_statement;
DEALLOCATE PREPARE template_orientation_statement;
