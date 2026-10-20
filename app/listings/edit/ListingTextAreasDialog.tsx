'use client';

import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  defaultListingPersonalisationTextAreaSettings,
  type ListingPersonalisationTextAreaSettings,
  type ListingPersonalisationTextAreas,
  type PersonalisationTextArea,
} from '@/lib/personalisation-text-areas';
import { PRINT_CROP_RATIOS, type ListingPrintCropSettings } from '@/lib/listing-print-crops';
import type { PrintableDownloadRatio } from '@/lib/printable-download-specs';

type AreaKey = 'top' | 'bottom';
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Interaction = {
  ratio: PrintableDownloadRatio;
  areaKey: AreaKey;
  handle: ResizeHandle | 'move';
  startClientX: number;
  startClientY: number;
  startArea: PersonalisationTextArea;
};

type ListingTextAreasDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  imageUrl: string;
  cropSettings: ListingPrintCropSettings;
  initialAreas: ListingPersonalisationTextAreaSettings | null;
  allowTop: boolean;
  allowBottom: boolean;
  saving: boolean;
  onSave(value: ListingPersonalisationTextAreaSettings): void;
};

const MIN_AREA_SIZE = 0.02;

function cloneLayout(value: ListingPersonalisationTextAreas, allowTop: boolean, allowBottom: boolean) {
  return {
    showTop: allowTop && value.showTop,
    showBottom: allowBottom && value.showBottom,
    top: { ...value.top },
    bottom: { ...value.bottom },
  };
}

function cloneSettings(
  initial: ListingPersonalisationTextAreaSettings | null,
  allowTop: boolean,
  allowBottom: boolean,
): ListingPersonalisationTextAreaSettings {
  const source = initial ?? defaultListingPersonalisationTextAreaSettings();
  return {
    version: 2,
    areasByRatio: Object.fromEntries(PRINT_CROP_RATIOS.map(({ key }) => [
      key,
      cloneLayout(source.areasByRatio[key], allowTop, allowBottom),
    ])) as ListingPersonalisationTextAreaSettings['areasByRatio'],
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function resizedArea(area: PersonalisationTextArea, handle: ResizeHandle | 'move', deltaX: number, deltaY: number) {
  if (handle === 'move') return { ...area, y: clamp(area.y + deltaY, 0, 1 - area.height) };
  let left = area.x;
  let top = area.y;
  let right = area.x + area.width;
  let bottom = area.y + area.height;
  if (handle.includes('w')) left = clamp(left + deltaX, 0, right - MIN_AREA_SIZE);
  if (handle.includes('e')) right = clamp(right + deltaX, left + MIN_AREA_SIZE, 1);
  if (handle.includes('n')) top = clamp(top + deltaY, 0, bottom - MIN_AREA_SIZE);
  if (handle.includes('s')) bottom = clamp(bottom + deltaY, top + MIN_AREA_SIZE, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const handles: Array<{ key: ResizeHandle; className: string; cursor: string }> = [
  { key: 'nw', className: '-left-1.5 -top-1.5', cursor: 'nwse-resize' },
  { key: 'n', className: 'left-1/2 -top-1.5 -translate-x-1/2', cursor: 'ns-resize' },
  { key: 'ne', className: '-right-1.5 -top-1.5', cursor: 'nesw-resize' },
  { key: 'e', className: '-right-1.5 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { key: 'se', className: '-bottom-1.5 -right-1.5', cursor: 'nwse-resize' },
  { key: 's', className: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { key: 'sw', className: '-bottom-1.5 -left-1.5', cursor: 'nesw-resize' },
  { key: 'w', className: '-left-1.5 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

function cropRatioLabel(ratio: PrintableDownloadRatio, orientation: ListingPrintCropSettings['orientation']) {
  if (ratio === 'iso-a1') return orientation === 'landscape' ? 'A (√2:1)' : 'A (1:√2)';
  const label = PRINT_CROP_RATIOS.find((candidate) => candidate.key === ratio)?.label ?? ratio;
  if (orientation === 'portrait') return label;
  const [width, height] = label.split(':');
  return height ? `${height}:${width}` : label;
}

export function ListingTextAreasDialog({
  open,
  onOpenChange,
  imageUrl,
  cropSettings,
  initialAreas,
  allowTop,
  allowBottom,
  saving,
  onSave,
}: ListingTextAreasDialogProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState(() => cloneSettings(initialAreas, allowTop, allowBottom));
  const [activeRatio, setActiveRatio] = useState<PrintableDownloadRatio>('2x3');
  const [interaction, setInteraction] = useState<Interaction | null>(null);

  useEffect(() => {
    if (open) {
      setSettings(cloneSettings(initialAreas, allowTop, allowBottom));
      setActiveRatio(cropSettings.sourceRatio ?? '2x3');
    }
  }, [open, initialAreas, allowTop, allowBottom, cropSettings.sourceRatio]);

  function updateLayout(
    update: (current: ListingPersonalisationTextAreas) => ListingPersonalisationTextAreas,
    ratio = activeRatio,
  ) {
    setSettings((current) => ({
      ...current,
      areasByRatio: { ...current.areasByRatio, [ratio]: update(current.areasByRatio[ratio]) },
    }));
  }

  useEffect(() => {
    if (!interaction) return;
    const pointerMove = (event: PointerEvent) => {
      const bounds = stageRef.current?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return;
      const deltaX = (event.clientX - interaction.startClientX) / bounds.width;
      const deltaY = (event.clientY - interaction.startClientY) / bounds.height;
      updateLayout((current) => ({
        ...current,
        [interaction.areaKey]: resizedArea(interaction.startArea, interaction.handle, deltaX, deltaY),
      }), interaction.ratio);
    };
    const pointerUp = () => setInteraction(null);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
    };
  }, [interaction]);

  const areas = settings.areasByRatio[activeRatio];
  const placement = cropSettings.placements[activeRatio];
  const ratio = PRINT_CROP_RATIOS.find(({ key }) => key === activeRatio)!;
  const aspect = cropSettings.orientation === 'landscape'
    ? ratio.height / ratio.width
    : ratio.width / ratio.height;

  function beginInteraction(event: ReactPointerEvent, areaKey: AreaKey, handle: ResizeHandle | 'move') {
    event.preventDefault();
    event.stopPropagation();
    setInteraction({
      ratio: activeRatio,
      areaKey,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startArea: { ...areas[areaKey] },
    });
  }

  function areaBox(areaKey: AreaKey, label: string, colour: string) {
    const area = areas[areaKey];
    const visible = areaKey === 'top' ? areas.showTop && allowTop : areas.showBottom && allowBottom;
    if (!visible) return null;
    return (
      <div
        className={`absolute select-none border-2 ${colour} bg-white/35 shadow-sm`}
        style={{
          left: `${area.x * 100}%`,
          top: `${area.y * 100}%`,
          width: `${area.width * 100}%`,
          height: `${area.height * 100}%`,
          cursor: interaction?.areaKey === areaKey && interaction.handle === 'move' ? 'grabbing' : 'grab',
        }}
        onPointerDown={(event) => beginInteraction(event, areaKey, 'move')}
      >
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-black drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">{label}</span>
        {handles.map((handle) => (
          <span
            key={handle.key}
            className={`absolute h-3 w-3 rounded-sm border border-white bg-primary shadow ${handle.className}`}
            style={{ cursor: handle.cursor }}
            onPointerDown={(event) => beginInteraction(event, areaKey, handle.key)}
          />
        ))}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen); }}>
      <DialogContent className="flex max-h-[94vh] w-[min(96vw,1100px)] max-w-none flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Set Text Areas</DialogTitle>
          <DialogDescription>
            Select each aspect ratio and position its Top Text and Bottom Text areas. Sizes that share an aspect ratio use the same saved layout.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Text-area aspect ratio">
          {PRINT_CROP_RATIOS.map(({ key }) => (
            <Button key={key} type="button" size="sm" variant={activeRatio === key ? 'default' : 'outline'} onClick={() => setActiveRatio(key)} disabled={saving} role="tab" aria-selected={activeRatio === key}>
              {cropRatioLabel(key, cropSettings.orientation)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={areas.showTop && allowTop} disabled={!allowTop || saving} onChange={(event) => updateLayout((current) => ({ ...current, showTop: event.target.checked }))} />
            Show top text for {cropRatioLabel(activeRatio, cropSettings.orientation)}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={areas.showBottom && allowBottom} disabled={!allowBottom || saving} onChange={(event) => updateLayout((current) => ({ ...current, showBottom: event.target.checked }))} />
            Show bottom text for {cropRatioLabel(activeRatio, cropSettings.orientation)}
          </label>
          {!allowTop ? <span className="text-muted-foreground">Top text is disabled for this listing.</span> : null}
          {!allowBottom ? <span className="text-muted-foreground">Bottom text is disabled for this listing.</span> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-3">
          <div ref={stageRef} className="relative mx-auto touch-none overflow-hidden bg-white" style={{ width: `min(100%, calc(62vh * ${aspect}))`, aspectRatio: String(aspect) }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`${cropRatioLabel(activeRatio, cropSettings.orientation)} listing crop with personalisation text areas`}
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={{
                left: `${placement.x * 100}%`,
                top: `${placement.y * 100}%`,
                width: `${placement.width * 100}%`,
                height: `${placement.height * 100}%`,
              }}
            />
            {areaBox('top', 'Top Text', 'border-sky-600')}
            {areaBox('bottom', 'Bottom Text', 'border-amber-600')}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => onSave(settings)} disabled={saving}>{saving ? 'Saving...' : 'Save Text Areas'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
