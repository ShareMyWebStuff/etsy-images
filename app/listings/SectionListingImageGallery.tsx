'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ListingGalleryItem } from '@/lib/listing-gallery';

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  shopId: string;
  sectionId: string;
  sectionName: string;
  onRestoreFocus?(): void;
  onListingDeleted?(listingId: string): void;
  onDeletingChange?(deleting: boolean): void;
};
type GalleryData = { sectionName: string; listings: ListingGalleryItem[] };

function validGallery(value: unknown): value is GalleryData {
  const payload = value as GalleryData | undefined;
  return !!payload && typeof payload.sectionName === 'string' && Array.isArray(payload.listings)
    && payload.listings.every((listing) => !!listing && typeof listing.id === 'string' && !!listing.id
      && typeof listing.listingName === 'string' && typeof listing.hasThumbnail === 'boolean'
      && (listing.thumbnailUpdatedAt === null || typeof listing.thumbnailUpdatedAt === 'string')
      && (listing.subSectionId === null || typeof listing.subSectionId === 'string' && !!listing.subSectionId)
      && (listing.canDelete === undefined || typeof listing.canDelete === 'boolean')
      && (listing.deleteDisabledReason === undefined || listing.deleteDisabledReason === null || typeof listing.deleteDisabledReason === 'string'));
}

function GalleryCard({ listing, source, deleting, onPreview, onDelete }: {
  listing: ListingGalleryItem; source: string | null; deleting: boolean;
  onPreview(listing: ListingGalleryItem, trigger: HTMLButtonElement): void;
  onDelete(listing: ListingGalleryItem, trigger: HTMLButtonElement): void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const imageSource = source && attempt ? `${source}&retry=${attempt}` : source;
  const failed = imageSource !== null && failedSources.has(imageSource);
  return <li className="min-w-0">
    <figure className="overflow-hidden rounded-md border bg-card">
      <div className="relative flex aspect-square items-center justify-center bg-muted/20 p-2">
        {imageSource && !failed ? <button type="button" aria-label={`View full image for ${listing.listingName}`}
          className="flex h-full w-full items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={deleting} onClick={(event) => onPreview(listing, event.currentTarget)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={imageSource} src={imageSource} alt={`${listing.listingName} artwork thumbnail`}
            width={512} height={512} loading="lazy" decoding="async" className="h-full w-full object-contain"
            onError={() => setFailedSources((current) => current.has(imageSource) ? current : new Set([...current, imageSource]))} />
        </button> : <div className="flex flex-col items-center gap-2 p-2 text-center text-sm text-muted-foreground">
          <ImageIcon className="h-8 w-8" aria-hidden="true" />
          <p>{failed ? 'Thumbnail could not be loaded.' : listing.hasThumbnail ? 'Artwork unavailable for this listing.' : 'No thumbnail uploaded.'}</p>
          {failed ? <Button type="button" size="sm" variant="outline" aria-label={`Retry image for ${listing.listingName}`} disabled={deleting}
            onClick={() => setAttempt((value) => value + 1)}>Retry image</Button> : null}
        </div>}
      </div>
      <figcaption className="flex items-start justify-between gap-2 border-t p-3 text-sm font-medium">
        <span className="min-w-0 break-words">{listing.listingName}</span>
        <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label={`Delete ${listing.listingName}`}
          title={listing.canDelete === true && listing.subSectionId ? 'Delete listing' : listing.deleteDisabledReason ?? 'This listing cannot be deleted here.'}
          disabled={deleting || listing.canDelete !== true || !listing.subSectionId}
          onClick={(event) => onDelete(listing, event.currentTarget)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
      </figcaption>
    </figure>
  </li>;
}

function OriginalImageDialog({ listing, shopId, sectionId, onClose, onRestoreFocus }: {
  listing: ListingGalleryItem; shopId: string; sectionId: string; onClose(): void; onRestoreFocus(): void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [imageState, setImageState] = useState<{ source: string; status: 'loaded' | 'error' } | null>(null);
  const params = new URLSearchParams({ shopId, sectionId, subSectionId: listing.subSectionId!, listingId: listing.id });
  if (listing.thumbnailUpdatedAt) params.set('v', listing.thumbnailUpdatedAt);
  if (attempt) params.set('retry', String(attempt));
  const source = `/api/shops/listings/thumbnail?${params}`;
  const activeSource = useRef(source); activeSource.current = source;
  const status = imageState?.source === source ? imageState.status : 'loading';
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="fixed inset-0 left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-black p-0 text-white sm:rounded-none [&>button:last-child]:z-20 [&>button:last-child]:bg-background [&>button:last-child]:p-2 [&>button:last-child]:text-foreground"
      onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogTitle className="sr-only">Full image: {listing.listingName}</DialogTitle>
      <DialogDescription className="sr-only">Click the image or press Escape to return to the gallery.</DialogDescription>
      <button type="button" aria-label="Return to gallery" className="absolute inset-0 flex h-full w-full items-center justify-center" onClick={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={source} src={source} alt={`${listing.listingName} original artwork`} className={`h-full w-full object-contain${status === 'error' ? ' invisible' : ''}`}
          onLoad={() => { if (activeSource.current === source) setImageState({ source, status: 'loaded' }); }}
          onError={() => { if (activeSource.current === source) setImageState({ source, status: 'error' }); }} />
        {status === 'loading' ? <p role="status" className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm">Loading full image…</p> : null}
        {status === 'error' ? <p role="alert" className="absolute inset-0 flex items-center justify-center px-6 pb-16 text-center text-sm">Unable to load the full image. Click anywhere to return to the gallery.</p> : null}
      </button>
      {status === 'error' ? <Button type="button" variant="outline" className="absolute left-1/2 top-1/2 z-10 mt-5 -translate-x-1/2 text-foreground"
        onClick={() => setAttempt((value) => value + 1)}>Retry full image</Button> : null}
    </DialogContent>
  </Dialog>;
}

function GalleryContents({ shopId, sectionId, sectionName, onListingDeleted, onDeletingChange }: Pick<Props, 'shopId' | 'sectionId' | 'sectionName' | 'onListingDeleted' | 'onDeletingChange'>) {
  const [data, setData] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<ListingGalleryItem | null>(null);
  const [toDelete, setToDelete] = useState<ListingGalleryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteMessage, setDeleteMessage] = useState('');
  const imageTrigger = useRef<HTMLButtonElement | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const mounted = useRef(false), deletionLocked = useRef(false), busyNotified = useRef(false);
  const deletedCallback = useRef(onListingDeleted); deletedCallback.current = onListingDeleted;
  const busyCallback = useRef(onDeletingChange); busyCallback.current = onDeletingChange;
  const query = new URLSearchParams({ shopId, sectionId }).toString();

  function notifyDeleting(next: boolean) {
    if (busyNotified.current === next) return;
    busyNotified.current = next; busyCallback.current?.(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; notifyDeleting(false); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    void (async () => {
      try {
        const response = await fetch(`/api/shops/listings/gallery?${query}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to load the section images.');
        if (!validGallery(payload)) throw new Error('The section images could not be read. Try again.');
        if (!controller.signal.aborted) setData(payload);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load the section images.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [query, retry]);

  async function deleteListing() {
    const target = toDelete;
    if (!target || target.canDelete !== true || !target.subSectionId || deletionLocked.current) return;
    deletionLocked.current = true; setDeleting(true); setDeleteError(''); notifyDeleting(true);
    try {
      const response = await fetch('/api/shops/listings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, sectionId, subSectionId: target.subSectionId, listingId: target.id }) });
      const payload = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to delete this listing. Try again.');
      if (String(payload?.deletedId ?? '') !== target.id) throw new Error('The deleted listing could not be confirmed. Reload the gallery before trying again.');
      setData((current) => current ? { ...current, listings: current.listings.filter((listing) => listing.id !== target.id) } : current);
      setToDelete(null); setDeleteMessage(`${target.listingName} deleted.`);
      deletionLocked.current = false; setDeleting(false); notifyDeleting(false);
      deletedCallback.current?.(target.id);
    } catch (caught) {
      if (mounted.current) setDeleteError(caught instanceof Error ? caught.message : 'Unable to delete this listing. Try again.');
    } finally {
      deletionLocked.current = false;
      if (mounted.current) { setDeleting(false); notifyDeleting(false); }
    }
  }

  return <>
    <DialogHeader className="shrink-0 pr-8">
      <DialogTitle>Images: {data?.sectionName ?? sectionName}</DialogTitle>
      <DialogDescription>{data ? `${data.listings.length} ${data.listings.length === 1 ? 'listing' : 'listings'}. ` : ''}Artwork from every subsection in this section.</DialogDescription>
    </DialogHeader>
    <div ref={scrollArea} tabIndex={-1} aria-label="Section images" className="min-h-0 flex-1 overflow-y-auto pr-1" aria-busy={loading || deleting}>
      {deleteMessage ? <p role="status" className="mb-3 text-sm text-green-700">{deleteMessage}</p> : null}
      {loading ? <p role="status" className="p-4 text-sm text-muted-foreground">Loading section images…</p> : null}
      {error ? <div className="grid justify-items-start gap-3 p-4"><p role="alert" className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry gallery</Button></div> : null}
      {!loading && !error && data?.listings.length === 0 ? <p role="status" className="p-4 text-sm text-muted-foreground">No listings in this section.</p> : null}
      {data ? <ul aria-label="Section listing images" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {data.listings.map((listing) => {
          let source: string | null = null;
          if (listing.hasThumbnail && listing.subSectionId) {
            const params = new URLSearchParams({ shopId, sectionId, subSectionId: listing.subSectionId, listingId: listing.id, preview: '1' });
            if (listing.thumbnailUpdatedAt) params.set('v', listing.thumbnailUpdatedAt);
            source = `/api/shops/listings/thumbnail?${params}`;
          }
          return <GalleryCard key={`${listing.id}:${source ?? 'unavailable'}`} listing={listing} source={source} deleting={deleting}
            onPreview={(selected, trigger) => { imageTrigger.current = trigger; setPreview(selected); }}
            onDelete={(selected, trigger) => { deleteTrigger.current = trigger; setDeleteError(''); setToDelete(selected); }} />;
        })}
      </ul> : null}
    </div>
    {preview ? <OriginalImageDialog key={`${preview.id}:${preview.thumbnailUpdatedAt ?? ''}`} listing={preview} shopId={shopId} sectionId={sectionId}
      onClose={() => setPreview(null)} onRestoreFocus={() => { if (imageTrigger.current?.isConnected) imageTrigger.current.focus({ preventScroll: true }); }} /> : null}
    <Dialog open={toDelete !== null} onOpenChange={(open) => { if (!open && !deletionLocked.current) setToDelete(null); }}>
      <DialogContent onEscapeKeyDown={(event) => { if (deletionLocked.current) event.preventDefault(); event.stopPropagation(); }}
        onCloseAutoFocus={(event) => { event.preventDefault();
          if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus({ preventScroll: true });
          else scrollArea.current?.focus({ preventScroll: true });
        }}>
        <DialogHeader>
          <DialogTitle>Delete listing: {toDelete?.listingName}?</DialogTitle>
          <DialogDescription>Delete {toDelete?.listingName} and all its images?</DialogDescription>
        </DialogHeader>
        {deleting ? <p role="status" className="text-sm text-muted-foreground">Deleting {toDelete?.listingName}…</p> : null}
        {deleteError ? <p role="alert" className="text-sm text-destructive">{deleteError}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={deleting} onClick={() => setToDelete(null)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={() => { void deleteListing(); }}>{deleting ? 'Deleting…' : 'Yes, delete listing'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

export function SectionListingImageGallery({ open, onOpenChange, shopId, sectionId, sectionName, onRestoreFocus, onListingDeleted, onDeletingChange }: Props) {
  const deleting = useRef(false);
  const busyCallback = useRef(onDeletingChange); busyCallback.current = onDeletingChange;
  return <Dialog open={open} onOpenChange={(next) => { if (!deleting.current) onOpenChange(next); }}>
    <DialogContent className="flex h-[90vh] max-w-6xl flex-col" onCloseAutoFocus={onRestoreFocus ? (event) => { event.preventDefault(); onRestoreFocus(); } : undefined}>
      {open ? <GalleryContents key={`${shopId}:${sectionId}`} shopId={shopId} sectionId={sectionId} sectionName={sectionName}
        onListingDeleted={onListingDeleted} onDeletingChange={(next) => { deleting.current = next; busyCallback.current?.(next); }} /> : null}
    </DialogContent>
  </Dialog>;
}
