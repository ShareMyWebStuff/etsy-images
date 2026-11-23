'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SyncToEtsyData } from '@/lib/sync-to-etsy';
import type { EtsySyncVariant } from '@/lib/etsy-sync-images';
import { summarizeSectionPublication } from '@/lib/etsy-section-publication';

type PublishTarget = { id: string; listingName: string; variants: EtsySyncVariant[]; etsyCategory: string };
type DeleteTarget = { id: string; listingName: string };

type SectionPublishTarget = { shopId: string; sectionId: string; sectionName: string; view: 'local' | 'etsy' };
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
  shops: Array<{ id: string; name: string }>;
};

export function SyncToEtsyClient({ initialData, mode = 'sync', shops }: SyncToEtsyClientProps) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [refreshing, startRefresh] = useTransition();
  const [selectedShopId, setSelectedShopId] = useState(shops[0]?.id ?? '');
  const [syncView, setSyncView] = useState<'local' | 'etsy'>('local');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<(PublishTarget & { isInactive: boolean }) | null>(null);
  const [inactiveTarget, setInactiveTarget] = useState<PublishTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [syncAllProgress, setSyncAllProgress] = useState<SyncAllProgress | null>(null);
  const [publishSectionTarget, setPublishSectionTarget] = useState<SectionPublishTarget | null>(null);
  const [publishSectionQuantity, setPublishSectionQuantity] = useState('1');
  const [publishSectionProgress, setPublishSectionProgress] = useState<SyncAllProgress | null>(null);
  const publishQuantityId = useId();
  const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(() => new Set());
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const actionsDisabled = busy !== null || refreshing;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => { setPublishSectionTarget(null); }, [selectedShopId, syncView]);

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  function toggleSection(sectionId: string) {
    setExpandedSectionIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  async function runAction(url: string, payload: object, key: string, fallbackError: string, method = 'POST') {
    if (actionLock.current || refreshing) return;
    actionLock.current = true;
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
      actionLock.current = false;
      setBusy(null);
    }
  }

  async function publishConfirmed() {
    if (!publishTarget) return;
    const target = publishTarget;
    setPublishTarget(null);
    await runAction('/api/etsy/publish', { listingId: target.id, variants: target.variants }, `publish-${target.id}-${target.variants.join('-')}`, target.isInactive ? 'Unable to re-activate listing.' : 'Unable to publish listing.');
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
    await runAction('/api/etsy/publish', { listingId: target.id, action: 'inactive', variants: target.variants }, `inactive-${target.id}-${target.variants.join('-')}`, 'Unable to make listing inactive.');
  }

  async function syncAllSection(
    section: SyncToEtsyData['sections'][number] | SyncToEtsyData['localSections'][number],
  ) {
    if (actionLock.current || refreshing) return;
    const listings = section.listings.filter((listing) => listing.canSync);
    if (listings.length === 0) return;

    actionLock.current = true;
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
          body: JSON.stringify({ listingId: listings[index].id, variants: listings[index].syncVariants }),
        });
        const result = (await response.json()) as { data?: SyncToEtsyData; error?: string };
        if (!response.ok) {
          throw new Error(`${listings[index].listingName} (${listings[index].etsyCategory}): ${result.error ?? 'Unable to sync listing.'}`);
        }
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
          await new Promise<void>((resolve) => window.setTimeout(resolve, 10_000));
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to sync all listings.';
      setError(message);
      setSyncAllProgress((progress) => progress ? { ...progress, status: 'error', message } : null);
    } finally {
      actionLock.current = false;
      setBusy(null);
    }
  }

  const showingLocalView = syncView === 'local';
  const displayedSections = (showingLocalView ? data.localSections : data.sections)
    .filter((section) => section.shopId === selectedShopId);
  const sectionToPublish = publishSectionTarget?.shopId === selectedShopId && publishSectionTarget.view === syncView
    ? displayedSections.find((section) => section.id === publishSectionTarget.sectionId) : undefined;
  const sectionPublishTargets = sectionToPublish ? summarizeSectionPublication(sectionToPublish.listings).targets : [];
  const sectionPublishCount = publishSectionQuantity.trim() === '' ? NaN : Number(publishSectionQuantity);
  const validSectionPublishCount = Number.isSafeInteger(sectionPublishCount)
    && sectionPublishCount >= 1 && sectionPublishCount <= sectionPublishTargets.length;
  const selectedSectionPublishTargets = validSectionPublishCount ? sectionPublishTargets.slice(0, sectionPublishCount) : [];

  async function publishSectionConfirmed() {
    if (actionLock.current || refreshing || !sectionToPublish || !validSectionPublishCount) return;
    const section = sectionToPublish, targets = selectedSectionPublishTargets;
    actionLock.current = true;
    setPublishSectionTarget(null);
    setBusy(`publish-section-${section.id}`);
    setError(null);
    setPublishSectionProgress({ sectionName: section.sectionName, completed: 0, total: targets.length,
      status: 'running', currentListingName: targets[0].listingName });
    let completed = 0, needsRefresh = false;
    try {
      for (const target of targets) {
        if (!mounted.current) return;
        setPublishSectionProgress({ sectionName: section.sectionName, completed, total: targets.length,
          status: 'running', currentListingName: target.listingName });
        const response = await fetch('/api/etsy/publish', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: target.id, variants: target.variants, requireSyncedDrafts: true }),
        });
        const result = await response.json().catch(() => null) as { data?: SyncToEtsyData; error?: string } | null;
        if (!response.ok) throw new Error(`${target.listingName} (${target.etsyCategory}): ${result?.error ?? 'Unable to publish listing.'}`);
        completed++;
        if (!mounted.current) return;
        if (result?.data) setData(result.data); else needsRefresh = true;
        setPublishSectionProgress({ sectionName: section.sectionName, completed, total: targets.length,
          status: completed === targets.length ? 'complete' : 'running', currentListingName: target.listingName });
      }
    } catch (caught) {
      if (!mounted.current) return;
      const message = caught instanceof Error ? caught.message : 'Unable to publish this section.';
      setError(message);
      setPublishSectionProgress((progress) => progress ? { ...progress, completed, status: 'error', message } : null);
      needsRefresh = true;
    } finally {
      actionLock.current = false;
      if (mounted.current) {
        setBusy(null);
        if (needsRefresh) startRefresh(() => router.refresh());
      }
    }
  }

  return <>
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{mode === 'sync' ? 'Sync to Etsy' : 'Publish to Etsy'}</h1>
        <p className="mt-2 text-muted-foreground">
          {mode === 'sync'
            ? showingLocalView
              ? 'Local sections are grouped by their template-assigned Etsy sections. Expand a section to sync or delete individual listings.'
              : 'Categories come from each listing’s assigned template. Add any missing category to Etsy, then sync its listings.'
            : 'Choose a shop to publish synced drafts or re-activate inactive listings on Etsy. Use Local View or Etsy View to group listings by their section names.'}
        </p>
      </div>
      <label className="grid w-full max-w-sm gap-2 text-sm font-medium" htmlFor="etsy-shop">
        Shop
        <select
          id="etsy-shop"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={selectedShopId}
          disabled={actionsDisabled || shops.length === 0}
          onChange={(event) => {
            setSelectedShopId(event.target.value);
            setExpandedSectionIds(new Set());
            setError(null);
          }}
        >
          {shops.length === 0 ? <option value="">No shops available</option> : null}
          {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-fit rounded-lg border bg-card p-1" role="tablist" aria-label={mode === 'publish' ? 'Publish view' : 'Sync view'}>
          <Button type="button" variant={syncView === 'local' ? 'default' : 'ghost'} role="tab" aria-selected={syncView === 'local'} disabled={actionsDisabled} onClick={() => setSyncView('local')}>
            Local View
          </Button>
          <Button type="button" variant={syncView === 'etsy' ? 'default' : 'ghost'} role="tab" aria-selected={syncView === 'etsy'} disabled={actionsDisabled} onClick={() => setSyncView('etsy')}>
            Etsy View
          </Button>
        </div>
        <Button type="button" variant="outline" disabled={actionsDisabled} onClick={() => startRefresh(() => router.refresh())}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {refreshing ? 'Refreshing listings...' : 'Refresh listings'}
        </Button>
      </div>
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      {displayedSections.length === 0 ? <p className="text-sm text-muted-foreground">
        {shops.length === 0 ? 'No shops are available.' : 'No listings are available for this shop.'}
      </p> : null}
      {displayedSections.map((section) => {
        const publication = mode === 'publish' ? summarizeSectionPublication(section.listings) : null;
        const isExpanded = expandedSectionIds.has(section.id);
        const isLocalSection = 'etsySections' in section;
        const listingCount = isLocalSection
          ? new Set(section.listings.map((listing) => listing.id)).size
          : section.listings.length;
        const showSubject = mode === 'publish' && section.showSubject;
        const visibleListings = mode === 'sync'
          ? [...section.listings].sort((first, second) =>
              first.listingName.localeCompare(second.listingName, undefined, { sensitivity: 'base' })
              || first.etsyCategory.localeCompare(second.etsyCategory, undefined, { sensitivity: 'base' })
            )
          : showSubject
            ? [...section.listings].sort((first, second) =>
              first.subjectName.localeCompare(second.subjectName, undefined, { sensitivity: 'base' })
              || first.listingName.localeCompare(second.listingName, undefined, { sensitivity: 'base' })
            )
            : section.listings;
        return <Card key={section.id} role="region" aria-label={`${section.sectionName} section`}>
        <CardHeader className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
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
              ({listingCount} listing{listingCount === 1 ? '' : 's'})
            </span>
          </button>
          {mode === 'publish' && publication ? <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <dl aria-label="Section publication counts" className="grid gap-1 text-sm tabular-nums">
            <div className="flex justify-between gap-4" title="All Etsy products for this listing are published."><dt>Published:</dt><dd className="font-semibold">{publication.published}</dd></div>
            <div className="flex justify-between gap-4" title="All Etsy products for this listing are published or synced drafts."><dt>Synced:</dt><dd className="font-semibold">{publication.synced}</dd></div>
            <div className="flex justify-between gap-4" title="At least one Etsy product is not a published listing or a synced draft."><dt>Not Synced:</dt><dd className="font-semibold">{publication.notSynced}</dd></div>
          </dl>
          <Button
            type="button"
            variant="outline"
            onClick={() => runAction('/api/etsy/check-statuses', { listingIds: [...new Set(section.listings.map((listing) => listing.id))] }, `check-statuses-${section.id}`, 'Unable to check Etsy listing statuses.')}
            disabled={actionsDisabled || !section.listings.some((listing) => listing.hasEtsyListing)}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === `check-statuses-${section.id}` ? 'animate-spin' : ''}`} aria-hidden="true" />
            {busy === `check-statuses-${section.id}` ? 'Checking...' : 'Check statuses'}
          </Button>
          <Button type="button" aria-label="Publish section"
            title={`Publish synced drafts in ${section.sectionName}`}
            disabled={actionsDisabled || publication.targets.length === 0}
            onClick={() => {
              if (actionLock.current || actionsDisabled || publication.targets.length === 0) return;
              setPublishSectionQuantity('1');
              setPublishSectionTarget({ shopId: section.shopId, sectionId: section.id, sectionName: section.sectionName, view: syncView });
              setError(null);
            }}>
            {busy === `publish-section-${section.id}` ? 'Publishing...' : 'Publish'}
          </Button>
          </div> : null}
          {mode === 'sync' && !isLocalSection ? <div className="flex items-center gap-2">
            {!section.hasEtsySection ? <Button
              variant="outline"
              onClick={() => runAction(
                '/api/etsy/template-categories',
                { shopId: section.shopId, categoryId: section.categoryId },
                `add-category-${section.id}`,
                'Unable to add the category to Etsy.',
              )}
              disabled={actionsDisabled}
            >
              {busy === `add-category-${section.id}` ? 'Adding...' : 'Add Category to Etsy'}
            </Button> : <>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> On Etsy
              </span>
              <Button
                variant="outline"
                onClick={() => runAction(
                  '/api/etsy/template-categories',
                  { shopId: section.shopId, categoryId: section.categoryId },
                  `add-category-${section.id}`,
                  'Unable to sync the category to Etsy.',
                )}
                disabled={actionsDisabled}
              >
                {busy === `add-category-${section.id}` ? 'Syncing Category...' : 'Sync Category'}
              </Button>
            </>}
            {section.listings.some((listing) => listing.canSync) ? (
              <Button
                variant="outline"
                onClick={() => syncAllSection(section)}
                disabled={actionsDisabled || !section.listings.some((listing) => listing.canSync)}
              >
                {busy === `sync-all-${section.id}`
                  ? 'Syncing...'
                  : section.listings.every((listing) => listing.syncVariants.length === 1 && listing.syncVariants[0] === 'download')
                    ? 'Sync All Digital'
                    : section.listings.every((listing) => listing.syncVariants.length === 1 && listing.syncVariants[0] === 'print')
                      ? 'Sync All Prints'
                      : 'Sync All'}
              </Button>
            ) : null}
          </div> : null}
          {mode === 'sync' && isLocalSection ? <Button
            variant="outline"
            onClick={() => syncAllSection(section)}
            disabled={actionsDisabled || !section.listings.some((listing) => listing.canSync)}
          >
            {busy === `sync-all-${section.id}` ? 'Syncing...' : 'Sync All'}
          </Button> : null}
        </CardHeader>
        {isExpanded ? <CardContent id={`section-listings-${section.id}`}>
          {isLocalSection ? <div className="mb-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-medium">Etsy sections used by templates</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {section.etsySections.map((etsySection) => <span
                key={etsySection.categoryId}
                className={`rounded-full border px-2.5 py-1 text-xs ${etsySection.hasEtsySection ? 'border-green-300 bg-green-50 text-green-700' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
              >
                {etsySection.sectionName} · {etsySection.hasEtsySection ? 'On Etsy' : 'Not on Etsy'}
              </span>)}
            </div>
          </div> : null}
          <Table><TableHeader><TableRow>{showSubject ? <TableHead>Subject</TableHead> : null}<TableHead>Listing Name</TableHead>{isLocalSection ? <TableHead>Etsy Section</TableHead> : null}<TableHead>Etsy Product</TableHead><TableHead>Template Use</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
            {visibleListings.map((listing) => {
              const listingActionKey = `${listing.id}-${listing.syncVariants.join('-')}`;
              return <TableRow key={`${listing.id}:${listing.etsyCategory}:${listing.syncVariants.join('-')}`}>
              {showSubject ? <TableCell>{listing.subjectName}</TableCell> : null}
              <TableCell className="font-medium">{listing.listingName}</TableCell>
              {isLocalSection ? <TableCell>{listing.etsyCategory}</TableCell> : null}
              <TableCell>{listing.etsyListingMode === 'both'
                ? 'Print + Digital (2 listings)'
                : listing.etsyListingMode === 'download' ? 'Digital' : 'Print'}</TableCell>
              <TableCell>{listing.categoryUses.join(' + ')}</TableCell>
              <TableCell>{!listing.isComplete ? <span className="inline-flex items-center gap-2 text-destructive"><XCircle className="h-4 w-4" /> Listing incomplete</span> : listing.isPublished ? <span className="inline-flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" /> Published</span> : listing.hasActiveEtsyListing ? <span className="inline-flex items-center gap-2 text-amber-600"><XCircle className="h-4 w-4" /> Partially published</span> : listing.isInactive ? <span className="inline-flex items-center gap-2 text-amber-600"><XCircle className="h-4 w-4" /> Inactive</span> : listing.isSynced ? <span className="inline-flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" /> Synced</span> : !listing.canSync && listing.syncDisabledReason ? <span className="inline-flex items-center gap-2 text-destructive"><XCircle className="h-4 w-4" /> {listing.syncDisabledReason}</span> : listing.pendingChanges.length > 0 ? <span className="inline-flex items-center gap-2 text-amber-600"><XCircle className="h-4 w-4" /> Needs sync: {listing.pendingChanges.join(', ')}</span> : <span className="inline-flex items-center gap-2 text-destructive"><XCircle className="h-4 w-4" /> Not synced</span>}
                {listing.isComplete && (listing.isPublished || listing.hasActiveEtsyListing || listing.isInactive || listing.isSynced)
                  && listing.pendingChanges.includes('Personalisation') ? <span className="mt-1 block text-sm font-medium text-amber-600">Needs sync: Personalisation</span> : null}
              </TableCell>
              <TableCell className="text-right"><div className="flex justify-end gap-2">
                {mode === 'sync' && (!listing.hasEtsyListing || listing.canSync) ? <Button className="w-36" title={listing.syncDisabledReason ?? undefined} onClick={() => runAction('/api/etsy/upload', { listingId: listing.id, variants: listing.syncVariants }, `listing-${listingActionKey}`, 'Unable to sync listing.')} disabled={!listing.canSync || actionsDisabled}>{busy === `listing-${listingActionKey}` ? 'Syncing...' : listing.syncVariants.length > 1 ? 'Sync All' : listing.syncVariants[0] === 'download' ? 'Sync Digital' : listing.syncVariants[0] === 'customised' ? 'Sync Customised' : 'Sync Print'}</Button> : null}
                {mode === 'sync' && listing.hasEtsyListing ? <Button className="w-36" variant="destructive" onClick={() => setDeleteTarget({ id: listing.id, listingName: listing.listingName })} disabled={listing.hasActiveEtsyListing || actionsDisabled}>{busy === `delete-${listing.id}` ? 'Deleting...' : 'Delete from Etsy'}</Button> : null}
                {mode === 'publish' && !listing.isPublished ? <Button className="w-36" onClick={() => setPublishTarget({ id: listing.id, listingName: listing.listingName, isInactive: listing.isInactive, variants: listing.syncVariants, etsyCategory: listing.etsyCategory })} disabled={!listing.hasEtsyListing || actionsDisabled}>{busy === `publish-${listingActionKey}` ? listing.isInactive ? 'Re-activating...' : 'Publishing...' : listing.isInactive ? 'Re-activate' : 'Publish'}</Button> : null}
                {mode === 'publish' && listing.isPublished ? <Button className="w-36" variant="outline" onClick={() => setInactiveTarget({ id: listing.id, listingName: listing.listingName, variants: listing.syncVariants, etsyCategory: listing.etsyCategory })} disabled={actionsDisabled}>{busy === `inactive-${listingActionKey}` ? 'Updating...' : 'Make Inactive'}</Button> : null}
              </div></TableCell>
            </TableRow>})}
          </TableBody></Table>
        </CardContent> : null}
      </Card>;
      })}
    </div>

    {mode === 'publish' ? <Dialog open={publishSectionTarget !== null} onOpenChange={(open) => { if (!open && !actionLock.current) setPublishSectionTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish section?</DialogTitle>
          <DialogDescription>Choose how many of the {sectionPublishTargets.length} eligible {sectionPublishTargets.length === 1 ? 'listing' : 'listings'} in {publishSectionTarget?.sectionName} to publish to Etsy.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <label htmlFor={publishQuantityId} className="text-sm font-medium">Number of listings to publish</label>
          <Input id={publishQuantityId} type="number" min={1} max={sectionPublishTargets.length} step={1}
            value={publishSectionQuantity} disabled={actionsDisabled || sectionPublishTargets.length === 0}
            aria-invalid={sectionPublishTargets.length > 0 && !validSectionPublishCount}
            aria-describedby={`${publishQuantityId}-hint${sectionPublishTargets.length > 0 && !validSectionPublishCount ? ` ${publishQuantityId}-error` : ''}`}
            onChange={(event) => setPublishSectionQuantity(event.target.value)} />
          <p id={`${publishQuantityId}-hint`} className="text-sm text-muted-foreground">{sectionPublishTargets.length > 0
            ? `Choose 1 to ${sectionPublishTargets.length}. Listings will be published in the order shown below.`
            : 'No synced drafts remain ready to publish in this section.'}</p>
          {sectionPublishTargets.length > 0 && !validSectionPublishCount ? <p id={`${publishQuantityId}-error`} role="alert" className="text-sm text-destructive">Enter a whole number from 1 to {sectionPublishTargets.length}.</p> : null}
        </div>
        <ul className="max-h-60 space-y-2 overflow-y-auto rounded-md border p-3 text-sm">
          {selectedSectionPublishTargets.map((target) => <li key={target.id}>{target.listingName} <span className="text-muted-foreground">({target.variants.map((variant) => variant === 'download' ? 'Digital' : variant === 'customised' ? 'Customised' : 'Print').join(', ')})</span></li>)}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setPublishSectionTarget(null)}>Cancel</Button>
          <Button type="button" disabled={actionsDisabled || !validSectionPublishCount} onClick={() => { void publishSectionConfirmed(); }}>
            {validSectionPublishCount ? `Publish ${sectionPublishCount} ${sectionPublishCount === 1 ? 'listing' : 'listings'}` : 'Publish listings'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog> : null}

    <Dialog open={publishSectionProgress !== null} onOpenChange={(open) => { if (!open && publishSectionProgress?.status !== 'running') setPublishSectionProgress(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish section — {publishSectionProgress?.sectionName}</DialogTitle>
          <DialogDescription>Publishing the selected section's synced draft products to Etsy.</DialogDescription>
        </DialogHeader>
        <div className="py-4 text-center" role="status">
          <p className="text-3xl font-semibold tabular-nums">{publishSectionProgress?.completed ?? 0} of {publishSectionProgress?.total ?? 0}</p>
          <p className="mt-2 text-sm text-muted-foreground">{publishSectionProgress?.status === 'running'
            ? `Publishing ${publishSectionProgress.currentListingName}` : publishSectionProgress?.status === 'complete'
              ? 'All selected listings have been published.' : publishSectionProgress?.message}</p>
        </div>
        {publishSectionProgress?.status !== 'running' ? <DialogFooter><Button type="button" onClick={() => setPublishSectionProgress(null)}>Close</Button></DialogFooter> : null}
      </DialogContent>
    </Dialog>

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
          {syncAllProgress?.status === 'running' ? <p className="mt-1 text-xs text-muted-foreground">There is a 10-second pause between each listing.</p> : null}
        </div>
        {syncAllProgress?.status !== 'running' ? <DialogFooter>
          <Button type="button" onClick={() => setSyncAllProgress(null)}>Close</Button>
        </DialogFooter> : null}
      </DialogContent>
    </Dialog>

    {mode === 'publish' ? <Dialog open={publishTarget !== null} onOpenChange={(open) => { if (!open && busy === null) setPublishTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{publishTarget?.isInactive ? 'Re-activate listing?' : 'Publish listing?'}</DialogTitle></DialogHeader>
        <p>Do you want to {publishTarget?.isInactive ? 're-activate' : 'publish'} {publishTarget?.listingName} ({publishTarget?.etsyCategory}) {publishTarget?.isInactive ? 'on' : 'to'} Etsy?</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setPublishTarget(null)}>No</Button>
          <Button type="button" onClick={publishConfirmed}>Yes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog> : null}

    {mode === 'publish' ? <Dialog open={inactiveTarget !== null} onOpenChange={(open) => { if (!open && busy === null) setInactiveTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Make listing inactive?</DialogTitle></DialogHeader>
        <p>Are you sure {inactiveTarget?.listingName} ({inactiveTarget?.etsyCategory}) should be made inactive?</p>
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
