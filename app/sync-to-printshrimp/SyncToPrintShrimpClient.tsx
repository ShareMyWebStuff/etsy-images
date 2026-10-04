'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, LoaderCircle, RefreshCw, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SyncToPrintShrimpData } from '@/lib/printshrimp/sync';

function formatDateTime(value: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function Status({ listing }: { listing: SyncToPrintShrimpData['sections'][number]['listings'][number] }) {
  if (listing.status === 'SYNCED') return <span className="inline-flex items-center gap-2 text-green-700"><CheckCircle2 className="h-4 w-4" /> Synced</span>;
  if (listing.status === 'SYNCING') return <span className="inline-flex items-center gap-2 text-amber-700"><LoaderCircle className="h-4 w-4 animate-spin" /> Syncing</span>;
  if (listing.status === 'FAILED') return <span className="inline-flex items-center gap-2 text-destructive"><XCircle className="h-4 w-4" /> Failed</span>;
  if (listing.status === 'NEEDS_SYNC') return <span className="inline-flex items-center gap-2 text-amber-700"><RefreshCw className="h-4 w-4" /> Needs sync</span>;
  if (listing.status === 'INCOMPLETE') return <span className="inline-flex items-center gap-2 text-destructive"><XCircle className="h-4 w-4" /> Listing incomplete</span>;
  if (listing.status === 'INVALID') return <span className="inline-flex items-center gap-2 text-destructive"><CircleAlert className="h-4 w-4" /> Invalid artwork</span>;
  return <span className="inline-flex items-center gap-2 text-muted-foreground"><CircleAlert className="h-4 w-4" /> Not synced</span>;
}

export function SyncToPrintShrimpClient({ initialData }: { initialData: SyncToPrintShrimpData }) {
  const [data, setData] = useState(initialData);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(sectionId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  async function syncListing(listingId: string) {
    setBusy(listingId);
    setError(null);
    try {
      const response = await fetch('/api/printshrimp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const payload = await response.json() as { data?: SyncToPrintShrimpData; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to sync the listing to PrintShrimp.');
      if (payload.data) setData(payload.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sync the listing to PrintShrimp.');
    } finally {
      setBusy(null);
    }
  }

  async function syncSection(section: SyncToPrintShrimpData['sections'][number]) {
    const listings = section.listings.filter((listing) => listing.canSync);
    for (const listing of listings) await syncListing(listing.id);
  }

  return <div className="grid gap-6">
    <div>
      <h1 className="text-2xl font-semibold">Sync to PrintShrimp</h1>
      <p className="mt-2 text-muted-foreground">Convert and synchronise the six Digital Download print ratios for each complete listing.</p>
    </div>

    {!data.adapter.configured ? <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{data.adapter.message}</div> : null}
    {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}

    {data.sections.map((section) => {
      const isExpanded = expanded.has(section.id);
      return <Card key={section.id}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isExpanded} onClick={() => toggle(section.id)}>
            {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            <CardTitle>{section.sectionName}</CardTitle>
            <span className="text-sm font-normal text-muted-foreground">({section.listings.length} listings)</span>
          </button>
          <Button variant="outline" disabled={busy !== null || !section.listings.some((listing) => listing.canSync)} onClick={() => syncSection(section)}>
            Sync All
          </Button>
        </CardHeader>
        {isExpanded ? <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>Etsy listing ID</TableHead><TableHead>Etsy SKU</TableHead><TableHead>Complete</TableHead><TableHead>Six files</TableHead><TableHead>Source changed</TableHead><TableHead>PrintShrimp status</TableHead><TableHead>Last successful sync</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>{section.listings.map((listing) => <TableRow key={listing.id}>
                <TableCell><div className="font-medium">{listing.listingName}</div>{listing.validationError || listing.lastError ? <div className="mt-1 max-w-sm text-xs text-destructive">{listing.validationError ?? listing.lastError}</div> : null}<div className="mt-1 text-xs text-muted-foreground">{listing.ratioFiles.map((item) => `${item.ratio}: ${item.fileName ?? 'missing'}`).join(' · ')}</div></TableCell>
                <TableCell>{[listing.etsyPrintId ? `Print ${listing.etsyPrintId}` : null, listing.etsyDownloadId ? `Download ${listing.etsyDownloadId}` : null].filter(Boolean).join(' / ') || '—'}</TableCell>
                <TableCell>{listing.etsySku || '—'}</TableCell>
                <TableCell>{listing.isComplete ? 'Yes' : 'No'}</TableCell>
                <TableCell>{listing.hasAllSixFiles ? 'Yes' : 'No'}</TableCell>
                <TableCell>{listing.sourceChanged === null ? 'Not previously synced' : listing.sourceChanged ? 'Yes' : 'No'}</TableCell>
                <TableCell><Status listing={listing} /></TableCell>
                <TableCell>{formatDateTime(listing.lastSuccessfulSyncAt)}</TableCell>
                <TableCell className="text-right"><Button className="w-28" disabled={!listing.canSync || busy !== null} title={listing.syncDisabledReason ?? undefined} onClick={() => syncListing(listing.id)}>{busy === listing.id ? 'Syncing…' : listing.status === 'SYNCED' ? 'Resync' : 'Sync'}</Button></TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div>
        </CardContent> : null}
      </Card>;
    })}
  </div>;
}
