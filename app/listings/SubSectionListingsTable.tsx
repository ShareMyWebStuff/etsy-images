'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Fragment } from 'react';
import { Check, ChevronDown, ChevronRight, ImageIcon, Pencil, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SubSectionListingsPageData } from '@/lib/listing-table';
import { ListingZipImportDialog } from '@/app/listings/ListingZipImportDialog';
import { ListingThumbnailPreviewDialog } from '@/app/listings/ListingThumbnailPreviewDialog';
import { SectionListingImageGallery } from '@/app/listings/SectionListingImageGallery';

type SubSectionListingsTableProps = {
  data: SubSectionListingsPageData | null;
  shopId: string | null;
  sectionId: string | null;
  subSectionId: string | null;
};

type ListingActionResponse = {
  data?: SubSectionListingsPageData | null;
  error?: string;
  deletedId?: string;
  refreshError?: string;
};

type GenerationProgress = {
  completed: number;
  current: number;
  listingName: string;
  total: number;
};

const COLLAPSIBLE_SET_SIZES = new Set([3, 6, 12]);
const ITEM_COUNT_OPTIONS = ['1', '3', '6', '12'] as const;
type ItemCountOption = (typeof ITEM_COUNT_OPTIONS)[number];

function defaultItemCount(data: SubSectionListingsPageData | null): ItemCountOption {
  const value = String(data?.subSection.numberOfDownloads ?? 1);
  return ITEM_COUNT_OPTIONS.includes(value as ItemCountOption) ? value as ItemCountOption : '1';
}

function listingScrollStorageKey(shopId: string | null, sectionId: string | null, subSectionId: string | null) {
  return `listing-scroll:${shopId ?? ''}:${sectionId ?? ''}:${subSectionId ?? ''}`;
}

function listingCategoryLabel(listing: SubSectionListingsPageData['listings'][number]) {
  return listing.sourceSectionName ?? 'Uncategorised';
}

function TemplateProductIndicators({ listing }: { listing: SubSectionListingsPageData['listings'][number] }) {
  if (!listing.templateProducts) return null;
  const indicators = [
    { label: 'Print / Frames', enabled: listing.templateProducts.printsFrames },
    { label: 'Customised Prints', enabled: listing.templateProducts.customisedPrints },
    { label: 'Digital Download', enabled: listing.templateProducts.digitalDownload },
  ];

  return <div className="mr-1 flex items-center gap-1" aria-label="Template products">
    {indicators.map(({ label, enabled }) => <span
      key={label}
      aria-label={`${label} ${enabled ? 'enabled' : 'disabled'}`}
      title={`${label}: ${enabled ? 'enabled' : 'disabled'}`}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-sm border ${enabled
        ? 'border-green-600 bg-green-50 text-green-700'
        : 'border-red-600 bg-red-50 text-red-700'}`}
    >
      {enabled
        ? <Check className="h-4 w-4" aria-hidden="true" />
        : <X className="h-4 w-4" aria-hidden="true" />}
    </span>)}
  </div>;
}

export function SubSectionListingsTable({
  data: initialData,
  shopId,
  sectionId,
  subSectionId,
}: SubSectionListingsTableProps) {
  const [data, setData] = useState(initialData);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [listingName, setListingName] = useState('');
  const [numberOfItems, setNumberOfItems] = useState<ItemCountOption>(() => defaultItemCount(initialData));
  const [ourCategoryId, setOurCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateLoadAttempt, setTemplateLoadAttempt] = useState(0);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [actingListingId, setActingListingId] = useState<string | null>(null);
  const [listingToDelete, setListingToDelete] = useState<{ id: string; name: string } | null>(null);
  const [listingToRestore, setListingToRestore] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [galleryDeleting, setGalleryDeleting] = useState(false);
  const galleryDeletingRef = useRef(false);
  const mutationLoading = importLoading || galleryDeleting;
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<{ id: string; context: string } | null>(null);
  const [galleryScope, setGalleryScope] = useState<string | null>(null);
  const galleryButtonRef = useRef<HTMLButtonElement | null>(null);
  const galleryContext = `${shopId}:${sectionId}`;
  const thumbnailButtonRef = useRef<HTMLButtonElement | null>(null);
  const thumbnailContext = `${shopId}:${sectionId}:${subSectionId}`;
  const currentListingContext = useRef(thumbnailContext);
  currentListingContext.current = thumbnailContext;
  const importRefreshRequest = useRef(0);
  const previewListing = thumbnailPreview?.context === thumbnailContext
    ? data?.listings.find((listing) => listing.id === thumbnailPreview.id && listing.hasThumbnail === true) ?? null
    : null;
  const importingRef = useRef(false);
  const listingsScrollRef = useRef<HTMLDivElement>(null);
  const isSingleListings = data?.subSection.numberOfDownloads === 1 && !data.subSection.includeAllDownloads;
  const hasCollapsibleGroups = data?.subSection.numberOfDownloads !== null
    && data?.subSection.numberOfDownloads !== undefined
    && COLLAPSIBLE_SET_SIZES.has(data.subSection.numberOfDownloads)
    && !data.subSection.includeAllDownloads;

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  useEffect(() => {
    setThumbnailPreview((current) => current && !data?.listings.some((listing) => listing.id === current.id && listing.hasThumbnail === true)
      ? null : current);
  }, [data]);

  useEffect(() => {
    setImportOpen(false);
    setImportMessage(null);
    setThumbnailPreview(null);
  }, [shopId, sectionId, subSectionId]);

  useEffect(() => {
    setGalleryScope(null);
  }, [shopId, sectionId]);

  useEffect(() => {
    if (!createOpen || !shopId || !sectionId || !subSectionId) return;
    const controller = new AbortController();
    setTemplatesLoading(true);
    setTemplatesError(null);
    void (async () => {
      try {
        const query = new URLSearchParams({ shopId, sectionId, subSectionId });
        const response = await fetch(`/api/shops/listings?${query.toString()}`, {
          cache: 'no-store', signal: controller.signal,
        });
        const payload = await response.json() as ListingActionResponse;
        if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Unable to load the latest templates.');
        if (!controller.signal.aborted) {
          const templates = payload.data.templates;
          setData((current) => current ? { ...current, templates } : payload.data ?? null);
        }
      } catch (caughtError) {
        if (!controller.signal.aborted) {
          setTemplatesError(caughtError instanceof Error ? caughtError.message : 'Unable to load the latest templates.');
        }
      } finally {
        if (!controller.signal.aborted) setTemplatesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [createOpen, shopId, sectionId, subSectionId, templateLoadAttempt]);

  useEffect(() => {
    setExpandedSections(new Set());
    setListingToRestore(null);

    const storedListingId = sessionStorage.getItem(listingScrollStorageKey(shopId, sectionId, subSectionId));
    const storedListing = data?.listings.find((listing) => listing.id === storedListingId);
    if (!storedListing) return;

    setListingToRestore(storedListing.id);
    if (hasCollapsibleGroups) {
      setExpandedSections(new Set([listingCategoryLabel(storedListing)]));
    }
  }, [shopId, sectionId, subSectionId, data, hasCollapsibleGroups]);

  useEffect(() => {
    if (!listingToRestore || !listingsScrollRef.current) return;

    const frame = requestAnimationFrame(() => {
      const scrollArea = listingsScrollRef.current;
      const row = scrollArea?.querySelector<HTMLElement>(`[data-listing-id="${listingToRestore}"]`);
      if (!scrollArea || !row) return;

      scrollArea.scrollTop += row.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top;
      sessionStorage.removeItem(listingScrollStorageKey(shopId, sectionId, subSectionId));
      setListingToRestore(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [listingToRestore, expandedSections, shopId, sectionId, subSectionId]);

  function toggleSection(sectionName: string) {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionName)) {
        next.delete(sectionName);
      } else {
        next.add(sectionName);
      }
      return next;
    });
  }

  function getEditHref(listingId: string) {
    if (!shopId || !sectionId || !subSectionId) {
      return '/listings';
    }

    return `/listings/edit?shopId=${encodeURIComponent(shopId)}&sectionId=${encodeURIComponent(
      sectionId
    )}&subSectionId=${encodeURIComponent(subSectionId)}&listingId=${encodeURIComponent(listingId)}`;
  }

  function selectListingToEdit(listingId: string) {
    const listing = data?.listings.find((entry) => entry.id === listingId);
    if (!listing) return;
    setEditingListingId(listing.id);
    setListingName(listing.listingName);
    setNumberOfItems(String(listing.numberOfItems ?? data?.subSection.numberOfDownloads ?? 1) as ItemCountOption);
    setOurCategoryId(listing.ourCategoryId ? String(listing.ourCategoryId) : '');
    setError(null);
  }

  async function createListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importingRef.current || galleryDeletingRef.current) return;

    if (!shopId || !sectionId || !subSectionId) {
      setError('Missing listing context.');
      return;
    }
    const trimmedListingName = listingName.trim();
    if (!trimmedListingName) {
      setError('Enter a listing name.');
      return;
    }
    if (!ourCategoryId) {
      setError('Choose a template.');
      return;
    }

    setError(null);
    setCreateLoading(true);

    try {
      const numericNumberOfItems = Number(numberOfItems);

      const response = await fetch('/api/shops/listings', {
        method: editingListingId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shopId,
          ...(editingListingId ? { listingId: editingListingId } : {}),
          sectionId,
          subSectionId,
          listingName: trimmedListingName,
          numberOfItems: numericNumberOfItems,
          includeAllItems: false,
          ourCategoryId: Number(ourCategoryId),
        }),
      });
      const payload = (await response.json()) as ListingActionResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? (editingListingId ? 'Unable to update listing.' : 'Unable to create listing.'));
      }

      setData(payload.data ?? null);
      setListingName('');
      setNumberOfItems(defaultItemCount(payload.data ?? data));
      setOurCategoryId('');
      setCreateOpen(false);
      setEditingListingId(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create listing.');
    } finally {
      setCreateLoading(false);
    }
  }

  async function deleteListing(listingId: string) {
    if (importingRef.current || galleryDeletingRef.current) return;
    if (!shopId || !sectionId || !subSectionId) {
      setError('Missing listing context.');
      return;
    }

    setError(null);
    setActingListingId(listingId);

    try {
      const response = await fetch('/api/shops/listings', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shopId, sectionId, subSectionId, listingId }),
      });
      const payload = (await response.json()) as ListingActionResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to delete listing.');
      }

      setData((current) => payload.data ?? (current ? { ...current, listings: current.listings.filter((listing) => listing.id !== listingId) } : null));
      setListingToDelete(null);
      if (payload.refreshError) setError(payload.refreshError);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to delete listing.');
    } finally {
      setActingListingId(null);
    }
  }

  async function generateListings(mode: 'changed' | 'all') {
    if (importingRef.current || galleryDeletingRef.current) return;
    if (!shopId || !sectionId || !subSectionId || !data) {
      setGenerateError('Missing listing context.');
      return;
    }
    if (data.listings.length === 0) {
      setGenerateError('There are no listings to generate.');
      return;
    }

    const listings = [...data.listings];
    let completed = 0;
    let regenerated = 0;
    setGenerateError(null);
    setGenerateMessage(null);
    setGenerateLoading(true);

    try {
      for (const [index, listing] of listings.entries()) {
        setGenerationProgress({
          completed,
          current: index + 1,
          listingName: listing.listingName,
          total: listings.length,
        });
        const response = await fetch('/api/shops/listings/editor/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopId,
            sectionId,
            subSectionId,
            listingId: listing.id,
            action: mode,
          }),
        });
        const payload = await response.json() as {
          error?: string;
          generation?: { regenerated?: boolean };
        };
        if (!response.ok) {
          throw new Error(`${listing.listingName}: ${payload.error ?? 'Unable to generate the listing.'}`);
        }
        if (payload.generation?.regenerated !== false) regenerated += 1;
        completed += 1;
        setGenerationProgress({
          completed,
          current: index + 1,
          listingName: listing.listingName,
          total: listings.length,
        });
      }

      const query = new URLSearchParams({ shopId, sectionId, subSectionId });
      const refreshResponse = await fetch(`/api/shops/listings?${query.toString()}`);
      const refreshPayload = await refreshResponse.json() as ListingActionResponse;
      if (refreshResponse.ok) {
        setData(refreshPayload.data ?? null);
      } else {
        setError(refreshPayload.error ?? 'The listings were generated, but the table could not be refreshed.');
      }

      const skipped = completed - regenerated;
      setGenerateMessage(mode === 'all'
        ? `${completed} ${completed === 1 ? 'listing' : 'listings'} generated successfully.`
        : `${regenerated} ${regenerated === 1 ? 'listing was' : 'listings were'} regenerated; ${skipped} ${skipped === 1 ? 'listing was' : 'listings were'} already up to date.`);
      setGenerateOpen(false);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Unable to generate the listings.';
      setGenerateError(`Generation stopped after ${completed} of ${listings.length} listings. ${message}`);
    } finally {
      setGenerateLoading(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <CardTitle>{data ? `${data.section.sectionName} Listings` : 'Listings'}</CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={!shopId || !sectionId || !subSectionId || !data || generateLoading || createLoading || actingListingId !== null || mutationLoading}
              onClick={() => { setImportMessage(null); setError(null); setImportOpen(true); }}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Import
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setGenerateError(null);
                setGenerateMessage(null);
                setGenerationProgress(null);
                setGenerateOpen(true);
              }}
              disabled={!subSectionId || !data || data.listings.length === 0 || generateLoading || mutationLoading}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Generate
            </Button>
            <Button
              ref={galleryButtonRef}
              type="button"
              size="icon"
              variant="outline"
              aria-label="View section images"
              title="View section images"
              disabled={!shopId || !sectionId || !data || generateLoading || actingListingId !== null || mutationLoading}
              onClick={() => setGalleryScope(galleryContext)}
            >
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Edit listing"
              title="Edit listing"
              disabled={!data?.listings.length || generateLoading || mutationLoading}
              onClick={() => {
                if (data?.listings[0]) selectListingToEdit(data.listings[0].id);
                setCreateOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Add listing"
              title="Add listing"
              onClick={() => {
                setError(null);
                setListingName('');
                setEditingListingId(null);
                setNumberOfItems(defaultItemCount(data));
                setOurCategoryId('');
                setCreateOpen(true);
              }}
              disabled={!subSectionId || mutationLoading}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {importMessage ? <p role="status" className="mb-4 text-sm font-medium text-green-700">{importMessage}</p> : null}
          {generateMessage ? <p className="mb-4 text-sm font-medium text-green-700">{generateMessage}</p> : null}
          {error ? <p className="mb-4 text-sm font-medium text-destructive">{error}</p> : null}
          <div ref={listingsScrollRef} className="max-h-[70vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {!isSingleListings ? <TableHead>Category</TableHead> : null}
                <TableHead>Listing Name</TableHead>
                <TableHead>Orientation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && data.listings.length > 0 ? (
                data.listings.map((listing, listingIndex) => {
                  const isPublished = listing.status === 'active' || listing.status === 'published';
                  const isBusy = actingListingId !== null || mutationLoading;
                  const sourceSectionName = listingCategoryLabel(listing);
                  const previousSourceSectionName = listingIndex === 0
                    ? null
                    : listingCategoryLabel(data.listings[listingIndex - 1]);
                  const isSectionExpanded = expandedSections.has(sourceSectionName);

                  return (
                    <Fragment key={listing.id}>
                    {!isSingleListings && sourceSectionName !== previousSourceSectionName ? <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={isSingleListings ? 6 : 7} className="font-semibold">
                        {hasCollapsibleGroups ? <button
                          type="button"
                          className="flex w-full items-center gap-2 text-left"
                          aria-expanded={isSectionExpanded}
                          onClick={() => toggleSection(sourceSectionName)}
                        >
                          {isSectionExpanded ? (
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          )}
                          {sourceSectionName}
                        </button> : sourceSectionName}
                      </TableCell>
                    </TableRow> : null}
                    {!hasCollapsibleGroups || isSectionExpanded ? <TableRow data-listing-id={listing.id} className={listing.isComplete ? 'bg-green-50 hover:bg-green-100' : undefined}>
                      {!isSingleListings ? <TableCell className="text-muted-foreground">{sourceSectionName}</TableCell> : null}
                      <TableCell className="font-medium">{listing.listingName}</TableCell>
                      <TableCell className="whitespace-nowrap">{listing.artworkOrientation === 'landscape' ? 'Landscape' : listing.artworkOrientation === 'portrait' ? 'Portrait' : '-'}</TableCell>
                      <TableCell>{listing.status}</TableCell>
                      <TableCell className="text-right tabular-nums">{listing.quantity ?? 'None'}</TableCell>
                      <TableCell className="text-right tabular-nums">{listing.price}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <TemplateProductIndicators listing={listing} />
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            aria-label={`Preview thumbnail for ${listing.listingName}`}
                            title={listing.hasThumbnail ? 'View thumbnail' : 'No artwork thumbnail uploaded'}
                            disabled={listing.hasThumbnail !== true || !shopId || !sectionId || !subSectionId || mutationLoading || actingListingId === listing.id}
                            onClick={(event) => {
                              thumbnailButtonRef.current = event.currentTarget;
                              setThumbnailPreview({ id: listing.id, context: thumbnailContext });
                            }}
                          >
                            <ImageIcon className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            aria-label={`Delete ${listing.listingName}`}
                            title={listing.hasEtsyListingId ? 'Listings on Etsy cannot be deleted here' : 'Delete listing'}
                            onClick={() => {
                              setError(null);
                              setListingToDelete({ id: listing.id, name: listing.listingName });
                            }}
                            disabled={listing.hasEtsyListingId || isPublished || isBusy}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button asChild size="icon" variant="outline" aria-label={`Edit ${listing.listingName}`} title="Edit listing">
                            <Link
                              href={getEditHref(listing.id) as Route}
                              onClick={() => sessionStorage.setItem(
                                listingScrollStorageKey(shopId, sectionId, subSectionId),
                                listing.id
                              )}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow> : null}
                    </Fragment>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={isSingleListings ? 6 : 7} className="text-center text-muted-foreground">
                    No listings found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {shopId && sectionId && data ? <SectionListingImageGallery
        key={galleryContext}
        open={galleryScope === galleryContext}
        onOpenChange={(open) => setGalleryScope(open ? galleryContext : null)}
        shopId={shopId} sectionId={sectionId} sectionName={data.section.sectionName}
        onRestoreFocus={() => { if (galleryButtonRef.current?.isConnected) galleryButtonRef.current.focus(); }}
        onDeletingChange={(deleting) => { galleryDeletingRef.current = deleting; setGalleryDeleting(deleting); }}
        onListingDeleted={(listingId) => {
          setData((current) => current ? { ...current, listings: current.listings.filter((listing) => listing.id !== listingId) } : current);
        }}
      /> : null}

      {shopId && sectionId && subSectionId ? <ListingThumbnailPreviewDialog
        key={`${thumbnailContext}:${previewListing?.id ?? ''}:${previewListing?.thumbnailUpdatedAt ?? ''}`}
        shopId={shopId} sectionId={sectionId} subSectionId={subSectionId} listing={previewListing}
        onClose={() => setThumbnailPreview(null)}
        onRestoreFocus={() => { if (thumbnailButtonRef.current?.isConnected) thumbnailButtonRef.current.focus(); }}
      /> : null}

      {shopId && sectionId && subSectionId && data ? <ListingZipImportDialog
        key={`${shopId}:${sectionId}:${subSectionId}`}
        open={importOpen}
        onOpenChange={setImportOpen}
        shopId={shopId}
        sectionId={sectionId}
        subSectionId={subSectionId}
        destinationName={`${data.shop.shopName} / ${data.section.sectionName} / ${data.subSection.name}`}
        onImportingChange={(importing) => { importingRef.current = importing; setImportLoading(importing); }}
        onInserted={(next) => {
          setData(next);
        }}
        onFinished={({ insertedCount, skippedCount, unconfirmed }) => {
          setImportMessage(unconfirmed ? 'Review closed. Checking the listings for completed inserts.'
            : `${insertedCount} ${insertedCount === 1 ? 'listing' : 'listings'} inserted. ${skippedCount} skipped.`);
          setImportOpen(false);
          if (!insertedCount && !unconfirmed) return;
          const identity = thumbnailContext, request = ++importRefreshRequest.current;
          const query = new URLSearchParams({ shopId, sectionId, subSectionId });
          void (async () => {
            try {
              const response = await fetch(`/api/shops/listings?${query}`, { cache: 'no-store' });
              const payload = await response.json() as ListingActionResponse;
              if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Unable to refresh the inserted listings. Reload this section.');
              if (currentListingContext.current === identity && importRefreshRequest.current === request) {
                setData(payload.data);
                if (unconfirmed) setImportMessage('Review closed. Listings refreshed; check the table for completed inserts.');
              }
            } catch (caught) {
              if (currentListingContext.current === identity && importRefreshRequest.current === request) {
                setError(caught instanceof Error ? caught.message : 'Unable to refresh the inserted listings. Reload this section.');
              }
            }
          })();
        }}
      /> : null}

      <Dialog
        open={generateOpen}
        onOpenChange={(open) => {
          if (!generateLoading) setGenerateOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate listings?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Choose whether to regenerate only changed items or every item in the <strong>{data?.section.sectionName}</strong> section.
            </p>
            {generationProgress ? (
              <div className="rounded-md border bg-muted/40 p-3" aria-live="polite">
                <p className="font-medium">
                  {generateLoading ? 'Checking' : 'Stopped at'} {generationProgress.listingName}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Listing {generationProgress.current} of {generationProgress.total}; {generationProgress.completed} completed.
                </p>
              </div>
            ) : null}
            {generateError ? <p className="font-medium text-destructive" role="alert">{generateError}</p> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setGenerateOpen(false)}
              disabled={generateLoading || mutationLoading}
            >
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => generateListings('changed')} disabled={generateLoading || mutationLoading}>
              {generateLoading ? 'Working...' : 'Only Changed'}
            </Button>
            <Button type="button" onClick={() => generateListings('all')} disabled={generateLoading || mutationLoading}>
              {generateLoading ? 'Working...' : 'All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!createLoading) setCreateOpen(open); }}>
        <DialogContent>
          <form onSubmit={createListing}>
            <DialogHeader>
              <DialogTitle>{editingListingId ? 'Edit Listing' : 'Create Listing'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {editingListingId ? (
                <label className="grid gap-2 text-sm font-medium">
                  Listing
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={editingListingId}
                    onChange={(event) => selectListingToEdit(event.target.value)}
                    disabled={createLoading}
                  >
                    {data?.listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.listingName}</option>)}
                  </select>
                </label>
              ) : null}
              <Input
                aria-label="Listing name"
                value={listingName}
                onChange={(event) => setListingName(event.target.value)}
                placeholder="Listing directory name"
                autoFocus
              />
              <label className="grid gap-2 text-sm font-medium">
                No of Items
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={numberOfItems}
                  onChange={(event) => {
                    setNumberOfItems(event.target.value as ItemCountOption);
                    setOurCategoryId('');
                  }}
                >
                  <option value="1">1</option>
                  <option value="3">3</option>
                  <option value="6">6</option>
                  <option value="12">12</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Template
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={ourCategoryId}
                  onChange={(event) => setOurCategoryId(event.target.value)}
                  disabled={templatesLoading || createLoading}
                >
                  <option value="">Choose a template</option>
                  {(data?.templates ?? [])
                    .filter((template) => template.itemCount === Number(numberOfItems)
                      && template.templateType === (numberOfItems === '1' ? 'single' : 'multiple'))
                    .map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
                {templatesLoading ? <span role="status" className="text-xs font-normal text-muted-foreground">Loading templates...</span> : null}
                {!templatesLoading && !templatesError && (data?.templates ?? []).filter((template) => template.itemCount === Number(numberOfItems)
                  && template.templateType === (numberOfItems === '1' ? 'single' : 'multiple')).length === 0 ? (
                    <span className="text-xs font-normal text-amber-700">No matching templates exist for {numberOfItems} {numberOfItems === '1' ? 'item' : 'items'}.</span>
                  ) : null}
              </label>
              {templatesError ? <div className="grid gap-2">
                <p role="alert" className="text-sm font-medium text-destructive">{templatesError}</p>
                <Button type="button" variant="outline" onClick={() => setTemplateLoadAttempt((attempt) => attempt + 1)}>Retry loading templates</Button>
              </div> : null}
              {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={createLoading || templatesLoading || Boolean(templatesError) || !ourCategoryId || mutationLoading}>
                {createLoading ? (editingListingId ? 'Saving...' : 'Creating...') : (editingListingId ? 'Save' : 'Create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={listingToDelete !== null}
        onOpenChange={(open) => {
          if (!open && actingListingId === null) setListingToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete listing?</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Are you sure you want to delete <strong>{listingToDelete?.name}</strong>?
          </p>
          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setListingToDelete(null)}
              disabled={actingListingId !== null || mutationLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => listingToDelete && deleteListing(listingToDelete.id)}
              disabled={actingListingId !== null || mutationLoading}
            >
              {actingListingId !== null ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
