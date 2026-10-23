'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { TemplateOpeningCorners, TemplateOpeningRegion } from '@/lib/our-category-template-composite';
import { defaultTemplateGridLayout, templateGridCellRects } from '@/lib/template-grid-layout';

type Point = { x: number; y: number };
type ImageSize = { width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type DragState =
  | { kind: 'create'; start: Point }
  | { kind: 'move'; start: Point; regionId: string; original: Rect }
  | { kind: 'resize'; start: Point; regionId: string; original: Rect; handle: ResizeHandle };

const AREA_COLOURS = ['#db2777', '#2563eb', '#16a34a', '#9333ea'] as const;
const HANDLE_POSITIONS: Array<{ handle: ResizeHandle; left: string; top: string; cursor: string }> = [
  { handle: 'nw', left: '0%', top: '0%', cursor: 'cursor-nwse-resize' },
  { handle: 'n', left: '50%', top: '0%', cursor: 'cursor-ns-resize' },
  { handle: 'ne', left: '100%', top: '0%', cursor: 'cursor-nesw-resize' },
  { handle: 'e', left: '100%', top: '50%', cursor: 'cursor-ew-resize' },
  { handle: 'se', left: '100%', top: '100%', cursor: 'cursor-nwse-resize' },
  { handle: 's', left: '50%', top: '100%', cursor: 'cursor-ns-resize' },
  { handle: 'sw', left: '0%', top: '100%', cursor: 'cursor-nesw-resize' },
  { handle: 'w', left: '0%', top: '50%', cursor: 'cursor-ew-resize' },
];

function rectFromCorners(corners: TemplateOpeningCorners): Rect {
  return {
    x: corners.topLeft.x,
    y: corners.topLeft.y,
    width: corners.topRight.x - corners.topLeft.x + 1,
    height: corners.bottomLeft.y - corners.topLeft.y + 1,
  };
}

function cornersFromRect(rect: Rect): TemplateOpeningCorners {
  const right = Math.round(rect.x + rect.width - 1);
  const bottom = Math.round(rect.y + rect.height - 1);
  return {
    topLeft: { x: Math.round(rect.x), y: Math.round(rect.y) },
    topRight: { x: right, y: Math.round(rect.y) },
    bottomRight: { x: right, y: bottom },
    bottomLeft: { x: Math.round(rect.x), y: bottom },
  };
}

function nextAreaName(regions: TemplateOpeningRegion[]) {
  const names = new Set(regions.map(({ name }) => name));
  for (let number = 1; number <= 99; number += 1) if (!names.has(`Area ${number}`)) return `Area ${number}`;
  return `Area ${regions.length + 1}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function TemplateGridAreaEditor({
  imageUrl,
  initialImageSize,
  regions,
  disabled,
  onImageSize,
  onRegionsChange,
  onEditRegion,
  onEditCell,
  onRequestDeleteRegion,
  onRemoveImage,
}: {
  imageUrl: string;
  initialImageSize?: ImageSize | null;
  regions: TemplateOpeningRegion[];
  disabled?: boolean;
  onImageSize(size: ImageSize): void;
  onRegionsChange(regions: TemplateOpeningRegion[]): void;
  onEditRegion(region: TemplateOpeningRegion): void;
  onEditCell(region: TemplateOpeningRegion, cellIndex: number): void;
  onRequestDeleteRegion(region: TemplateOpeningRegion): void;
  onRemoveImage(): void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(initialImageSize ?? null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(regions[0]?.id ?? null);

  useEffect(() => {
    setImageSize(initialImageSize ?? null);
  }, [imageUrl, initialImageSize?.height, initialImageSize?.width]);

  function pointFromEvent(event: ReactPointerEvent<HTMLElement>) {
    const image = imageRef.current;
    if (!image || !imageSize) return null;
    const bounds = image.getBoundingClientRect();
    return {
      x: clamp(Math.round((event.clientX - bounds.left) * imageSize.width / bounds.width), 0, imageSize.width - 1),
      y: clamp(Math.round((event.clientY - bounds.top) * imageSize.height / bounds.height), 0, imageSize.height - 1),
    };
  }

  function updateRegionRect(regionId: string, rect: Rect) {
    onRegionsChange(regions.map((region) => region.id === regionId ? { ...region, corners: cornersFromRect(rect) } : region));
  }

  function startCapturedDrag(event: ReactPointerEvent<HTMLElement>, drag: DragState) {
    if (disabled) return;
    dragRef.current = drag;
    rootRef.current?.setPointerCapture(event.pointerId);
  }

  function startCreate(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !creating || regions.length >= 4 || dragRef.current || event.button !== 0) return;
    const point = pointFromEvent(event);
    if (!point) return;
    startCapturedDrag(event, { kind: 'create', start: point });
    setDraft({ x: point.x, y: point.y, width: 1, height: 1 });
  }

  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageSize || !dragRef.current) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const drag = dragRef.current;
    if (drag.kind === 'create') {
      const left = Math.min(drag.start.x, point.x);
      const top = Math.min(drag.start.y, point.y);
      setDraft({ x: left, y: top, width: Math.abs(point.x - drag.start.x) + 1, height: Math.abs(point.y - drag.start.y) + 1 });
      return;
    }
    if (drag.kind === 'move') {
      const x = clamp(drag.original.x + point.x - drag.start.x, 0, imageSize.width - drag.original.width);
      const y = clamp(drag.original.y + point.y - drag.start.y, 0, imageSize.height - drag.original.height);
      updateRegionRect(drag.regionId, { ...drag.original, x, y });
      return;
    }
    const minimum = Math.max(12, Math.round(Math.min(imageSize.width, imageSize.height) * 0.02));
    let left = drag.original.x;
    let top = drag.original.y;
    let right = drag.original.x + drag.original.width - 1;
    let bottom = drag.original.y + drag.original.height - 1;
    if (drag.handle.includes('w')) left = clamp(point.x, 0, right - minimum + 1);
    if (drag.handle.includes('e')) right = clamp(point.x, left + minimum - 1, imageSize.width - 1);
    if (drag.handle.includes('n')) top = clamp(point.y, 0, bottom - minimum + 1);
    if (drag.handle.includes('s')) bottom = clamp(point.y, top + minimum - 1, imageSize.height - 1);
    updateRegionRect(drag.regionId, { x: left, y: top, width: right - left + 1, height: bottom - top + 1 });
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (rootRef.current?.hasPointerCapture(event.pointerId)) rootRef.current.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (drag?.kind === 'create' && draft && draft.width >= 12 && draft.height >= 12) {
      const region: TemplateOpeningRegion = {
        id: `grid-area-${Date.now()}-${regions.length + 1}`,
        name: nextAreaName(regions),
        corners: cornersFromRect(draft),
        grid: defaultTemplateGridLayout(1, 1),
      };
      onRegionsChange([...regions, region]);
      setSelectedRegionId(region.id);
      setCreating(false);
    }
    setDraft(null);
  }

  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-label="Artwork areas">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Artwork Areas</h2>
          <p className="text-sm text-muted-foreground">Add up to four rectangular areas. Drag inside an area to move it or use its edge and corner handles to resize it.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={creating ? 'default' : 'outline'} disabled={disabled || regions.length >= 4} onClick={() => setCreating((current) => !current)}>
            <Plus className="h-4 w-4" aria-hidden="true" />{creating ? 'Draw area' : 'Add Area'}
          </Button>
          <Button type="button" size="icon" variant="destructive" disabled={disabled} onClick={onRemoveImage} aria-label="Remove template image" title="Remove template image">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {regions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {regions.map((region, index) => (
            <div key={region.id} className={`flex items-center rounded-md border ${selectedRegionId === region.id ? 'border-primary bg-primary/5' : ''}`}>
              <button type="button" className="px-3 py-1.5 text-sm" onClick={() => setSelectedRegionId(region.id)}>{region.name}</button>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEditRegion(region)} disabled={disabled} aria-label={`Edit ${region.name}`}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => onRequestDeleteRegion(region)} disabled={disabled} aria-label={`Delete ${region.name}`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: AREA_COLOURS[index % AREA_COLOURS.length] }} />
            </div>
          ))}
        </div>
      ) : null}

      {creating ? <p className="rounded-md border border-pink-300 bg-pink-50 p-2 text-sm text-pink-900">Hold the left mouse button and drag over the template image to create the area.</p> : null}

      <div className="flex justify-center overflow-auto rounded-md border bg-muted/30 p-2">
        <div
          ref={rootRef}
          className={`relative inline-block touch-none select-none ${creating ? 'cursor-crosshair' : ''}`}
          onPointerDown={startCreate}
          onPointerMove={movePointer}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Template area selection"
            draggable={false}
            className="pointer-events-none block max-h-[68vh] max-w-full select-none"
            onLoad={(event) => {
              const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
              setImageSize(size);
              onImageSize(size);
            }}
          />
          {imageSize ? regions.map((region, index) => {
            const rect = rectFromCorners(region.corners);
            const colour = AREA_COLOURS[index % AREA_COLOURS.length];
            const selected = selectedRegionId === region.id;
            const cellRects = region.grid ? templateGridCellRects(rect.width, rect.height, region.grid) : [];
            return (
              <div
                key={region.id}
                className="absolute cursor-move border-2"
                style={{
                  left: `${rect.x / imageSize.width * 100}%`,
                  top: `${rect.y / imageSize.height * 100}%`,
                  width: `${rect.width / imageSize.width * 100}%`,
                  height: `${rect.height / imageSize.height * 100}%`,
                  borderColor: colour,
                  backgroundColor: `${colour}14`,
                }}
                onClick={(event) => { event.stopPropagation(); setSelectedRegionId(region.id); }}
                onPointerDown={(event) => {
                  if (creating || event.button !== 0) return;
                  event.stopPropagation();
                  const point = pointFromEvent(event);
                  if (!point) return;
                  setSelectedRegionId(region.id);
                  startCapturedDrag(event, { kind: 'move', start: point, regionId: region.id, original: rect });
                }}
              >
                <span className="pointer-events-none absolute left-1 top-1 z-20 rounded bg-background/90 px-1.5 py-0.5 text-xs font-semibold shadow">{region.name}</span>
                {cellRects.map((cellRect) => {
                  const cell = region.grid!.cells[cellRect.index];
                  return (
                    <button
                      key={cellRect.index}
                      type="button"
                      className={`absolute z-10 flex items-center justify-center border bg-white/50 text-[10px] font-semibold hover:bg-white/80 ${cell.configured ? '' : 'border-dashed'}`}
                      style={{
                        left: `${cellRect.x / rect.width * 100}%`,
                        top: `${cellRect.y / rect.height * 100}%`,
                        width: `${cellRect.width / rect.width * 100}%`,
                        height: `${cellRect.height / rect.height * 100}%`,
                        borderColor: cell.frameEnabled ? cell.frameFinish === 'black' ? '#111' : cell.frameFinish === 'white' ? '#ddd' : '#b9804d' : colour,
                        borderWidth: cell.frameEnabled ? 3 : 1,
                      }}
                      aria-label={`Edit ${region.name} Image ${cellRect.index + 1}`}
                      title={cell.configured ? `Edit Image ${cellRect.index + 1}` : `Edit Image ${cellRect.index + 1} default settings`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedRegionId(region.id);
                        onEditCell(region, cellRect.index);
                      }}
                    >Image {cellRect.index + 1}{cell.configured ? '' : ' · Set'}</button>
                  );
                })}
                {selected ? HANDLE_POSITIONS.map(({ handle, left, top, cursor }) => (
                  <button
                    key={handle}
                    type="button"
                    className={`absolute z-30 h-3.5 w-3.5 rounded-full border-2 border-white shadow ${cursor}`}
                    style={{ left, top, backgroundColor: colour, transform: 'translate(-50%, -50%)' }}
                    aria-label={`Resize ${region.name} from ${handle}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      const point = pointFromEvent(event);
                      if (!point) return;
                      startCapturedDrag(event, { kind: 'resize', start: point, regionId: region.id, original: rect, handle });
                    }}
                  />
                )) : null}
              </div>
            );
          }) : null}
          {imageSize && draft ? (
            <div className="pointer-events-none absolute border-2 border-dashed border-pink-600 bg-pink-500/15" style={{
              left: `${draft.x / imageSize.width * 100}%`,
              top: `${draft.y / imageSize.height * 100}%`,
              width: `${draft.width / imageSize.width * 100}%`,
              height: `${draft.height / imageSize.height * 100}%`,
            }} />
          ) : null}
        </div>
      </div>
    </section>
  );
}
