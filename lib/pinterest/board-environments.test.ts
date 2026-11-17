import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, default: { ...actual, readFile: mocks.read }, readFile: mocks.read };
});
import { loadExcludedSandboxBoardIds } from './board-environments';

const entry = { accountId: '856387822800767839', environment: 'production', excludedSandboxBoardIds: ['856387754082961526', '856387754082962137'] };
function registry(accounts: unknown[] = [entry]) { return JSON.stringify({ schemaVersion: 1, accounts }); }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(registry());
});

describe('Pinterest board environment registry', () => {
  it('loads only production exclusions for the exact connected account', async () => {
    mocks.read.mockResolvedValue(registry([entry, { ...entry, accountId: 'another-account', excludedSandboxBoardIds: ['other-board'] }]));
    await expect(loadExcludedSandboxBoardIds(entry.accountId, 'production')).resolves.toEqual(new Set(entry.excludedSandboxBoardIds));
    expect(mocks.read).toHaveBeenCalledWith(path.join(process.cwd(), '.pinterest-board-environments.json'), 'utf8');
    await expect(loadExcludedSandboxBoardIds('another-account', 'production')).resolves.toEqual(new Set(['other-board']));
    await expect(loadExcludedSandboxBoardIds('unlisted-account', 'production')).resolves.toEqual(new Set());
    await expect(loadExcludedSandboxBoardIds(null, 'production')).resolves.toEqual(new Set());
    await expect(loadExcludedSandboxBoardIds(entry.accountId, 'sandbox')).resolves.toEqual(new Set());
  });

  it('reloads the file on each call so a repair takes effect without restart', async () => {
    mocks.read.mockResolvedValueOnce(registry()).mockResolvedValueOnce(registry([{ ...entry, excludedSandboxBoardIds: ['fresh-exclusion'] }]));
    await expect(loadExcludedSandboxBoardIds(entry.accountId, 'production')).resolves.toEqual(new Set(entry.excludedSandboxBoardIds));
    await expect(loadExcludedSandboxBoardIds(entry.accountId, 'production')).resolves.toEqual(new Set(['fresh-exclusion']));
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('treats an absent registry as no exclusions', async () => {
    mocks.read.mockRejectedValue(Object.assign(new Error('File missing'), { code: 'ENOENT' }));
    await expect(loadExcludedSandboxBoardIds(entry.accountId, 'production')).resolves.toEqual(new Set());
  });

  it('rejects unreadable files without disclosing filesystem details', async () => {
    mocks.read.mockRejectedValue(Object.assign(new Error('private-path'), { code: 'EACCES' }));
    await expect(loadExcludedSandboxBoardIds(entry.accountId, 'production')).rejects.toThrow('registry could not be read');
    await expect(loadExcludedSandboxBoardIds(entry.accountId, 'production')).rejects.not.toThrow('private-path');
  });

  it.each([
    'not JSON', 'null', '[]', '{}', JSON.stringify({ schemaVersion: 2, accounts: [] }),
    JSON.stringify({ schemaVersion: 1, accounts: {} }), registry([null]),
    registry([{ ...entry, accountId: '' }]), registry([{ ...entry, accountId: ' account ' }]),
    registry([{ ...entry, environment: 'unknown' }]), registry([{ ...entry, excludedSandboxBoardIds: 'one-board' }]),
    registry([{ ...entry, excludedSandboxBoardIds: [123] }]), registry([{ ...entry, excludedSandboxBoardIds: [''] }]),
    registry([{ ...entry, excludedSandboxBoardIds: [' board '] }]), registry([entry, entry]),
  ])('fails closed for malformed registry %s', async (contents) => {
    mocks.read.mockResolvedValue(contents);
    await expect(loadExcludedSandboxBoardIds(entry.accountId, 'production')).rejects.toThrow('registry is invalid');
  });

  it('validates the entire registry even when the connected account has no entry', async () => {
    mocks.read.mockResolvedValue(registry([entry, { accountId: 'broken-account' }]));
    await expect(loadExcludedSandboxBoardIds('unlisted-account', 'production')).rejects.toThrow('registry is invalid');
  });
});
