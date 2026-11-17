import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.read, $executeRaw: mocks.write } }));

import { etsyPersonalisationFingerprint, loadEtsyPersonalisationSyncStates, recordEtsyPersonalisationSync } from './etsy-personalisation-sync-state';

const both = { customisePrints: true, customTop: true, customBottom: true };
beforeEach(() => vi.resetAllMocks());

describe('Etsy personalisation sync state', () => {
  it('tracks both the exact questions and the existing Etsy listing ID', () => {
    const fingerprint = etsyPersonalisationFingerprint('111', both);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(etsyPersonalisationFingerprint('111', { ...both })).toBe(fingerprint);
    expect(etsyPersonalisationFingerprint('222', both)).not.toBe(fingerprint);
    expect(etsyPersonalisationFingerprint('111', { ...both, customBottom: false })).not.toBe(fingerprint);
    expect(etsyPersonalisationFingerprint('111', { ...both, customisePrints: false })).not.toBe(fingerprint);
  });

  it('loads independent physical sync markers without querying empty sections', async () => {
    expect(await loadEtsyPersonalisationSyncStates([])).toEqual(new Map());
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue([{ id: 518, etsyPrintPersonalisationFingerprint: 'print', etsyCustomisedPersonalisationFingerprint: null }]);
    expect(await loadEtsyPersonalisationSyncStates([518, 518])).toEqual(new Map([[518, { print: 'print', customised: null }]]));
  });

  it.each(['print', 'customised'] as const)('records only the still-linked %s Etsy listing', async (variant) => {
    mocks.write.mockResolvedValue(1);
    await recordEtsyPersonalisationSync(518, variant, '111', 'a'.repeat(64));
    const [sql, fingerprint, listingId, remoteId] = mocks.write.mock.calls[0];
    expect(sql.join('')).toContain(variant === 'print' ? 'etsyPrintPersonalisationFingerprint' : 'etsyCustomisedPersonalisationFingerprint');
    expect([fingerprint, listingId, remoteId]).toEqual(['a'.repeat(64), 518, '111']);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each(['print', 'customised'] as const)('accepts an unchanged %s marker on a repeat sync', async (variant) => {
    mocks.write.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    mocks.read.mockResolvedValue([{ id: 518 }]);
    await recordEtsyPersonalisationSync(518, variant, '111', 'a'.repeat(64));
    await expect(recordEtsyPersonalisationSync(518, variant, '111', 'a'.repeat(64))).resolves.toBeUndefined();
    expect(mocks.read.mock.calls[0].slice(1)).toEqual([518, '111', 'a'.repeat(64)]);
  });

  it('rejects a replaced or deleted Etsy link instead of marking the new listing as synced', async () => {
    mocks.write.mockResolvedValue(0);
    mocks.read.mockResolvedValue([]);
    await expect(recordEtsyPersonalisationSync(518, 'print', 'old-id', 'a'.repeat(64))).rejects.toThrow('link changed');
  });
});
