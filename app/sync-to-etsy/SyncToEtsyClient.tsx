'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SyncToEtsyData } from '@/lib/sync-to-etsy';

type PublishTarget = { id: string; listingName: string };
type DeleteTarget = { id: string; listingName: string };
type SyncAllProgress = {
  sectionName: string;
  completed: number;
  total: number;
  status: 'running' | 'complete' | 'error';
  currentListingName: string;
  message?: string;
};

type SyncToEtsyClientProps = {
  initialData: SyncToEtsyData;
  mode?: 'sync' | 'publish';
};

export function SyncToEtsyClient({ initialData, mode = 'sync' }: SyncToEtsyClientProps) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<PublishTarget | null>(null);
  const [inactiveTarget, setInactiveTarget] = useState<PublishTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [syncAllProgress, setSyncAllProgress] = useState<SyncAllProgress | null>(null);
  const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(() => new Set());

  function toggleSection(sectionId: string) {
    setExpandedSectionIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  async function runAction(url: string, payload: object, key: string, fallbackError: string, method = 'POST') {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { data?: SyncToEtsyData; error?: string };
      if (!response.ok) throw new Error(result.error ?? fallbackError);
      if (result.data) setData(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallbackError);
    } finally {
      setBusy(null);
    }
  }

  async function publishConfirmed() {
    if (!publishTarget) return;
    const target = publishTarget;
    setPublishTarget(null);
    await runAction('/api/etsy/publish', { listingId: target.id }, `publish-${target.id}`, 'Unable to publish listing.');
  }

  async function deleteConfirmed() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await runAction('/api/etsy/delete', { listingId: target.id }, `delete-${target.id}`, 'Unable to delete listing from Etsy.');
  }

  async function inactiveConfirmed() {
    if (!inactiveTarget) return;
    const target = inactiveTarget;
    setInactiveTarget(null);
    await runAction('/api/etsy/publish', { listingId: target.id, action: 'inactive' }, `inactive-${target.id}`, 'Unable to make listing inactive.');
  }

  async function syncAllSection(section: SyncToEtsyData['sections'][number]) {
    const listings = section.listings.filter((listing) => listing.canSync);
    if (listings.length === 0) return;

    const busyKey = `sync-all-${section.id}`;
    setBusy(busyKey);
    setError(null);
    setSyncAllProgress({
      sectionName: section.sectionName,
      completed: 1,
      total: listings.length,
      status: 'running',
      currentListingName: listings[0].localDirectoryName ?? listings[0].listingName,
    });

    try {
      for (let index = 0; index < listings.length; index += 1) {
        setSyncAllProgress({
          sectionName: section.sectionName,
          completed: index + 1,
          total: listings.length,
          status: 'running',
          currentListingName: listings[index].localDirectoryName ?? listings[index].listingName,
        });
        const response = await fetch('/api/etsy/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: listings[index].id }),
        });
        const result = (await response.json()) as { data?: SyncToEtsyData; error?: string };
        if (!response.ok) throw new Error(result.error ?? `Unable to sync ${listings[index].listingName}.`);
        if (result.data) setData(result.data);
        if (index + 1 === listings.length) {
          setSyncAllProgress({
            sectionName: section.sectionName,
            completed: listings.length,
            total: listings.length,
            status: 'complete',
            currentListingName: listings[index].localDirectoryName ?? listings[index].listingName,
          });
        }

        if (index + 1 < listings.length) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 60_000));
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to sync all listings.';
      setError(message);
      setSyncAllProgress((progress) => progress ? { ...progress, status: 'error', message } : null);
    } finally {
      setBusy(null);
    }
  }

  return <>
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{mode === 'sync' ? 'Sync to Etsy' : 'Publish to Etsy'}</h1>
        <p className="mt-2 text-muted-foreground">
          {mode === 'sync'
            ? 'From this screen you can sync the selected products to Etsy as draft listings.'
            : 'From this screen you can publish your synced draft listings on Etsy.'}
        </p>
      </div>
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      {data.sections.map((section) => {
        const isExpanded = expandedSectionIds.has(section.id);
        const showSubject = mode === 'publish' && section.showSubject;
        const visibleListings = showSubject
          ? [...section.listings].sort((first, second) =>
              first.subjectName.localeCompare(second.subjectName, undefined, { sensitivity: 'base' })
              || first.listingName.localeCompare(second.listingName, undefined, { sensitivity: 'base' })
            )
          : section.listings;
        return <Card key={section.id}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-expanded={isExpanded}
            aria-controls={`section-listings-${section.id}`}
            onClick={() => toggleSection(section.id)}
          >
            {isExpanded
              ? <ChevronDown className="h-5 w-5 shrink-0" aria-hidden="true" />
              : <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />}
            <CardTitle>{section.sectionName}</CardTitle>
            <span className="text-sm font-normal text-muted-foreground">
              ({section.listings.length} listing{section.listings.length === 1 ? '' : 's'})
            </span>
          </button>
          {mode === 'publish' ? <Button
            type="button"
            variant="outline"
            onClick={() => runAction('/api/etsy/check-statuses', { sectionId: section.id }, `check-statuses-${section.id}`, 'Unable to check Etsy listing statuses.')}
            disabled={busy !== null || !section.listings.some((listing) => listing.hasEtsyListing)}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === `check-statuses-${section.id}` ? 'animate-spin' : ''}`} aria-hidden="true" />
            {busy === `check-statuses-${section.id}` ? 'Checking...' : 'Check statuses'}
          </Button> : null}
          {mode === 'sync' ? <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`Refresh Etsy section for ${section.sectionName} listings`}
              title={section.hasEtsySection ? 'Refresh listing section assignments on Etsy' : 'Add this section to Etsy first'}
              onClick={() => runAction('/api/etsy/shop-sections', { sectionId: section.id }, `refresh-section-${section.id}`, 'Unable to refresh Etsy section assignments.', 'PATCH')}
              disabled={!section.hasEtsySection || busy !== null}
            >
              <RefreshCw className={`h-4 w-4 ${busy === `refresh-section-${section.id}` ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
            {section.listings.some((listing) => listing.canSync) ? (
              <Button
                variant="outline"
                onClick={() => syncAllSection(section)}
                disabled={busy !== null || !section.listings.some((listing) => listing.canSync)}
              >
                {busy === `sync-all-${section.id}` ? 'Syncing...' : 'Sync All'}
              </Button>
            ) : null}
            {section.hasEtsySection && !section.hasSyncedListings ? (
              <Button
                variant="destructive"
                onClick={() => runAction('/api/etsy/shop-sections', { sectionId: section.id }, `delete-section-${section.id}`, 'Unable to delete Etsy section.', 'DELETE')}
                disabled={busy !== null}
              >
                {busy === `delete-section-${section.id}` ? 'Deleting...' : 'Delete from Etsy'}
              </Button>
            ) : (
              <Button
                onClick={() => runAction('/api/etsy/upload', { sectionId: section.id }, `section-${section.id}`, 'Unable to create Etsy section.')}
                disabled={section.hasEtsySection || busy !== null}
              >
                {busy === `section-${section.id}` ? 'Creating...' : section.hasEtsySection ? 'Added to Etsy' : `Add ${section.sectionName} to Etsy`}
              </Button>
            )}
          </div> : null}
        </CardHeader>
        {isExpanded ? <CardContent id={`section-listings-${section.id}`}>
          <Table><TableHeader><TableRow>{showSubject ? <TableHead>Subject</TableHead> : null}<TableHead>Listing Name</TableHead><TableHead>Etsy Product</TableHead><TableHead>Etsy Category</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
            {visibleListings.map((listing) => <TableRow key={listing.id}>
              {showSubject ? <TableCell>{listing.subjectName}</TableCell> : null}
              <TableCell className="font-medium">{listing.listingName}</TableCell>
              <TableCell>{listing.etsyListingMode === 'both'
                ? 'Print + Digital (2 listings)'
                : listing.etsyListingMode === 'download' ? 'Digital' : 'Print'}</TableCell>
              <TableCell>{listing.etsyCategory}</TableCell>
              <TableCell>{!listing.isComplete ? <span className="inline-flex items-center gap-2 text-destructive"><XCircle className="h-4 w-4" /> Listing incomplete</span> : listing.pendingChanges.length > 0 ? <span className="inline-flex items-center gap-2 text-amber-600"><XCircle className="h-4 w-4" /> Needs sync: {listing.pendingChanges.join(', ')}</span> : listing.isPublished ? <span className="inline-flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" /> Published</span> : listing.hasActiveEtsyListing ? <span className="inline-flex items-center gap-2 text-amber-600"><XCircle className="h-4 w-4" /> Partially published</span> : listing.isInactive ? <span className="inline-flex items-center gap-2 text-amber-600"><XCircle className="h-4 w-4" /> Inactive</span> : listing.isSynced ? <span className="inline-flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" /> Synced</span> : <span className="inline-flex items-center gap-2 text-destructive"><XCircle className="h-4 w-4" /> Not synced</span>}</TableCell>
              <TableCell className="text-right"><div className="flex justify-end gap-2">
                {mode === 'sync' && (!listing.hasEtsyListing || listing.canSync) ? <Button className="w-36" title={listing.syncDisabledReason ?? undefined} onClick={() => runAction('/api/etsy/upload', { listingId: listing.id }, `listing-${listing.id}`, 'Unable to sync listing.')} disabled={!listing.canSync || busy !== null}>{busy === `listing-${listing.id}` ? 'Syncing...' : 'Sync'}</Button> : null}
                {mode === 'sync' && listing.hasEtsyListing ? <Button className="w-36" variant="destructive" onClick={() => setDeleteTarget({ id: listing.id, listingName: listing.listingName })} disabled={listing.hasActiveEtsyListing || busy !== null}>{busy === `delete-${listing.id}` ? 'Deleting...' : 'Delete from Etsy'}</Button> : null}
                {mode === 'publish' && !listing.isPublished ? <Button className="w-36" onClick={() => setPublishTarget({ id: listing.id, listingName: listing.listingName })} disabled={!listing.hasEtsyListing || busy !== null}>{busy === `publish-${listing.id}` ? 'Publishing...' : 'Publish'}</Button> : null}
                {mode === 'publish' && listing.isPublished ? <Button className="w-36" variant="outline" onClick={() => setInactiveTarget({ id: listing.id, listingName: listing.listingName })} disabled={busy !== null}>{busy === `inactive-${listing.id}` ? 'Updating...' : 'Make Inactive'}</Button> : null}
              </div></TableCell>
            </TableRow>)}
          </TableBody></Table>
        </CardContent> : null}
      </Card>;
      })}
    </div>

    <Dialog open={syncAllProgress !== null} onOpenChange={(open) => { if (!open && syncAllProgress?.status !== 'running') setSyncAllProgress(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Sync All — {syncAllProgress?.sectionName}</DialogTitle></DialogHeader>
        <div className="py-4 text-center">
          <p className="text-3xl font-semibold tabular-nums">{syncAllProgress?.completed ?? 0} of {syncAllProgress?.total ?? 0}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {syncAllProgress?.status === 'running'
              ? `Syncing ${syncAllProgress.currentListingName}`
              : syncAllProgress?.status === 'complete'
                ? 'All available listings have been synced.'
                : syncAllProgress?.message}
          </p>
          {syncAllProgress?.status === 'running' ? <p className="mt-1 text-xs text-muted-foreground">There is a one-minute pause between each listing.</p> : null}
        </div>
        {syncAllProgress?.status !== 'running' ? <DialogFooter>
          <Button type="button" onClick={() => setSyncAllProgress(null)}>Close</Button>
        </DialogFooter> : null}
      </DialogContent>
    </Dialog>

    {mode === 'publish' ? <Dialog open={publishTarget !== null} onOpenChange={(open) => { if (!open && busy === null) setPublishTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish listing?</DialogTitle></DialogHeader>
        <p>Do you want to publish {publishTarget?.listingName} to Etsy?</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setPublishTarget(null)}>No</Button>
          <Button type="button" onClick={publishConfirmed}>Yes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog> : null}

    {mode === 'publish' ? <Dialog open={inactiveTarget !== null} onOpenChange={(open) => { if (!open && busy === null) setInactiveTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Make listing inactive?</DialogTitle></DialogHeader>
        <p>Are you sure {inactiveTarget?.listingName} should be made inactive?</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setInactiveTarget(null)}>Cancel</Button>
          <Button type="button" onClick={inactiveConfirmed}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog> : null}

    {mode === 'sync' ? <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && busy === null) setDeleteTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete listing from Etsy?</DialogTitle></DialogHeader>
        <p>Are you sure you want to delete this listing from Etsy?</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={deleteConfirmed}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog> : null}
  </>;
}
