import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';

const { migrateTemplateOrientations } = createRequire(import.meta.url)('../scripts/add-template-orientations.cjs') as {
  migrateTemplateOrientations: (client: unknown) => Promise<void>;
};

it('adds both enabled orientation defaults and nullable role variants once without rewriting existing data', async () => {
  const columns = new Set<string>();
  const execute = vi.fn(async (sql: string) => {
    const match = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(sql)!; columns.add(`${match[1]}.${match[2]}`);
  });
  const client = { $executeRawUnsafe: execute,
    $queryRawUnsafe: vi.fn(async (_sql: string, table: string, column: string) => columns.has(`${table}.${column}`) ? [{ COLUMN_NAME: column }] : []) };
  await migrateTemplateOrientations(client); await migrateTemplateOrientations(client);
  expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
    'ALTER TABLE our_categories ADD COLUMN portraitEnabled BOOLEAN NOT NULL DEFAULT TRUE',
    'ALTER TABLE our_categories ADD COLUMN landscapeEnabled BOOLEAN NOT NULL DEFAULT TRUE',
    'ALTER TABLE our_category_image_templates ADD COLUMN orientationVariants JSON NULL',
  ]);
  expect(client.$queryRawUnsafe).toHaveBeenCalledTimes(6);
});
