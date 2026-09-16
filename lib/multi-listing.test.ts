import { describe, expect, it } from 'vitest';
import { hasCompleteEtsyImageRanks } from '@/lib/multi-listing';

describe('multi-listing Etsy image completeness', () => {
  it('requires every active rank from 1 through 10', () => {
    const complete = Array.from({ length: 10 }, (_, index) => ({
      rank: index + 1,
      localFileName: `image_${index + 1}.jpg`,
    }));
    expect(hasCompleteEtsyImageRanks(complete)).toBe(true);
    expect(hasCompleteEtsyImageRanks(complete.filter(({ rank }) => rank !== 7))).toBe(false);
    expect(hasCompleteEtsyImageRanks(complete.map((image) =>
      image.rank === 7 ? { ...image, localFileName: null } : image
    ))).toBe(false);
    expect(hasCompleteEtsyImageRanks([...complete, { rank: 7, localFileName: 'duplicate.jpg' }])).toBe(false);
  });

  it('ignores preserved legacy image rows above rank 10', () => {
    const images = Array.from({ length: 18 }, (_, index) => ({
      rank: index + 1,
      localFileName: `image_${index + 1}.jpg`,
    }));
    expect(hasCompleteEtsyImageRanks(images)).toBe(true);
  });
});
