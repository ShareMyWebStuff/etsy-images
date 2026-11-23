'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  type ListingArtworkOrientation,
  type ListingPrintCropDraft,
  type ListingPrintCropSettings,
} from '@/lib/listing-print-crops';
import { ListingPrintCropEditor } from './ListingPrintCropEditor';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  sourceDimensions?: { width: number; height: number } | null;
  context: { shopId: string; sectionId: string; subSectionId: string; listingId: string };
  orientation: ListingArtworkOrientation;
  initialSettings: ListingPrintCropSettings | null;
  saving: boolean;
  continuationLabel?: string;
  errorMessage?: string | null;
  onSave: (value: ListingPrintCropDraft) => void;
};

export function ListingPrintCropDialog({
  open, onOpenChange, imageUrl, sourceDimensions, context, orientation,
  initialSettings, saving, continuationLabel, errorMessage, onSave,
}: Props) {
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ListingPrintCropDraft | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // Rounded preview pixels must never replace the original artwork dimensions.
    const dimensions = initialSettings?.source ?? (sourceDimensions
      && Number.isSafeInteger(sourceDimensions.width) && sourceDimensions.width > 0
      && Number.isSafeInteger(sourceDimensions.height) && sourceDimensions.height > 0 ? sourceDimensions : null);
    setImageDimensions(dimensions);
    setPreviewLoaded(false);
    setLoadError(null);
    if (!dimensions) {
      const query = new URLSearchParams(context);
      void fetch(`/api/shops/listings/editor/print-crops?${query}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as { dimensions?: { width: number; height: number }; error?: string };
          if (!response.ok || !payload.dimensions) throw new Error(payload.error ?? 'Unable to load the thumbnail dimensions.');
          if (!controller.signal.aborted) setImageDimensions(payload.dimensions);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setLoadError(error instanceof Error ? error.message : 'Unable to load the thumbnail dimensions.');
        });
    }
    return () => controller.abort();
  }, [open, initialSettings, orientation, imageUrl, sourceDimensions?.width, sourceDimensions?.height,
    context.shopId, context.sectionId, context.subSectionId, context.listingId]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen); }}>
      <DialogContent className="flex max-h-[94vh] w-[min(96vw,1100px)] max-w-none flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Set Size</DialogTitle>
          <DialogDescription>Choose how your artwork fits each print size.</DialogDescription>
          {continuationLabel ? <p className="text-sm font-medium">Save these sizes to continue {continuationLabel}.</p> : null}
          {errorMessage ? <p role="alert" className="text-sm text-destructive">{errorMessage}</p> : null}
        </DialogHeader>
        <ListingPrintCropEditor
          imageUrl={imageUrl}
          sourceDimensions={imageDimensions}
          orientation={orientation}
          initialDraft={initialSettings}
          onChange={setDraft}
          onImageLoad={() => setPreviewLoaded(true)}
          onImageError={() => setPreviewLoaded(false)}
          errorMessage={loadError}
          saving={saving}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => draft && onSave(draft)} disabled={!draft || (!initialSettings && !previewLoaded) || saving}>
            {saving ? 'Saving...' : continuationLabel ? `Save Size and continue ${continuationLabel}` : 'Save Size'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
