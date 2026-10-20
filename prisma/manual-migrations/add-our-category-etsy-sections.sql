SET @print_frames_flag_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_download_sections' AND COLUMN_NAME = 'useForPrintFrames'
);
SET @add_print_frames_flag = IF(
  @print_frames_flag_exists = 0,
  'ALTER TABLE `etsy_download_sections` ADD COLUMN `useForPrintFrames` BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT 1'
);
PREPARE add_print_frames_flag_statement FROM @add_print_frames_flag;
EXECUTE add_print_frames_flag_statement;
DEALLOCATE PREPARE add_print_frames_flag_statement;

SET @customised_flag_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_download_sections' AND COLUMN_NAME = 'useForCustomisedPrints'
);
SET @add_customised_flag = IF(
  @customised_flag_exists = 0,
  'ALTER TABLE `etsy_download_sections` ADD COLUMN `useForCustomisedPrints` BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT 1'
);
PREPARE add_customised_flag_statement FROM @add_customised_flag;
EXECUTE add_customised_flag_statement;
DEALLOCATE PREPARE add_customised_flag_statement;

SET @digital_flag_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etsy_download_sections' AND COLUMN_NAME = 'useForDigitalDownloads'
);
SET @add_digital_flag = IF(
  @digital_flag_exists = 0,
  'ALTER TABLE `etsy_download_sections` ADD COLUMN `useForDigitalDownloads` BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT 1'
);
PREPARE add_digital_flag_statement FROM @add_digital_flag;
EXECUTE add_digital_flag_statement;
DEALLOCATE PREPARE add_digital_flag_statement;

SET @backfill_digital_flag = IF(
  @digital_flag_exists = 0,
  'UPDATE `etsy_download_sections` SET `useForDigitalDownloads` = TRUE',
  'SELECT 1'
);
PREPARE backfill_digital_flag_statement FROM @backfill_digital_flag;
EXECUTE backfill_digital_flag_statement;
DEALLOCATE PREPARE backfill_digital_flag_statement;

ALTER TABLE `etsy_download_sections`
  MODIFY COLUMN `useForDigitalDownloads` BOOLEAN NOT NULL DEFAULT FALSE;

SET @print_frame_section_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_categories' AND COLUMN_NAME = 'printFrameSectionId'
);
SET @add_print_frame_section = IF(
  @print_frame_section_exists = 0,
  'ALTER TABLE `our_categories` ADD COLUMN `printFrameSectionId` INT NULL AFTER `customBottom`, ADD INDEX `our_categories_printFrameSectionId_idx` (`printFrameSectionId`), ADD CONSTRAINT `our_categories_printFrameSectionId_fkey` FOREIGN KEY (`printFrameSectionId`) REFERENCES `etsy_download_sections` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE add_print_frame_section_statement FROM @add_print_frame_section;
EXECUTE add_print_frame_section_statement;
DEALLOCATE PREPARE add_print_frame_section_statement;

SET @customised_section_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'our_categories' AND COLUMN_NAME = 'customisedSectionId'
);
SET @add_customised_section = IF(
  @customised_section_exists = 0,
  'ALTER TABLE `our_categories` ADD COLUMN `customisedSectionId` INT NULL AFTER `printFrameSectionId`, ADD INDEX `our_categories_customisedSectionId_idx` (`customisedSectionId`), ADD CONSTRAINT `our_categories_customisedSectionId_fkey` FOREIGN KEY (`customisedSectionId`) REFERENCES `etsy_download_sections` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE add_customised_section_statement FROM @add_customised_section;
EXECUTE add_customised_section_statement;
DEALLOCATE PREPARE add_customised_section_statement;
