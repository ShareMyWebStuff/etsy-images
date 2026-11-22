'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Props = {
  shopId: string;
  sectionId: string;
  subSectionId: string;
  listing: { id: string; listingName: string; thumbnailUpdatedAt?: string | null } | null;
  onClose(): void;
  onRestoreFocus(): void;
};

export function ListingThumbnailPreviewDialog({ shopId, sectionId, subSectionId, listing, onClose, onRestoreFocus }: Props) {
  const [retry, setRetry] = useState(0);
  const [imageState, setImageState] = useState<{ source: string; status: 'loaded' | 'error' } | null>(null);
  const query = new URLSearchParams({ shopId, sectionId, subSectionId, listingId: listing?.id ?? '' });
  if (listing?.thumbnailUpdatedAt) query.set('v', listing.thumbnailUpdatedAt);
  if (retry) query.set('retry', String(retry));
  const source = `/api/shops/listings/thumbnail?${query}`;
  const status = imageState?.source === source ? imageState.status : 'loading';

  return <Dialog open={listing !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="flex h-[90vh] max-w-5xl flex-col" onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader className="shrink-0 pr-8">
        <DialogTitle>Thumbnail: {listing?.listingName}</DialogTitle>
        <DialogDescription className="sr-only">Enlarged artwork thumbnail for this listing.</DialogDescription>
      </DialogHeader>
      {listing ? <div className="relative min-h-0 flex-1 rounded-md bg-muted/20" aria-busy={status === 'loading'}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={source} src={source} alt={`${listing.listingName} artwork thumbnail`}
          className={`h-full w-full object-contain${status === 'error' ? ' invisible' : ''}`}
          onLoad={() => setImageState({ source, status: 'loaded' })}
          onError={() => setImageState({ source, status: 'error' })} />
        {status === 'loading' ? <p role="status" className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">Loading thumbnail...</p> : null}
        {status === 'error' ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-4 text-center">
          <p role="alert" className="text-sm text-destructive">Unable to load this listing's thumbnail. Try again.</p>
          <Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry image</Button>
        </div> : null}
      </div> : null}
    </DialogContent>
  </Dialog>;
}
