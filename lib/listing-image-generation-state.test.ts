import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $executeRaw: mocks.execute, $queryRaw: mocks.query } }));

import {
  invalidateListingImageGeneration,
  markListingImageGenerationComplete,
  readListingImageGenerationState,
} from '@/lib/listing-image-generation-state';

beforeEach(() => vi.clearAllMocks());

describe('local image generation revisions', () => {
  it('invalidates only the affected listings and leaves Etsy synchronization flags alone', async () => {
    await invalidateListingImageGeneration([42, 51, 42]);
    const query = mocks.execute.mock.calls[0][0];
    expect(query.values).toEqual([42, 51]);
    expect(query.sql).toMatch(/listingImagesRevision = listingImagesRevision \+ 1/);
    expect(query.sql).not.toMatch(/imagesChanged|lastLocalChangeAt|updatedAt|overviewGenerationFingerprint/);
    await invalidateListingImageGeneration([]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('uses the dependency mutation transaction when supplied', async () => {
    const execute = vi.fn();
    await invalidateListingImageGeneration([9], { $executeRaw: execute });
    expect(execute).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reports pending local work independently of synchronization', async () => {
    mocks.query.mockResolvedValueOnce([{ listingImagesRevision: 4, listingImagesGeneratedRevision: 3 }]);
    expect(await readListingImageGenerationState(9)).toEqual({ revision: 4, generatedRevision: 3, needsRegeneration: true });
    mocks.query.mockResolvedValueOnce([{ listingImagesRevision: 4, listingImagesGeneratedRevision: 4 }]);
    expect((await readListingImageGenerationState(9)).needsRegeneration).toBe(false);
  });

  it('requires current outputs for every remaining template before completing the captured revision', async () => {
    await markListingImageGenerationComplete(9, 3);
    const query = mocks.execute.mock.calls[0][0];
    expect(query.sql).toMatch(/listing\.listingImagesRevision = \?/);
    expect(query.sql).toMatch(/template\.categoryId = listing\.ourCategoryId/);
    expect(query.sql).toMatch(/image\.templateGenerationRevision = \?/);
    expect(query.sql.match(/NOT EXISTS/g)).toHaveLength(2);
    expect(query.values).toEqual([3, 9, 3, 3]);
  });
});
