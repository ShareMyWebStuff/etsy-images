import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PinterestEnvironment } from './types';

type AccountBoardExclusions = {
  accountId: string;
  environment: PinterestEnvironment;
  excludedSandboxBoardIds: string[];
};

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

/** Reload on every operation so board repairs take effect without restarting Next.js. */
export async function loadExcludedSandboxBoardIds(accountId: string | null | undefined, environment: PinterestEnvironment): Promise<Set<string>> {
  let contents: string;
  try {
    contents = await readFile(path.join(process.cwd(), '.pinterest-board-environments.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw new Error('The Pinterest board environment registry could not be read. Restore access before syncing or using boards.');
  }

  let accounts: AccountBoardExclusions[];
  try {
    const registry: unknown = JSON.parse(contents);
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new Error();
    const value = registry as { schemaVersion?: unknown; accounts?: unknown };
    if (value.schemaVersion !== 1 || !Array.isArray(value.accounts)) throw new Error();
    const seen = new Set<string>();
    accounts = value.accounts.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error();
      const account = entry as Partial<AccountBoardExclusions>;
      if (!nonemptyString(account.accountId)
        || (account.environment !== 'production' && account.environment !== 'sandbox')
        || !Array.isArray(account.excludedSandboxBoardIds)
        || !account.excludedSandboxBoardIds.every(nonemptyString)) throw new Error();
      const identity = JSON.stringify([account.accountId, account.environment]);
      if (seen.has(identity)) throw new Error();
      seen.add(identity);
      return account as AccountBoardExclusions;
    });
  } catch {
    throw new Error('The Pinterest board environment registry is invalid. Restore a valid schemaVersion 1 registry before syncing or using boards.');
  }

  if (environment !== 'production' || !accountId) return new Set();
  return new Set(accounts.find((account) => account.accountId === accountId && account.environment === environment)?.excludedSandboxBoardIds ?? []);
}
