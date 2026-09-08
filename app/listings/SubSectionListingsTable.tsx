'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Fragment } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SubSectionListingsPageData } from '@/lib/listing-table';
import type { ImportableListingRow } from '@/lib/local-listings';

type SubSectionListingsTableProps = {
  data: SubSectionListingsPageData | null;
  shopId: string | null;
  sectionId: string | null;
  subSectionId: string | null;
};

type ListingActionResponse = {
  data?: SubSectionListingsPageData | null;
  listings?: ImportableListingRow[];
  error?: string;
};

const COLLAPSIBLE_SET_SIZES = new Set([3, 6, 12]);

function listingScrollStorageKey(shopId: string | null, sectionId: string | null, subSectionId: string | null) {
  return `listing-scroll:${shopId ?? ''}:${sectionId ?? ''}:${subSectionId ?? ''}`;
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
  const [importOpen, setImportOpen] = useState(false);
  const [listingName, setListingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importingListingName, setImportingListingName] = useState<string | null>(null);
  const [actingListingId, setActingListingId] = useState<string | null>(null);
  const [listingToDelete, setListingToDelete] = useState<{ id: string; name: string } | null>(null);
  const [importRows, setImportRows] = useState<ImportableListingRow[]>([]);
  const [listingToRestore, setListingToRestore] = useState<string | null>(null);
  const listingsScrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const isSingleListings = data?.subSection.numberOfDownloads === 1 && !data.subSection.includeAllDownloads;
  const hasCollapsibleGroups = data?.subSection.numberOfDownloads !== null
    && data?.subSection.numberOfDownloads !== undefined
    && COLLAPSIBLE_SET_SIZES.has(data.subSection.numberOfDownloads)
    && !data.subSection.includeAllDownloads;

  useEffect(() => {
    setExpandedSections(new Set());
    setListingToRestore(null);

    const storedListingId = sessionStorage.getItem(listingScrollStorageKey(shopId, sectionId, subSectionId));
    const storedListing = data?.listings.find((listing) => listing.id === storedListingId);
    if (!storedListing) return;

    setListingToRestore(storedListing.id);
    if (hasCollapsibleGroups) {
      setExpandedSections(new Set([storedListing.sourceSectionName ?? 'Uncategorised']));
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

  async function createListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!shopId || !sectionId || !subSectionId) {
      setError('Missing listing context.');
      return;
    }

    setError(null);
    setCreateLoading(true);

    try {
      const response = await fetch('/api/shops/listings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shopId, sectionId, subSectionId, listingName }),
      });
      const payload = (await response.json()) as ListingActionResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to create listing.');
      }

      setData(payload.data ?? null);
      setListingName('');
      setCreateOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create listing.');
    } finally {
      setCreateLoading(false);
    }
  }

  async function openImportDialog() {
    if (!shopId || !sectionId || !subSectionId) {
      setError('Missing listing context.');
      return;
    }

    setError(null);
    setImportLoading(true);
    setImportOpen(true);

    try {
      const response = await fetch(
        `/api/shops/listings/import?shopId=${encodeURIComponent(shopId)}&sectionId=${encodeURIComponent(
          sectionId
        )}&subSectionId=${encodeURIComponent(subSectionId)}`
      );
      const payload = (await response.json()) as ListingActionResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to load importable listings.');
      }

      setImportRows(payload.listings ?? []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to load importable listings.');
      setImportRows([]);
    } finally {
      setImportLoading(false);
    }
  }

  async function importListing(listingNameToImport: string) {
    if (!shopId || !sectionId || !subSectionId) {
      setError('Missing listing context.');
      return;
    }

    setError(null);
    setImportingListingName(listingNameToImport);

    try {
      const response = await fetch('/api/shops/listings/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shopId, sectionId, subSectionId, listingName: listingNameToImport }),
      });
      const payload = (await response.json()) as ListingActionResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to import listing.');
      }

      setData(payload.data ?? null);
      setImportRows(payload.listings ?? []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to import listing.');
    } finally {
      setImportingListingName(null);
    }
  }

  async function deleteListing(listingId: string) {
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

      setData(payload.data ?? null);
      setListingToDelete(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to delete listing.');
    } finally {
      setActingListingId(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <CardTitle>{data ? `${data.section.sectionName} Listings` : 'Listings'}</CardTitle>
          <div className="flex items-center gap-2">
            {isSingleListings ? <Button type="button" variant="outline" onClick={openImportDialog} disabled={!subSectionId || importLoading}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Import
            </Button> : null}
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Add listing"
              title="Add listing"
              onClick={() => {
                setError(null);
                if (isSingleListings) {
                  setCreateOpen(true);
                } else {
                  router.push(`/listings/create-multi?shopId=${encodeURIComponent(shopId ?? '')}&sectionId=${encodeURIComponent(sectionId ?? '')}&subSectionId=${encodeURIComponent(subSectionId ?? '')}`);
                }
              }}
              disabled={!subSectionId}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-4 text-sm font-medium text-destructive">{error}</p> : null}
          <div ref={listingsScrollRef} className="max-h-[70vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {!isSingleListings ? <TableHead>Category</TableHead> : null}
                <TableHead>Listing Name</TableHead>
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
                  const isBusy = actingListingId !== null;
                  const sourceSectionName = listing.sourceSectionName ?? 'Uncategorised';
                  const previousSourceSectionName = listingIndex === 0
                    ? null
                    : data.listings[listingIndex - 1].sourceSectionName ?? 'Uncategorised';
                  const isSectionExpanded = expandedSections.has(sourceSectionName);

                  return (
                    <Fragment key={listing.id}>
                    {!isSingleListings && sourceSectionName !== previousSourceSectionName ? <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={isSingleListings ? 5 : 6} className="font-semibold">
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
                      <TableCell>{listing.status}</TableCell>
                      <TableCell className="text-right tabular-nums">{listing.quantity ?? 'None'}</TableCell>
                      <TableCell className="text-right tabular-nums">{listing.price}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
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
                  <TableCell colSpan={isSingleListings ? 5 : 6} className="text-center text-muted-foreground">
                    No listings found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={createListing}>
            <DialogHeader>
              <DialogTitle>Create Listing</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                value={listingName}
                onChange={(event) => setListingName(event.target.value)}
                placeholder="Listing directory name"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Listings</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing Name</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importRows.length > 0 ? (
                  importRows.map((row) => (
                    <TableRow key={row.listingName}>
                      <TableCell className="font-medium">{row.listingName}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => importListing(row.listingName)}
                          disabled={importingListingName !== null}
                        >
                          {importingListingName === row.listingName ? 'Importing...' : 'Import'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      No listings found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
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
              disabled={actingListingId !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => listingToDelete && deleteListing(listingToDelete.id)}
              disabled={actingListingId !== null}
            >
              {actingListingId !== null ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
