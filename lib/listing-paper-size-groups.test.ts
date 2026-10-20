import { describe, expect, it } from 'vitest';

import { smallestPaperSizePerAspectRatio } from '@/lib/listing-paper-size-groups';

describe('smallest paper size per aspect ratio', () => {
  it('keeps only the smallest enabled size in each aspect-ratio group', () => {
    const sizes = [
      { key: 'a3', label: 'A3' },
      { key: 'a5', label: 'A5' },
      { key: 'a4', label: 'A4' },
      { key: '20x28', label: '20 x 28' },
      { key: '5x7', label: '5 x 7' },
      { key: '18x24', label: '18 x 24' },
      { key: '6x8', label: '6 x 8' },
      { key: '11x14', label: '11 x 14' },
    ];

    expect(smallestPaperSizePerAspectRatio(sizes).map(({ key }) => key)).toEqual([
      'a5',
      '5x7',
      '6x8',
      '11x14',
    ]);
  });

  it('uses the smallest available enabled size when the canonical smallest is absent', () => {
    expect(smallestPaperSizePerAspectRatio([
      { key: 'a3' },
      { key: 'a4' },
      { key: '16x24' },
      { key: '24x36' },
    ]).map(({ key }) => key)).toEqual(['a4', '16x24']);
  });
});
