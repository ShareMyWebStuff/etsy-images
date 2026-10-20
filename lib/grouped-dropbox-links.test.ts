import { describe, expect, it, vi } from 'vitest';

import { ensureGroupedDropboxLinks, type GroupedDropboxSourceItem } from '@/lib/dropbox-bundle';

function source(
  id: number,
  name: string,
  values: Partial<GroupedDropboxSourceItem['sourceListing']> = {},
): GroupedDropboxSourceItem {
  return {
    sourceListing: {
      id,
      title: `${name} title`,
      localDirectoryName: name,
      downloadsRevision: 4,
      dropboxRevision: 4,
      dropboxSyncedAt: new Date('2026-10-08T12:00:00Z'),
      subSectionId: 8,
      subSection: { shopSectionId: 3 },
      dropboxBundle: { sharedUrl: `https://www.dropbox.com/${name.toLocaleLowerCase()}` },
      ...values,
    },
  };
}

describe('ensureGroupedDropboxLinks', () => {
  it('creates or refreshes missing and stale Dropbox links while retaining current links', async () => {
    const updateDropbox = vi.fn(async (context: { listingId: string }) => ({
      sharedUrl: `https://www.dropbox.com/generated-${context.listingId}`,
    }));
    const links = await ensureGroupedDropboxLinks('66615491', [
      source(101, 'Clam'),
      source(102, 'Crab', { dropboxBundle: null, dropboxSyncedAt: null }),
      source(103, 'Turtle', { dropboxRevision: 3 }),
    ], updateDropbox);

    expect(links).toEqual([
      { name: 'Clam', url: 'https://www.dropbox.com/clam' },
      { name: 'Crab', url: 'https://www.dropbox.com/generated-102' },
      { name: 'Turtle', url: 'https://www.dropbox.com/generated-103' },
    ]);
    expect(updateDropbox).toHaveBeenCalledTimes(2);
    expect(updateDropbox).toHaveBeenNthCalledWith(1, {
      shopId: '66615491',
      sectionId: '3',
      subSectionId: '8',
      listingId: '102',
    });
  });

  it('identifies the source listing when its Dropbox upload fails', async () => {
    const updateDropbox = vi.fn(async () => {
      throw new Error('Missing artwork file.');
    });

    await expect(ensureGroupedDropboxLinks('66615491', [
      source(102, 'Crab', { dropboxBundle: null, dropboxSyncedAt: null }),
    ], updateDropbox)).rejects.toThrow('Unable to prepare Dropbox for Crab: Missing artwork file.');
  });
});
