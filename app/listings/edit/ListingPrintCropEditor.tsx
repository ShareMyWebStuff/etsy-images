'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Move } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  cropRegionToArtworkPlacement,
  defaultNativeListingPrintCropDraft,
  fourByFivePrintCropDraft,
  moveNativePrintCrop,
  movePrintArtworkPlacement,
  PRINT_CROP_RATIOS,
  type ListingArtworkOrientation,
  type ListingPrintCropDraft,
  type PrintArtworkPlacement,
} from '@/lib/listing-print-crops';
import { PRINTABLE_DOWNLOAD_SPECS, type PrintableDownloadRatio } from '@/lib/printable-download-specs';

type Props = {
  imageUrl: string;
  sourceDimensions: { width: number; height: number } | null;
  orientation: ListingArtworkOrientation;
  initialDraft?: ListingPrintCropDraft | null;
  onChange: (draft: ListingPrintCropDraft | null) => void;
  saving?: boolean;
  imageAlt?: string;
  onImageLoad?: () => void;
  onImageError?: () => void;
  errorMessage?: string | null;
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

/** Reuse with a row/session key when switching between different artwork. */
export function ListingPrintCropEditor({
  imageUrl, sourceDimensions, orientation, initialDraft, onChange, saving = false,
  imageAlt, onImageLoad, onImageError, errorMessage,
}: Props) {
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const changeCallback = useRef(onChange); changeCallback.current = onChange;
  const prepared = useMemo(() => {
    if (!sourceDimensions) return { draft: null, error: null };
    try {
      const native = defaultNativeListingPrintCropDraft(sourceDimensions.width, sourceDimensions.height, orientation);
      return { draft: initialDraft
        ? native.sourceRatio === '4x5'
          ? fourByFivePrintCropDraft(sourceDimensions.width, sourceDimensions.height, orientation, initialDraft.regions)
          : { regions: initialDraft.regions, placements: initialDraft.placements }
        : native, error: null };
    } catch (error) {
      return { draft: null, error: error instanceof Error ? error.message : 'Unable to create the print-size crops.' };
    }
  }, [sourceDimensions?.width, sourceDimensions?.height, orientation, initialDraft]);
  const [draft, setDraft] = useState<ListingPrintCropDraft | null>(prepared.draft);
  const [activeRatio, setActiveRatio] = useState<PrintableDownloadRatio>('2x3');
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [imageStatus, setImageStatus] = useState<{ imageUrl: string; state: 'loaded' | 'error' } | null>(null);
  const previewLoaded = imageStatus?.imageUrl === imageUrl && imageStatus.state === 'loaded';
  const displayError = errorMessage || prepared.error || (imageStatus?.imageUrl === imageUrl && imageStatus.state === 'error'
    ? 'Unable to load the artwork preview.' : null);

  useEffect(() => {
    setDraft(prepared.draft);
    setActiveRatio('2x3');
    setInteraction(null);
  }, [prepared, imageUrl]);

  useEffect(() => { changeCallback.current(draft); }, [draft]);

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
    if (saving || !interaction || !draft || !sourceDimensions || !imageFrameRef.current) return;
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
  const sourceRatio = sourceDimensions
    ? (() => {
        try { return defaultNativeListingPrintCropDraft(sourceDimensions.width, sourceDimensions.height, orientation).sourceRatio; }
        catch { return '2x3' as const; }
      })()
    : '2x3';
  const activeRatioSpec = PRINT_CROP_RATIOS.find(({ key }) => key === activeRatio)!;
  const paperAspect = orientation === 'landscape'
    ? activeRatioSpec.height / activeRatioSpec.width
    : activeRatioSpec.width / activeRatioSpec.height;
  const cropSelection = sourceRatio === '4x5';
  const sourceAspect = sourceDimensions ? sourceDimensions.width / sourceDimensions.height : paperAspect;
  const sourcePadding = cropSelection && activeCrop ? Math.max(0, activeCrop.width - 1) : 0;
  const canvasSpan = 1 + (sourcePadding * 2);
  const canvasAspect = cropSelection ? sourceAspect * canvasSpan : paperAspect;
  const activeSelection = cropSelection ? activeCrop : activePlacement;
  const canMoveCrop = Boolean(activeCrop && Math.abs(activeCrop.width - 1) > 0.000001);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <p className="shrink-0 text-sm text-muted-foreground">
        {sourceRatio === '4x5'
          ? 'Choose the area of the thumbnail used for each paper aspect ratio. Each crop uses the full thumbnail height; drag its border left or right. The area outside the crop border is blacked out.'
          : 'Position the complete thumbnail on each paper aspect ratio. Portrait artwork moves vertically and landscape artwork moves horizontally.'}
      </p>
        <div className="flex shrink-0 flex-wrap gap-3 rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <span><span className="text-muted-foreground">Thumbnail aspect ratio:</span> <strong>{sourceRatio === '4x5' ? '4:5' : '2:3'}</strong></span>
          <span><span className="text-muted-foreground">Orientation:</span> <strong>{orientation === 'landscape' ? 'Landscape' : 'Portrait'}</strong></span>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2" role="tablist" aria-label="Print crop ratio">
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

        <div className={`relative h-[62vh] min-h-40 flex-auto overflow-hidden rounded-md border p-3 ${cropSelection ? 'bg-black' : 'bg-neutral-900'}`}
          style={{ containerType: 'size' }}>
          <div className="absolute inset-3 flex items-center justify-center">
          <div
            className={`relative mx-auto touch-none select-none ${cropSelection ? 'overflow-hidden bg-white' : ''}`}
            style={{ width: `min(100%, calc(100cqh * ${canvasAspect}))`, aspectRatio: String(canvasAspect) }}
          >
            <div
              ref={imageFrameRef}
              data-testid="print-crop-source-frame"
              className={`absolute top-0 h-full border-2 border-white bg-white shadow-lg ${cropSelection ? '' : 'overflow-hidden'}`}
              style={{ left: `${sourcePadding / canvasSpan * 100}%`, width: `${100 / canvasSpan}%` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={imageUrl}
                src={imageUrl}
                alt={imageAlt ?? (cropSelection ? 'Complete listing thumbnail for crop selection' : `Complete listing thumbnail positioned on ${activeLabel} paper`)}
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={!cropSelection && activePlacement ? placementStyle(activePlacement) : { inset: 0, width: '100%', height: '100%' }}
                onLoad={() => { setImageStatus({ imageUrl, state: 'loaded' }); onImageLoad?.(); }}
                onError={() => { setImageStatus({ imageUrl, state: 'error' }); onImageError?.(); }}
              />
              {displayError ? (
                <div role="alert" className="absolute inset-0 z-10 grid place-items-center bg-black/75 p-6 text-center text-sm text-white">{displayError}</div>
              ) : !draft || !previewLoaded ? (
                <div role="status" className="absolute inset-0 z-10 grid place-items-center bg-black/50 text-sm font-medium text-white">Loading crop editor...</div>
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
                  style={{ ...placementStyle(activeSelection), ...(cropSelection
                    ? { boxShadow: '0 0 0 1px rgba(255,255,255,0.85), 0 0 0 100vmax #000' } : {}) }}
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
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
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
        </div>
    </div>
  );
}
