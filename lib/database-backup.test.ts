import { describe, expect, it } from 'vitest';

import { isDatabaseBackupTableName } from '@/lib/database-backup';

describe('database backup table identification', () => {
  it.each([
    'etsy_listings_bk',
    'etsy_listings_2026_10_04',
    'etsy_listings_2026_10_04_bk',
    'etsy_listing_ids_backup_20261004',
    'etsy_listing_thumbnails_backup_20261004075857',
  ])('identifies %s as a backup table', (tableName) => {
    expect(isDatabaseBackupTableName(tableName)).toBe(true);
  });

  it.each([
    'etsy_listings',
    'our_categories',
    'our_category_image_templates',
    'etsy_order_sync_states',
  ])('keeps %s as a live source table', (tableName) => {
    expect(isDatabaseBackupTableName(tableName)).toBe(false);
  });
});
