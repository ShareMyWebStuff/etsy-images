import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { DEFAULT_TEMPLATE_IMAGE_TAGS, migrateTemplateImageTags } = require('../scripts/add-our-template-image-tags.cjs') as {
  DEFAULT_TEMPLATE_IMAGE_TAGS: string[];
  migrateTemplateImageTags: (client: unknown) => Promise<void>;
};

describe('additive template image tag migration', () => {
  it('seeds exactly the requested names and preserves existing IDs and custom tags on repeat execution', async () => {
    expect(DEFAULT_TEMPLATE_IMAGE_TAGS).toEqual(['Living Room', 'Dining Room', 'Nursery', 'Kids Room', 'Studio', 'Landing Image',
      'Dinosaurs', 'Farm Animals', 'Sea Creatures', 'Woodland Animals', 'Bugs & Insects', 'Jungle Animals', 'Safari Animals',
      'Set of 3', 'Vintage Art', 'Minimalist Room', 'Modern Room', 'Dark Room',
      'Kitchen', 'Bathroom', 'Toilet', 'Hallway', 'Plant(s)', 'Spot Light', 'Photo Border', 'Candle(s)', 'Book(s)',
      'Light Room', 'Coffee Table', 'Frame Black', 'Frame White', 'Frame Oak', 'Art', 'Bedroom', 'Study', 'Traditional', 'Portrait', 'Landscape']);
    const rows = new Map([['nursery', { id: 'existing-nursery-id', name: 'Nursery' }], ['custom', { id: 'custom-id', name: 'Custom' }]]);
    const execute = vi.fn(async (sql: string, id?: string, name?: string, key?: string) => {
      if (sql.startsWith('INSERT INTO') && !rows.has(key!)) rows.set(key!, { id: id!, name: name! });
    });
    const client = { $queryRawUnsafe: vi.fn().mockResolvedValue([{ characterSet: 'utf8mb4', collationName: 'utf8mb4_unicode_ci' }]),
      $executeRawUnsafe: execute, $transaction: vi.fn(async (operation) => operation({ $executeRawUnsafe: execute })) };
    await migrateTemplateImageTags(client); await migrateTemplateImageTags(client);
    expect(rows.size).toBe(39); expect(rows.get('nursery')?.id).toBe('existing-nursery-id');
    expect(rows.get('custom')).toEqual({ id: 'custom-id', name: 'Custom' });
    const ddl = execute.mock.calls.filter(([sql]) => sql.startsWith('CREATE TABLE'));
    expect(ddl).toHaveLength(4);
    expect(ddl.every(([sql]) => sql.includes('IF NOT EXISTS'))).toBe(true);
    expect(ddl[1][0]).toContain('REFERENCES our_template_images(id) ON DELETE CASCADE');
    expect(execute.mock.calls.some(([sql]) => /DROP |TRUNCATE |DELETE FROM our_template_images|UPDATE our_template_images/.test(sql))).toBe(false);
  });
});
