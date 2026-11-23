'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Move } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  cropRegionToArtworkPlacement,
  defaultNativeListingPrintCropDraft,
  fourByFivePrintCropDraft,
  moveNativePrintCrop,
  movePrintArtworkPlacement,
  PRINT_CROP_RATIOS,
  type ListingArtworkOrientation,
  type ListingPrintCropDraft,
  type ListingPrintCropSettings,
  type PrintArtworkPlacement,
} from '@/lib/listing-print-crops';
import { PRINTABLE_DOWNLOAD_SPECS, type PrintableDownloadRatio } from '@/lib/printable-download-specs';

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

type Interaction = {
  ratio: PrintableDownloadRatio;
  startX: number;
  startY: number;
  original: PrintArtworkPlacement;
};

function placementStyle(placement: PrintArtworkPlacement) {
  return {
    left: `${placement.x * 100}%`,
    top: `${placement.y * 100}%`,
    width: `${placement.width * 100}%`,
    height: `${placement.height * 100}%`,
  };
}

function cropRatioLabel(ratio: PrintableDownloadRatio, orientation: ListingArtworkOrientation) {
  if (ratio === 'iso-a1') return orientation === 'landscape' ? 'A (√2:1)' : 'A (1:√2)';
  const label = PRINT_CROP_RATIOS.find((candidate) => candidate.key === ratio)?.label ?? ratio;
  if (orientation === 'portrait') return label;
  const [width, height] = label.split(':');
  return height ? `${height}:${width}` : label;
}

function paperSizesLabel(ratio: PrintableDownloadRatio, orientation: ListingArtworkOrientation) {
  const sizes = PRINTABLE_DOWNLOAD_SPECS.find(({ key }) => key === ratio)?.supportedSizes ?? [];
  if (orientation === 'portrait') return sizes.join(', ');
  return sizes.map((size) => size.replace(/(\d+) x (\d+)/, '$2 x $1')).join(', ');
}

export function ListingPrintCropDialog({
  open,
  onOpenChange,
  imageUrl,
  sourceDimensions,
  context,
  orientation,
  initialSettings,
  saving,
  continuationLabel,
  errorMessage,
  onSave,
}: Props) {
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ListingPrintCropDraft | null>(null);
  const [activeRatio, setActiveRatio] = useState<PrintableDownloadRatio>('2x3');
  const [interaction, setInteraction] = useState<Interaction | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // Preview pixels can be much smaller (and slightly rounded) than the
    // original. Keep crop geometry tied to the saved artwork dimensions.
    const dimensions = initialSettings?.source ?? (sourceDimensions
      && Number.isSafeInteger(sourceDimensions.width) && sourceDimensions.width > 0
      && Number.isSafeInteger(sourceDimensions.height) && sourceDimensions.height > 0 ? sourceDimensions : null);
    setImageDimensions(dimensions);
    setPreviewLoaded(false);
    setLoadError(null);
    try {
      setDraft(initialSettings
        ? defaultNativeListingPrintCropDraft(initialSettings.source.width, initialSettings.source.height, orientation).sourceRatio === '4x5'
          ? fourByFivePrintCropDraft(initialSettings.source.width, initialSettings.source.height, orientation, initialSettings.regions)
          : { regions: initialSettings.regions, placements: initialSettings.placements }
        : null);
    } catch (error) {
      setDraft(null);
      setLoadError(error instanceof Error ? error.message : 'Unable to load the print-size crops.');
    }
    setActiveRatio('2x3');
    setInteraction(null);
    if (!dimensions) {
      const query = new URLSearchParams(context);
      void fetch(`/api/shops/listings/editor/print-crops?${query}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as { dimensions?: { width: number; height: number }; error?: string };
          if (!response.ok || !payload.dimensions) throw new Error(payload.error ?? 'Unable to load the thumbnail dimensions.');
          setImageDimensions(payload.dimensions);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setLoadError(error instanceof Error ? error.message : 'Unable to load the thumbnail dimensions.');
        });
    }
    return () => controller.abort();
  }, [open, initialSettings, orientation, sourceDimensions?.width, sourceDimensions?.height,
    context.shopId, context.sectionId, context.subSectionId, context.listingId]);

  useEffect(() => {
    if (!open || !previewLoaded || !imageDimensions || draft) return;
    try {
      setDraft(defaultNativeListingPrintCropDraft(imageDimensions.width, imageDimensions.height, orientation));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to create the print-size crops.');
    }
  }, [open, previewLoaded, imageDimensions, draft, initialSettings, orientation]);

  function startInteraction(
    event: ReactPointerEvent<HTMLElement>,
    ratio: PrintableDownloadRatio,
    placement: PrintArtworkPlacement,
  ) {
    if (saving) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({ ratio, startX: event.clientX, startY: event.clientY, original: placement });
  }

  function updateInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (!interaction || !draft || !imageDimensions || !imageFrameRef.current) return;
    const bounds = imageFrameRef.current.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const deltaX = (event.clientX - interaction.startX) / bounds.width;
    const deltaY = (event.clientY - interaction.startY) / bounds.height;

    if (sourceRatio === '4x5') {
      updateCrop(interaction.ratio, moveNativePrintCrop(interaction.original, deltaX, 0));
      return;
    }
    const moved = movePrintArtworkPlacement(interaction.original, deltaX, deltaY, orientation);
    setDraft({
      ...draft,
      placements: { ...draft.placements!, [interaction.ratio]: moved },
    });
  }

  function updateCrop(ratio: PrintableDownloadRatio, crop: PrintArtworkPlacement) {
    setDraft((current) => current ? {
      ...current,
      regions: { ...current.regions, [ratio]: crop },
      placements: { ...current.placements!, [ratio]: cropRegionToArtworkPlacement(crop) },
    } : null);
  }

  function finishInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setInteraction(null);
  }

  const activePlacement = draft?.placements?.[activeRatio] ?? null;
  const activeCrop = draft?.regions[activeRatio] ?? null;
  const activeLabel = cropRatioLabel(activeRatio, orientation);
  const sourceRatio = imageDimensions
    ? (() => {
        try { return defaultNativeListingPrintCropDraft(imageDimensions.width, imageDimensions.height, orientation).sourceRatio; }
        catch { return '2x3' as const; }
      })()
    : initialSettings?.sourceRatio ?? '2x3';
  const activeRatioSpec = PRINT_CROP_RATIOS.find(({ key }) => key === activeRatio)!;
  const paperAspect = orientation === 'landscape'
    ? activeRatioSpec.height / activeRatioSpec.width
    : activeRatioSpec.width / activeRatioSpec.height;
  const cropSelection = sourceRatio === '4x5';
  const sourceAspect = imageDimensions ? imageDimensions.width / imageDimensions.height : paperAspect;
  const sourcePadding = cropSelection && activeCrop ? Math.max(0, activeCrop.width - 1) : 0;
  const canvasSpan = 1 + (sourcePadding * 2);
  const canvasAspect = cropSelection ? sourceAspect * canvasSpan : paperAspect;
  const activeSelection = cropSelection ? activeCrop : activePlacement;
  const canMoveCrop = Boolean(activeCrop && Math.abs(activeCrop.width - 1) > 0.000001);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen); }}>
      <DialogContent className="flex max-h-[94vh] w-[min(96vw,1100px)] max-w-none flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Set Size</DialogTitle>
          <DialogDescription>
            {sourceRatio === '4x5'
              ? 'Choose the area of the thumbnail used for each paper aspect ratio. Each crop uses the full thumbnail height; drag its border left or right.'
              : 'Position the complete thumbnail on each paper aspect ratio. Portrait artwork moves vertically and landscape artwork moves horizontally.'}
          </DialogDescription>
          {continuationLabel ? <p className="text-sm font-medium">Save these sizes to continue {continuationLabel}.</p> : null}
          {errorMessage ? <p role="alert" className="text-sm text-destructive">{errorMessage}</p> : null}
        </DialogHeader>

        <div className="flex flex-wrap gap-3 rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <span><span className="text-muted-foreground">Thumbnail aspect ratio:</span> <strong>{sourceRatio === '4x5' ? '4:5' : '2:3'}</strong></span>
          <span><span className="text-muted-foreground">Orientation:</span> <strong>{orientation === 'landscape' ? 'Landscape' : 'Portrait'}</strong></span>
        </div>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Print crop ratio">
            {PRINT_CROP_RATIOS.map((ratio) => (
              <Button
                key={ratio.key}
                type="button"
                size="sm"
                className="h-auto max-w-64 flex-col items-start whitespace-normal py-2 text-left"
                variant={activeRatio === ratio.key ? 'default' : 'outline'}
                onClick={() => setActiveRatio(ratio.key)}
                role="tab"
                aria-selected={activeRatio === ratio.key}
              >
                <span className="font-semibold">{cropRatioLabel(ratio.key, orientation)}</span>
                <span className="text-[10px] font-normal opacity-80">
                  {paperSizesLabel(ratio.key, orientation)}
                </span>
              </Button>
            ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-neutral-900 p-3">
          <div
            className="relative mx-auto touch-none select-none"
            style={{ width: `min(100%, calc(62vh * ${canvasAspect}))`, aspectRatio: String(canvasAspect) }}
          >
            <div
              ref={imageFrameRef}
              data-testid="print-crop-source-frame"
              className={`absolute top-0 h-full border-2 border-white bg-white shadow-lg ${cropSelection ? '' : 'overflow-hidden'}`}
              style={{ left: `${sourcePadding / canvasSpan * 100}%`, width: `${100 / canvasSpan}%` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={cropSelection ? 'Complete listing thumbnail for crop selection' : `Complete listing thumbnail positioned on ${activeLabel} paper`}
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={!cropSelection && activePlacement ? placementStyle(activePlacement) : { inset: 0, width: '100%', height: '100%' }}
                onLoad={() => setPreviewLoaded(true)}
              />
              {loadError ? (
                <div className="absolute inset-0 grid place-items-center bg-black/75 p-6 text-center text-sm text-white">{loadError}</div>
              ) : !draft ? (
                <div className="absolute inset-0 grid place-items-center bg-black/50 text-sm font-medium text-white">Loading crop editor...</div>
              ) : null}
              {activeSelection ? (
                <div
                  data-testid="print-crop-selection"
                  aria-label={`${activeLabel} ${cropSelection ? 'crop area' : 'artwork placement'}`}
                  role={cropSelection ? 'slider' : undefined}
                  tabIndex={cropSelection && !saving && canMoveCrop ? 0 : undefined}
                  aria-orientation={cropSelection ? 'horizontal' : undefined}
                  aria-valuemin={cropSelection ? Math.min(0, 1 - activeSelection.width) : undefined}
                  aria-valuemax={cropSelection ? Math.max(0, 1 - activeSelection.width) : undefined}
                  aria-valuenow={cropSelection ? activeSelection.x : undefined}
                  aria-disabled={cropSelection ? saving || !canMoveCrop : undefined}
                  className={`absolute border-2 border-primary shadow-[0_0_0_1px_rgba(255,255,255,0.85)] ${cropSelection ? canMoveCrop ? 'cursor-ew-resize' : 'cursor-default' : orientation === 'landscape' ? 'cursor-ew-resize' : 'cursor-ns-resize'}`}
                  style={placementStyle(activeSelection)}
                  onPointerDown={(event) => startInteraction(event, activeRatio, activeSelection)}
                  onPointerMove={updateInteraction}
                  onPointerUp={finishInteraction}
                  onPointerCancel={finishInteraction}
                  onKeyDown={(event) => {
                    if (!cropSelection || saving || !canMoveCrop || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                    event.preventDefault();
                    updateCrop(activeRatio, moveNativePrintCrop(activeSelection, event.key === 'ArrowLeft' ? -0.01 : 0.01, 0));
                  }}
                >
                  <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">
                    <Move className="h-3 w-3" aria-hidden="true" /> {cropSelection ? 'Crop' : 'Artwork'}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {sourceRatio === '4x5'
              ? !canMoveCrop
                ? `The thumbnail exactly fills the ${activeLabel} crop.`
                : activeCrop && activeCrop.width > 1
                  ? 'This paper ratio is wider than the thumbnail. Move the border left or right to adjust the side margins.'
                  : `Drag the ${activeLabel} crop border left or right to select the area to generate.`
              : activePlacement && (orientation === 'landscape' ? Math.abs(activePlacement.width - 1) : Math.abs(activePlacement.height - 1)) <= 0.000001
              ? `The thumbnail exactly fills the ${activeLabel} paper.`
              : orientation === 'landscape'
                ? `Drag the thumbnail horizontally within the ${activeLabel} paper.`
                : `Drag the thumbnail vertically within the ${activeLabel} paper.`}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={() => draft && onSave(draft)} disabled={!draft || saving}>
              {saving ? 'Saving...' : continuationLabel ? `Save Size and continue ${continuationLabel}` : 'Save Size'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
