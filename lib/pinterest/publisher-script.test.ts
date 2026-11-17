import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { parseArguments, runPublisher } = createRequire(import.meta.url)('../../scripts/pinterest-publisher.cjs');
const originalDirectory = process.cwd();
let directory: string;
const run = vi.fn();
const disconnect = vi.fn();
const close = vi.fn();
const createRuntime = vi.fn();

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv('PINTEREST_ENVIRONMENT', 'production');
  directory = await fs.mkdtemp(path.join(tmpdir(), 'pinterest-publisher-test-'));
  run.mockResolvedValue([{ id: 7, ok: true, skipped: true }]);
  createRuntime.mockResolvedValue({
    ssrLoadModule: async (name: string) => name === '/lib/prisma.ts' ? { prisma: { $disconnect: disconnect } } : { processDuePins: run },
    close,
  });
});

afterEach(async () => {
  process.chdir(originalDirectory);
  vi.unstubAllEnvs();
  for (const name of ['last-run.json', 'history.jsonl']) await fs.unlink(path.join(directory, '.tmp', 'pinterest-publisher', name)).catch(() => {});
  for (const name of [path.join(directory, '.tmp', 'pinterest-publisher'), path.join(directory, '.tmp'), directory]) await fs.rmdir(name).catch(() => {});
});

describe('standalone Pinterest publisher launcher', () => {
  it('defaults to a safe dry run and rejects an oversized batch', () => {
    expect(parseArguments([])).toEqual({ help: false, dryRun: true, limit: 5 });
    expect(parseArguments(['--run', '--limit', '3'])).toEqual({ help: false, dryRun: false, limit: 3 });
    expect(() => parseArguments(['--run', '--limit', '6'])).toThrow('between 1 and 5');
    expect(() => parseArguments(['--run', '--dry-run'])).toThrow('Use --dry-run or --run');
  });

  it('opens only a middleware SSR runtime and records a secret-free dry-run summary', async () => {
    const summary = await runPublisher({ argv: ['--dry-run'], projectRoot: directory, createRuntime });
    expect(createRuntime).toHaveBeenCalledWith(expect.objectContaining({
      configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null },
    }));
    expect(run).toHaveBeenCalledWith(5, { dryRun: true });
    expect(summary).toMatchObject({ mode: 'dry-run', considered: 1, published: 0, skipped: 1, pinIds: [7] });
    expect(JSON.parse(await fs.readFile(path.join(directory, '.tmp', 'pinterest-publisher', 'last-run.json'), 'utf8'))).toEqual(summary);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('publishes only when explicitly requested and records counts without raw errors or credentials', async () => {
    run.mockResolvedValue([{ id: 7, ok: true }, { id: 8, ok: false, deferred: true, error: 'private secret details' }]);
    const summary = await runPublisher({ argv: ['--run', '--limit', '2'], projectRoot: directory, createRuntime });
    expect(run).toHaveBeenCalledWith(2, { dryRun: false });
    expect(summary).toMatchObject({ published: 1, deferred: 1, failed: 0 });
    expect(await fs.readFile(path.join(directory, '.tmp', 'pinterest-publisher', 'history.jsonl'), 'utf8')).not.toContain('secret');
  });

  it('rejects a sandbox configuration before opening the runtime', async () => {
    vi.stubEnv('PINTEREST_ENVIRONMENT', 'sandbox');
    await expect(runPublisher({ argv: ['--run'], projectRoot: directory, createRuntime })).rejects.toThrow('only runs in production');
    expect(createRuntime).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('closes the database and runtime if publishing fails', async () => {
    run.mockRejectedValue(new Error('Runtime unavailable'));
    await expect(runPublisher({ argv: ['--run'], projectRoot: directory, createRuntime })).rejects.toThrow('Runtime unavailable');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
