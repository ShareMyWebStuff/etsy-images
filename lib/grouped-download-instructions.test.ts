import { describe, expect, it } from 'vitest';

import { createGroupedLinkedPdf } from '@/lib/dropbox-bundle';

describe('grouped download instructions', () => {
  it('creates a branded multi-page PDF with a separate link for every item', async () => {
    const links = Array.from({ length: 7 }, (_, index) => ({
      name: `Artwork ${index + 1}`,
      url: `https://www.dropbox.com/artwork-${index + 1}`,
    }));

    const pdf = await createGroupedLinkedPdf('Woodland Animals Set', links);
    const source = pdf.toString('latin1');

    expect(source.startsWith('%PDF-')).toBe(true);
    expect(source.match(/\/Type \/Page\b/g)).toHaveLength(2);
    for (const link of links) expect(source).toContain(`/URI (${link.url})`);
  });
});
