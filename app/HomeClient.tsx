'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ShopSummaryRow } from '@/lib/etsy-sync';
import { cn } from '@/lib/utils';

type SyncCounts = {
  shops: number;
};

type SyncResponse = {
  rows?: ShopSummaryRow[];
  error?: string;
  sync?: {
    counts?: SyncCounts;
  };
};

type CreateLocalDirectoryResponse = {
  rows?: ShopSummaryRow[];
  error?: string;
};

type HomeClientProps = {
  initialRows: ShopSummaryRow[];
};

export function HomeClient({ initialRows }: HomeClientProps) {
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [creatingShopId, setCreatingShopId] = useState<string | null>(null);
  const [syncCounts, setSyncCounts] = useState<SyncCounts | null>(null);

  async function syncEtsy() {
    setError(null);
    setSyncing(true);

    try {
      const response = await fetch('/api/etsy/sync', {
        method: 'POST',
      });
      const payload = (await response.json()) as SyncResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to sync Etsy data.');
      }

      setRows(payload.rows ?? []);
      setSyncCounts(payload.sync?.counts ?? null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to sync Etsy data.');
    } finally {
      setSyncing(false);
    }
  }

  async function createLocalDirectory(shopId: string) {
    setError(null);
    setCreatingShopId(shopId);

    try {
      const response = await fetch('/api/shops/local-directory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shopId }),
      });
      const payload = (await response.json()) as CreateLocalDirectoryResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to create local shop directory.');
      }

      setRows(payload.rows ?? []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create local shop directory.');
    } finally {
      setCreatingShopId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
        <CardTitle>Shops</CardTitle>
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={syncEtsy}
          disabled={syncing}
          aria-label="Sync Etsy data"
          title="Sync Etsy data"
        >
          <RefreshCw className={cn('h-4 w-4', syncing ? 'animate-spin' : null)} aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent>
        {error ? <p className="mb-4 text-sm font-medium text-destructive">{error}</p> : null}
        {syncCounts ? (
          <p className="mb-4 text-sm text-muted-foreground">
            Synced {syncCounts.shops} shops.
          </p>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shop Name</TableHead>
              <TableHead className="text-right">No of Sections</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.shopName}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.noOfSections}</TableCell>
                  <TableCell className="text-right">
                    {row.hasLocalDirectory ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/shops?shopId=${encodeURIComponent(row.id)}`}>Goto Sections -&gt;</Link>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => createLocalDirectory(row.id)}
                        disabled={creatingShopId !== null}
                      >
                        {creatingShopId === row.id ? 'Creating...' : 'Create Locally ->'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No shops synced.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
