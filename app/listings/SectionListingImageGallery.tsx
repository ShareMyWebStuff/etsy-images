'use client';

import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ListingGalleryItem } from '@/lib/listing-gallery';

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  shopId: string;
  sectionId: string;
  sectionName: string;
  onRestoreFocus?(): void;
};
type GalleryData = { sectionName: string; listings: ListingGalleryItem[] };

function validGallery(value: unknown): value is GalleryData {
  const payload = value as GalleryData | undefined;
  return !!payload && typeof payload.sectionName === 'string' && Array.isArray(payload.listings)
    && payload.listings.every((listing) => !!listing && typeof listing.id === 'string' && !!listing.id
      && typeof listing.listingName === 'string' && typeof listing.hasThumbnail === 'boolean'
      && (listing.thumbnailUpdatedAt === null || typeof listing.thumbnailUpdatedAt === 'string')
      && (listing.subSectionId === null || typeof listing.subSectionId === 'string' && !!listing.subSectionId));
}

function GalleryCard({ listing, source }: { listing: ListingGalleryItem; source: string | null }) {
  const [attempt, setAttempt] = useState(0);
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const imageSource = source && attempt ? `${source}&retry=${attempt}` : source;
  const failed = imageSource !== null && failedSources.has(imageSource);
  return <li className="min-w-0">
    <figure className="overflow-hidden rounded-md border bg-card">
      <div className="relative flex aspect-square items-center justify-center bg-muted/20 p-2">
        {imageSource && !failed ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={imageSource} src={imageSource} alt={`${listing.listingName} artwork thumbnail`}
            width={512} height={512} loading="lazy" decoding="async" className="h-full w-full object-contain"
            onError={() => setFailedSources((current) => current.has(imageSource) ? current : new Set([...current, imageSource]))} />
        </> : <div className="flex flex-col items-center gap-2 p-2 text-center text-sm text-muted-foreground">
          <ImageIcon className="h-8 w-8" aria-hidden="true" />
          <p>{failed ? 'Thumbnail could not be loaded.' : listing.hasThumbnail ? 'Artwork unavailable for this listing.' : 'No thumbnail uploaded.'}</p>
          {failed ? <Button type="button" size="sm" variant="outline" aria-label={`Retry image for ${listing.listingName}`}
            onClick={() => setAttempt((value) => value + 1)}>Retry image</Button> : null}
        </div>}
      </div>
      <figcaption className="break-words border-t p-3 text-sm font-medium">{listing.listingName}</figcaption>
    </figure>
  </li>;
}

function GalleryContents({ shopId, sectionId, sectionName }: Pick<Props, 'shopId' | 'sectionId' | 'sectionName'>) {
  const [data, setData] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ shopId, sectionId }).toString();

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

  return <>
    <DialogHeader className="shrink-0 pr-8">
      <DialogTitle>Images: {data?.sectionName ?? sectionName}</DialogTitle>
      <DialogDescription>{data ? `${data.listings.length} ${data.listings.length === 1 ? 'listing' : 'listings'}. ` : ''}Artwork from every subsection in this section.</DialogDescription>
    </DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto pr-1" aria-busy={loading}>
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
          return <GalleryCard key={`${listing.id}:${source ?? 'unavailable'}`} listing={listing} source={source} />;
        })}
      </ul> : null}
    </div>
  </>;
}

export function SectionListingImageGallery({ open, onOpenChange, shopId, sectionId, sectionName, onRestoreFocus }: Props) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[90vh] max-w-6xl flex-col" onCloseAutoFocus={onRestoreFocus ? (event) => { event.preventDefault(); onRestoreFocus(); } : undefined}>
      {open ? <GalleryContents key={`${shopId}:${sectionId}`} shopId={shopId} sectionId={sectionId} sectionName={sectionName} /> : null}
    </DialogContent>
  </Dialog>;
}
