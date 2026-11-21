'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Point, TemplateOpeningCorners } from '@/lib/our-category-template-composite';
import type { OurTemplateImageOpening } from '@/lib/our-template-image-types';
import { CORNER_KEYS, CORNER_LABELS, polygonPoints } from './scene-preview';

type Props = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  opening: Pick<OurTemplateImageOpening, 'name' | 'corners'>;
  corner: keyof TemplateOpeningCorners;
  onMove(point: Point): void;
  onClose(): void;
};

export function CornerDetailEditor({ imageUrl, imageWidth, imageHeight, opening, corner, onMove, onClose }: Props) {
  const [magnification, setMagnification] = useState(4);
  // Keep the view anchored while the point moves; following each move would
  // change the mouse-to-image mapping and make fine dragging unstable.
  const [anchor] = useState(() => ({ ...opening.corners[corner] }));
  const handleRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ clientX: number; clientY: number; point: Point; pointerId: number } | null>(null);
  const point = opening.corners[corner];
  const label = CORNER_LABELS[CORNER_KEYS.indexOf(corner)];
  const imageStyle = {
    left: '50%', top: '50%', width: imageWidth * magnification, height: imageHeight * magnification,
    maxWidth: 'none', transform: `translate(${-anchor.x * magnification}px, ${-anchor.y * magnification}px)`,
  };

  function move(next: Point) {
    onMove({
      x: Math.max(0, Math.min(imageWidth - 1, Math.round(next.x))),
      y: Math.max(0, Math.min(imageHeight - 1, Math.round(next.y))),
    });
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus();
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, point: { ...point }, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    move({ x: drag.point.x + (event.clientX - drag.clientX) / magnification,
      y: drag.point.y + (event.clientY - drag.clientY) / magnification });
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter') { event.preventDefault(); onClose(); return; }
    const directions: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    };
    const delta = directions[event.key];
    if (!delta) return;
    event.preventDefault();
    move({ x: point.x + delta.x, y: point.y + delta.y });
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto" onOpenAutoFocus={(event) => {
      event.preventDefault(); handleRef.current?.focus();
    }}>
      <DialogHeader>
        <DialogTitle>{label} corner — {opening.name}</DialogTitle>
        <DialogDescription>Drag the ring to position the corner. Arrow keys move one original image pixel. Double-click the ring again, or press Escape, to return to the full image.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">Magnification
          <select aria-label="Corner magnification" value={magnification} onChange={(event) => {
            dragRef.current = null; setMagnification(Number(event.target.value));
          }} className="h-9 rounded-md border border-input bg-background px-2">
            <option value="2">2×</option><option value="4">4×</option><option value="8">8×</option>
          </select>
        </label>
        <p className="text-sm tabular-nums text-muted-foreground">X {point.x} · Y {point.y} (original pixels)</p>
      </div>
      <div role="group" aria-label="Zoomed corner preview" className="relative h-[min(52vh,440px)] min-h-48 w-full touch-none overflow-hidden rounded-md border bg-muted">
        <img src={imageUrl} alt="Magnified frame corner" draggable={false} className="pointer-events-none absolute select-none" style={{ ...imageStyle, imageRendering: 'pixelated' }} />
        <svg viewBox={`0 0 ${imageWidth} ${imageHeight}`} className="pointer-events-none absolute" style={imageStyle} aria-hidden="true">
          <polygon points={polygonPoints(opening.corners)} fill="none" stroke="#2563eb" strokeWidth={1 / magnification} />
        </svg>
        <button ref={handleRef} type="button" aria-label={`${label} corner of ${opening.name} in close-up`}
          title="Drag or use arrow keys; double-click to return to the full image"
          className="absolute z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full border-2 border-blue-600 bg-transparent shadow-[0_0_0_1px_white] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ left: `calc(50% + ${(point.x - anchor.x) * magnification}px)`, top: `calc(50% + ${(point.y - anchor.y) * magnification}px)` }}
          onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }} onLostPointerCapture={() => { dragRef.current = null; }}
          onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); dragRef.current = null; onClose(); }} onKeyDown={keyDown}>
          <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-blue-600 shadow-[0_1px_white]" />
          <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-blue-600 shadow-[1px_0_white]" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Each original pixel is shown {magnification} screen pixels wide. The ring stays the same size. Your changes remain in the editor when you zoom out; save the template image when finished.</p>
      <DialogFooter><Button variant="outline" onClick={onClose}>Back to full image</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
