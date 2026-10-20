'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Move } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  centredArtworkPlacementForRatio,
  defaultNativeListingPrintCropDraft,
  movePrintArtworkPlacement,
  printArtworkPlacementScale,
  PRINT_CROP_RATIOS,
  scalePrintArtworkPlacement,
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
  context: { shopId: string; sectionId: string; subSectionId: string; listingId: string };
  orientation: ListingArtworkOrientation;
  initialSettings: ListingPrintCropSettings | null;
  saving: boolean;
  onSave: (value: ListingPrintCropDraft) => void;
};

type Interaction = {
  ratio: PrintableDownloadRatio;
  startX: number;
  startY: number;
  placement: PrintArtworkPlacement;
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
  context,
  orientation,
  initialSettings,
  saving,
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
    setImageDimensions(initialSettings?.source ?? null);
    setPreviewLoaded(false);
    setLoadError(null);
    setDraft(initialSettings ? {
      regions: initialSettings.regions,
      placements: initialSettings.placements,
    } : null);
    setActiveRatio('2x3');
    setInteraction(null);
    if (!initialSettings) {
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
  }, [open, initialSettings, orientation, context.shopId, context.sectionId, context.subSectionId, context.listingId]);

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
    setInteraction({ ratio, startX: event.clientX, startY: event.clientY, placement });
  }

  function updateInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (!interaction || !draft || !imageDimensions || !imageFrameRef.current) return;
    const bounds = imageFrameRef.current.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const deltaX = (event.clientX - interaction.startX) / bounds.width;
    const deltaY = (event.clientY - interaction.startY) / bounds.height;

    const moved = movePrintArtworkPlacement(
      interaction.placement,
      deltaX,
      deltaY,
      orientation,
      sourceRatio === '4x5',
    );
    setDraft({
      ...draft,
      placements: { ...draft.placements!, [interaction.ratio]: moved },
    });
  }

  function finishInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setInteraction(null);
  }

  const activePlacement = draft?.placements?.[activeRatio] ?? null;
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
  const fullSizePlacement = imageDimensions
    ? centredArtworkPlacementForRatio(imageDimensions.width, imageDimensions.height, activeRatio, orientation)
    : null;
  const activeScale = activePlacement && fullSizePlacement
    ? printArtworkPlacementScale(activePlacement, fullSizePlacement)
    : 1;
  const canMoveFreely = Boolean(activePlacement
    && (activePlacement.width < 0.999999 || activePlacement.height < 0.999999));

  function updateScale(scale: number) {
    if (!draft?.placements || !activePlacement || !fullSizePlacement) return;
    setDraft({
      ...draft,
      placements: {
        ...draft.placements,
        [activeRatio]: scalePrintArtworkPlacement(activePlacement, fullSizePlacement, scale),
      },
    });
  }

  function centreArtwork() {
    if (!draft?.placements || !activePlacement) return;
    setDraft({
      ...draft,
      placements: {
        ...draft.placements,
        [activeRatio]: {
          ...activePlacement,
          x: (1 - activePlacement.width) / 2,
          y: (1 - activePlacement.height) / 2,
        },
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen); }}>
      <DialogContent className="flex max-h-[94vh] w-[min(96vw,1100px)] max-w-none flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Set Size</DialogTitle>
          <DialogDescription>
            {sourceRatio === '4x5'
              ? 'Scale and position the thumbnail separately on each paper aspect ratio. The saved paper layout is used whenever that size is generated.'
              : 'Position the complete thumbnail on each paper aspect ratio. Portrait artwork moves vertically and landscape artwork moves horizontally.'}
          </DialogDescription>
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

        {sourceRatio === '4x5' && activePlacement ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-4 py-3">
            <label className="flex min-w-64 flex-1 items-center gap-3 text-sm">
              <span className="whitespace-nowrap font-medium">Artwork scale</span>
              <input
                type="range"
                min="10"
                max="100"
                step="1"
                value={Math.round(activeScale * 100)}
                disabled={saving}
                className="min-w-32 flex-1 accent-primary"
                onChange={(event) => updateScale(Number(event.target.value) / 100)}
              />
              <span className="w-12 text-right text-sm tabular-nums">{Math.round(activeScale * 100)}%</span>
            </label>
            <Button type="button" size="sm" variant="outline" onClick={centreArtwork} disabled={saving}>Centre</Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-neutral-900 p-3">
          <div
            ref={imageFrameRef}
            className="relative mx-auto touch-none select-none overflow-hidden border-2 border-white bg-white shadow-lg"
            style={{ width: `min(100%, calc(62vh * ${paperAspect}))`, aspectRatio: String(paperAspect) }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`Complete listing thumbnail positioned on ${activeLabel} paper`}
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={activePlacement ? placementStyle(activePlacement) : { inset: 0, width: '100%', height: '100%' }}
              onLoad={() => setPreviewLoaded(true)}
            />
            {loadError ? (
              <div className="absolute inset-0 grid place-items-center bg-black/75 p-6 text-center text-sm text-white">{loadError}</div>
            ) : !draft ? (
              <div className="absolute inset-0 grid place-items-center bg-black/50 text-sm font-medium text-white">Loading crop editor...</div>
            ) : null}
            {activePlacement ? (
              <div
                className={`absolute border-2 border-primary shadow-[0_0_0_1px_rgba(255,255,255,0.85)] ${sourceRatio === '4x5' ? canMoveFreely ? 'cursor-move' : 'cursor-default' : orientation === 'landscape' ? 'cursor-ew-resize' : 'cursor-ns-resize'}`}
                style={placementStyle(activePlacement)}
                onPointerDown={(event) => startInteraction(event, activeRatio, activePlacement)}
                onPointerMove={updateInteraction}
                onPointerUp={finishInteraction}
                onPointerCancel={finishInteraction}
              >
                <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">
                  <Move className="h-3 w-3" aria-hidden="true" /> Artwork
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {sourceRatio === '4x5'
              ? !canMoveFreely
                ? 'Reduce the artwork scale to create space, then drag it anywhere within the paper.'
                : 'Drag the artwork horizontally or vertically to position it within the paper.'
              : activePlacement && (orientation === 'landscape' ? Math.abs(activePlacement.width - 1) : Math.abs(activePlacement.height - 1)) <= 0.000001
              ? `The thumbnail exactly fills the ${activeLabel} paper.`
              : orientation === 'landscape'
                ? `Drag the thumbnail horizontally within the ${activeLabel} paper.`
                : `Drag the thumbnail vertically within the ${activeLabel} paper.`}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={() => draft && onSave(draft)} disabled={!draft || saving}>
              {saving ? 'Saving...' : 'Save Size'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
