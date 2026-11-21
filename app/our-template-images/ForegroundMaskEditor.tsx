'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Eraser, Hand, Paintbrush, Redo2, Undo2, WandSparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  applyForegroundMaskStroke,
  MAX_FOREGROUND_MASK_POINTS,
  MAX_FOREGROUND_MASK_STROKES,
  rasterizeForegroundMask,
  validateForegroundMask,
  type ForegroundMaskRaster,
} from '@/lib/our-template-image-foreground-mask';
import { createForegroundRegionStroke, fillForegroundMaskHoles, smartSelectForeground } from '@/lib/our-template-image-smart-selection';
import { invertHomography, openingHomography, projectPoint } from '@/lib/our-template-image-geometry';
import type { TemplateOpeningCorners } from '@/lib/our-category-template-composite';
import type { ForegroundMaskStroke, OurTemplateImageForegroundMask } from '@/lib/our-template-image-types';

type Point = { x: number; y: number };
type Tool = 'paint' | 'erase' | 'pan' | 'smart';
type SelectionSource = { rgba: Uint8Array; width: number; height: number };
type SmartCandidate = ReturnType<typeof smartSelectForeground>;
type History = { entries: OurTemplateImageForegroundMask[]; index: number };
type PointerDrag = { pointerId: number } & (
  { kind: 'stroke'; stroke: ForegroundMaskStroke } |
  { kind: 'pan'; client: Point; initialPan: Point }
);

export type ForegroundMaskEditorProps = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  mask?: OurTemplateImageForegroundMask;
  onChange(mask: OurTemplateImageForegroundMask | undefined): void;
  disabled?: boolean;
  onClose(): void;
  openingCorners?: TemplateOpeningCorners[];
};

const emptyMask = (): OurTemplateImageForegroundMask => ({ version: 1, strokes: [] });
const copyMask = (mask?: OurTemplateImageForegroundMask) => mask ? structuredClone(mask) : emptyMask();

/** Edits source-pixel strokes; preview zoom and pan never alter saved coordinates. */
export function ForegroundMaskEditor({ imageUrl, imageWidth, imageHeight, mask, onChange, disabled = false, onClose, openingCorners }: ForegroundMaskEditorProps) {
  const [tool, setTool] = useState<Tool>('paint');
  const [size, setSize] = useState(Math.max(4, Math.min(100, Math.round(Math.min(imageWidth, imageHeight) / 40))));
  const [softness, setSoftness] = useState(0.3);
  const [showMask, setShowMask] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 480 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [error, setError] = useState('');
  const [sourceStatus, setSourceStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sensitivity, setSensitivity] = useState(40);
  const [candidate, setCandidate] = useState<SmartCandidate | null>(null);
  const [selectionSeed, setSelectionSeed] = useState<Point | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState('');
  const [history, setHistory] = useState<History>(() => ({ entries: [copyMask(mask)], index: 0 }));
  const historyRef = useRef(history);
  const previousPropRef = useRef(mask);
  const emittedMaskRef = useRef<OurTemplateImageForegroundMask | undefined>(mask);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const candidateCanvasRef = useRef<HTMLCanvasElement>(null);
  const selectionSourceRef = useRef<SelectionSource | null>(null);
  const selectionRequestRef = useRef(0);
  const rasterRef = useRef<ForegroundMaskRaster | null>(null);
  const dragRef = useRef<PointerDrag | null>(null);
  const spacePanRef = useRef(false);
  const strokePointBudgetRef = useRef(MAX_FOREGROUND_MASK_POINTS);
  const bindCanvas = useCallback((canvas: HTMLCanvasElement | null) => { canvasRef.current = canvas; setCanvasReady(canvas !== null); }, []);
  // Detail zoom uses one mask pixel per source pixel for typical 4096px Canva
  // exports. Rebuild only when crossing this threshold, never per pointer move.
  const previewLimit = zoom >= 4 ? 4096 : 2048;
  const previewScale = Math.min(1, previewLimit / Math.max(imageWidth, imageHeight));
  const previewWidth = Math.max(1, Math.round(imageWidth * previewScale));
  const previewHeight = Math.max(1, Math.round(imageHeight * previewScale));
  const analysisScale = Math.min(1, 1536 / Math.max(imageWidth, imageHeight));
  const analysisWidth = Math.max(1, Math.round(imageWidth * analysisScale));
  const analysisHeight = Math.max(1, Math.round(imageHeight * analysisScale));
  const openingSignature = JSON.stringify(openingCorners);
  const allowedMask = useMemo(() => {
    if (!openingCorners) return undefined;
    const allowed = new Uint8Array(analysisWidth * analysisHeight);
    for (const corners of openingCorners) {
      const points = Object.values(corners);
      const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) * analysisWidth / imageWidth));
      const right = Math.min(analysisWidth - 1, Math.ceil(Math.max(...points.map((point) => point.x)) * analysisWidth / imageWidth));
      const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) * analysisHeight / imageHeight));
      const bottom = Math.min(analysisHeight - 1, Math.ceil(Math.max(...points.map((point) => point.y)) * analysisHeight / imageHeight));
      const inverse = invertHomography(openingHomography(corners));
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const point = projectPoint(inverse, { x: (x + 0.5) * imageWidth / analysisWidth - 0.5, y: (y + 0.5) * imageHeight / analysisHeight - 0.5 });
        if (point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) allowed[y * analysisWidth + x] = 255;
      }
    }
    return allowed;
  }, [openingSignature, imageWidth, imageHeight, analysisWidth, analysisHeight]);

  function viewGeometry() {
    const viewport = viewportRef.current;
    const bounds = viewport?.getBoundingClientRect();
    const { width, height } = viewportSize;
    const scale = Math.min(width / imageWidth, height / imageHeight) * zoom;
    return { bounds, borderLeft: viewport?.clientLeft ?? 0, borderTop: viewport?.clientTop ?? 0, width, height, scale, x: (width - imageWidth * scale) / 2 + pan.x, y: (height - imageHeight * scale) / 2 + pan.y };
  }

  function drawDirty(rect: { left: number; top: number; width: number; height: number } | null) {
    const raster = rasterRef.current;
    const context = canvasRef.current?.getContext('2d');
    if (!rect || !raster || !context) return;
    const image = context.createImageData(rect.width, rect.height);
    for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
      const target = (y * rect.width + x) * 4;
      image.data[target] = 16;
      image.data[target + 1] = 185;
      image.data[target + 2] = 129;
      image.data[target + 3] = Math.round(raster.alpha[(rect.top + y) * raster.width + rect.left + x] * 0.55);
    }
    context.putImageData(image, rect.left, rect.top);
  }

  function rebuildPreview(next: OurTemplateImageForegroundMask) {
    rasterRef.current = rasterizeForegroundMask(next, previewWidth, previewHeight, { sourceWidth: imageWidth, sourceHeight: imageHeight });
    drawDirty({ left: 0, top: 0, width: previewWidth, height: previewHeight });
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const bounds = viewport.getBoundingClientRect();
      const width = viewport.clientWidth || bounds.width;
      const height = viewport.clientHeight || bounds.height;
      if (width > 0 && height > 0) setViewportSize({ width, height });
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure); observer.observe(viewport);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [canvasReady]);

  useEffect(() => {
    rebuildPreview(historyRef.current.entries[historyRef.current.index]);
  }, [canvasReady, previewWidth, previewHeight, imageWidth, imageHeight]);

  useEffect(() => {
    if (mask === previousPropRef.current) return;
    previousPropRef.current = mask;
    if (mask === emittedMaskRef.current) return;
    dragRef.current = null; setDrawing(false);
    const next = { entries: [copyMask(mask)], index: 0 };
    historyRef.current = next; setHistory(next); rebuildPreview(next.entries[0]);
  }, [mask]);

  useEffect(() => () => { selectionRequestRef.current++; }, []);

  useEffect(() => {
    const context = candidateCanvasRef.current?.getContext('2d');
    if (!context) return;
    context.clearRect?.(0, 0, previewWidth, previewHeight);
    if (!candidate) return;
    const raster = rasterizeForegroundMask({ version: 1, strokes: [createForegroundRegionStroke(candidate.region)] }, previewWidth, previewHeight,
      { sourceWidth: imageWidth, sourceHeight: imageHeight });
    const image = context.createImageData(previewWidth, previewHeight);
    for (let i = 0; i < raster.alpha.length; i++) {
      image.data[i * 4] = 245; image.data[i * 4 + 1] = 158; image.data[i * 4 + 2] = 11; image.data[i * 4 + 3] = Math.round(raster.alpha[i] * 0.65);
    }
    context.putImageData(image, 0, 0);
  }, [candidate, canvasReady, previewWidth, previewHeight, imageWidth, imageHeight]);

  function loadSelectionSource(image: HTMLImageElement) {
    try {
      const canvas = document.createElement('canvas'); canvas.width = analysisWidth; canvas.height = analysisHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Image pixels are unavailable.');
      context.drawImage(image, 0, 0, analysisWidth, analysisHeight);
      const pixels = context.getImageData(0, 0, analysisWidth, analysisHeight).data;
      selectionSourceRef.current = { rgba: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), width: analysisWidth, height: analysisHeight };
      setSourceStatus('ready');
    } catch {
      selectionSourceRef.current = null; setSourceStatus('error');
      setSelectionNotice('Smart select could not read this room image. Paint and Erase remain available.');
    }
  }

  function cancelSelection() {
    selectionRequestRef.current++; setCandidate(null); setSelectionSeed(null); setSelecting(false);
  }

  function selectForeground(point: Point, nextSensitivity = sensitivity, delay = 0) {
    const source = selectionSourceRef.current;
    if (!source) { setError('Wait for the room image to load before using Smart select.'); return; }
    const seed = { x: Math.max(0, Math.min(source.width - 1, Math.round((point.x + 0.5) * source.width / imageWidth - 0.5))),
      y: Math.max(0, Math.min(source.height - 1, Math.round((point.y + 0.5) * source.height / imageHeight - 0.5))) };
    if (allowedMask && !allowedMask[seed.y * source.width + seed.x]) {
      setError('Click the part of the foreground object inside a print opening. Smart select stays within those openings.'); return;
    }
    const request = ++selectionRequestRef.current;
    setSelectionSeed(point); setSelecting(true); setCandidate(null); setError(''); setSelectionNotice('');
    setTimeout(() => {
      if (request !== selectionRequestRef.current) return;
      try {
        const existingMask = rasterizeForegroundMask(historyRef.current.entries[historyRef.current.index], source.width, source.height,
          { sourceWidth: imageWidth, sourceHeight: imageHeight });
        const result = smartSelectForeground({ ...source, seed, sensitivity: nextSensitivity / 100, existingMask, allowedMask });
        setCandidate(result);
      } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to suggest this foreground area. Try another point or use Paint.'); }
      finally { setSelecting(false); }
    }, delay);
  }

  function applySelection() {
    if (!candidate || disabled) return;
    const current = historyRef.current.entries[historyRef.current.index];
    const next: OurTemplateImageForegroundMask = { version: 1, strokes: [...current.strokes, createForegroundRegionStroke(candidate.region)] };
    if (pushHistory(next)) { cancelSelection(); rebuildPreview(next); setSelectionNotice('Selection added. Use Paint or Erase to refine its edges, or click another foreground area.'); }
  }

  function fillGaps() {
    if (disabled || drawing || selecting || candidate) return;
    try {
      const current = historyRef.current.entries[historyRef.current.index];
      const raster = rasterizeForegroundMask(current, analysisWidth, analysisHeight, { sourceWidth: imageWidth, sourceHeight: imageHeight });
      const region = fillForegroundMaskHoles(raster, { allowedMask });
      const regionStroke = createForegroundRegionStroke(region);
      const filled = rasterizeForegroundMask({ version: 1, strokes: [regionStroke] }, analysisWidth, analysisHeight);
      if (!filled.alpha.some((alpha, index) => alpha > raster.alpha[index] + 1)) { setSelectionNotice('No enclosed gaps found. Use Paint to close an open outline, then try Fill gaps again.'); return; }
      const next: OurTemplateImageForegroundMask = { version: 1, strokes: [...current.strokes, regionStroke] };
      if (pushHistory(next)) { rebuildPreview(next); setSelectionNotice('Enclosed gaps filled. Undo restores the previous protection.'); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to fill the mask gaps.'); }
  }

  function chooseTool(next: Tool) { if (next === 'paint' || next === 'erase') cancelSelection(); setTool(next); setError(''); }

  function emit(next: OurTemplateImageForegroundMask) {
    const value = next.strokes.length ? next : undefined;
    emittedMaskRef.current = value;
    onChange(value);
  }

  function pushHistory(next: OurTemplateImageForegroundMask) {
    try { next = validateForegroundMask(next, imageWidth, imageHeight); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'This mask exceeds the saved selection limit.'); return false; }
    const current = historyRef.current;
    const updated = { entries: [...current.entries.slice(0, current.index + 1), next], index: current.index + 1 };
    historyRef.current = updated; setHistory(updated); emit(next);
    return true;
  }

  function moveHistory(direction: -1 | 1) {
    if (disabled || drawing || selecting || candidate) return;
    const current = historyRef.current;
    const index = Math.max(0, Math.min(current.entries.length - 1, current.index + direction));
    if (index === current.index) return;
    const updated = { ...current, index };
    historyRef.current = updated; setHistory(updated);
    setError(''); rebuildPreview(current.entries[index]); emit(current.entries[index]);
  }

  function sourcePoint(clientX: number, clientY: number, clamp: boolean): Point | null {
    const view = viewGeometry();
    if (!view.bounds || view.scale <= 0) return null;
    const x = (clientX - view.bounds.left - view.borderLeft - view.x) / view.scale;
    const y = (clientY - view.bounds.top - view.borderTop - view.y) / view.scale;
    if (!clamp && (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight)) return null;
    return { x: Math.round(Math.max(0, Math.min(imageWidth - 1, x)) * 100) / 100,
      y: Math.round(Math.max(0, Math.min(imageHeight - 1, y)) * 100) / 100 };
  }

  function appendPoint(stroke: ForegroundMaskStroke, point: Point) {
    const previous = stroke.points.at(-1);
    if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < Math.max(0.25, stroke.size / 12)) return;
    if (stroke.points.length >= strokePointBudgetRef.current) {
      setError(`The mask has reached ${MAX_FOREGROUND_MASK_POINTS.toLocaleString()} brush points. Undo or clear some edits before painting more.`); return;
    }
    stroke.points.push(point);
    if (rasterRef.current) drawDirty(applyForegroundMaskStroke(rasterRef.current, stroke, { sourceWidth: imageWidth, sourceHeight: imageHeight, fromPointIndex: stroke.points.length - 1 }));
  }

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 && event.button !== 1 || dragRef.current) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    if (tool === 'pan' || spacePanRef.current || event.button === 1) {
      dragRef.current = { kind: 'pan', pointerId: event.pointerId, client: { x: event.clientX, y: event.clientY }, initialPan: { ...pan } };
    } else {
      const point = sourcePoint(event.clientX, event.clientY, false);
      if (!point) return;
      if (tool === 'smart') { selectForeground(point); return; }
      const current = historyRef.current.entries[historyRef.current.index];
      const pointCount = current.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
      if (current.strokes.length >= MAX_FOREGROUND_MASK_STROKES || pointCount >= MAX_FOREGROUND_MASK_POINTS) {
        setError(`This mask has reached its brush limit (${MAX_FOREGROUND_MASK_STROKES.toLocaleString()} strokes or ${MAX_FOREGROUND_MASK_POINTS.toLocaleString()} points). Undo or clear some edits before painting more.`); return;
      }
      strokePointBudgetRef.current = MAX_FOREGROUND_MASK_POINTS - pointCount;
      setError('');
      const stroke: ForegroundMaskStroke = { mode: tool, size, softness, points: [point] };
      dragRef.current = { kind: 'stroke', pointerId: event.pointerId, stroke };
      setDrawing(true);
      if (rasterRef.current) drawDirty(applyForegroundMaskStroke(rasterRef.current, stroke, { sourceWidth: imageWidth, sourceHeight: imageHeight }));
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (bounds) setCursor({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === 'pan') {
      setPan({ x: drag.initialPan.x + event.clientX - drag.client.x, y: drag.initialPan.y + event.clientY - drag.client.y });
      return;
    }
    const coalesced = event.nativeEvent.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [event];
    for (const sample of events) {
      const point = sourcePoint(sample.clientX, sample.clientY, true);
      if (point) appendPoint(drag.stroke, point);
    }
  }

  function finishPointer(event?: PointerEvent<HTMLDivElement>, cancel = false) {
    const drag = dragRef.current;
    if (!drag || event && drag.pointerId !== event.pointerId) return;
    dragRef.current = null; setDrawing(false);
    if (event?.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.kind !== 'stroke') return;
    if (cancel) { rebuildPreview(historyRef.current.entries[historyRef.current.index]); return; }
    if (event) {
      const point = sourcePoint(event.clientX, event.clientY, true);
      if (point) appendPoint(drag.stroke, point);
    }
    const current = historyRef.current.entries[historyRef.current.index];
    pushHistory({ version: 1, strokes: [...current.strokes, { ...drag.stroke, points: [...drag.stroke.points] }] });
  }

  function close() { finishPointer(); onClose(); }
  const fitScale = Math.min(viewportSize.width / imageWidth, viewportSize.height / imageHeight);
  const scale = fitScale * zoom;
  const offset = { x: (viewportSize.width - imageWidth * scale) / 2 + pan.x, y: (viewportSize.height - imageHeight * scale) / 2 + pan.y };
  const currentMask = history.entries[history.index];
  const manualStrokeCount = currentMask.strokes.filter((stroke) => !stroke.region).length;
  const selectionCount = currentMask.strokes.length - manualStrokeCount;

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-h-[96vh] max-w-6xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Keep in front</DialogTitle>
        <DialogDescription>Keep an ear, foot or other object in front of the print. Smart select suggests a connected area from the room image; check its amber preview before applying it. Green areas retain the original room pixels. Paint and Erase refine the result.</DialogDescription>
      </DialogHeader>
      <div role="toolbar" aria-label="Foreground mask tools" className="flex flex-wrap items-center gap-2">
        <Button variant={tool === 'smart' ? 'default' : 'outline'} aria-pressed={tool === 'smart'} disabled={disabled || drawing || sourceStatus !== 'ready'} onClick={() => chooseTool('smart')}><WandSparkles className="h-4 w-4" aria-hidden="true" />Smart select</Button>
        <Button variant={tool === 'paint' ? 'default' : 'outline'} aria-pressed={tool === 'paint'} disabled={disabled || drawing} onClick={() => chooseTool('paint')}><Paintbrush className="h-4 w-4" aria-hidden="true" />Paint</Button>
        <Button variant={tool === 'erase' ? 'default' : 'outline'} aria-pressed={tool === 'erase'} disabled={disabled || drawing} onClick={() => chooseTool('erase')}><Eraser className="h-4 w-4" aria-hidden="true" />Erase</Button>
        <Button variant={tool === 'pan' ? 'default' : 'outline'} aria-pressed={tool === 'pan'} disabled={disabled || drawing} onClick={() => chooseTool('pan')}><Hand className="h-4 w-4" aria-hidden="true" />Pan</Button>
        <Button variant="outline" aria-label="Undo mask edit" disabled={disabled || drawing || selecting || !!candidate || history.index === 0} onClick={() => moveHistory(-1)}><Undo2 className="h-4 w-4" aria-hidden="true" />Undo</Button>
        <Button variant="outline" aria-label="Redo mask edit" disabled={disabled || drawing || selecting || !!candidate || history.index === history.entries.length - 1} onClick={() => moveHistory(1)}><Redo2 className="h-4 w-4" aria-hidden="true" />Redo</Button>
        <Button variant="outline" disabled={disabled || drawing || selecting || !!candidate || currentMask.strokes.length === 0} onClick={fillGaps}>Fill gaps</Button>
        <Button variant="outline" disabled={disabled || drawing || selecting || !!candidate || currentMask.strokes.length === 0} onClick={() => { const next = emptyMask(); setError(''); pushHistory(next); rebuildPreview(next); }}>Clear mask</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {selectionNotice ? <p className="text-sm text-muted-foreground">{selectionNotice}</p> : null}
      {sourceStatus === 'loading' ? <p className="text-xs text-muted-foreground">Loading room pixels for Smart select. You can paint while the image loads.</p> : null}
      {tool === 'smart' ? <label className="grid gap-2 text-sm font-medium">Selection sensitivity: {sensitivity}%<input aria-label="Selection sensitivity" type="range" min="0" max="100" step="1" value={sensitivity} disabled={disabled} onChange={(event) => {
        const value = Number(event.target.value); setSensitivity(value); if (selectionSeed) selectForeground(selectionSeed, value, 100);
      }} /><span className="text-xs font-normal text-muted-foreground">Click the object inside a print opening. Increase sensitivity to include more shades; reduce it if the suggestion reaches the frame or background. This is a suggestion and may need Paint or Erase corrections.</span></label> : null}
      {selectionSeed ? <div role="region" aria-label="Suggested foreground selection" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950"><div>{selecting ? <p>Finding connected foreground…</p> : candidate ? <><p>Review the amber area, then apply it to keep those pixels in front.</p>{candidate.confidence === 'low' || candidate.touchesEdge ? <p className="mt-1 text-xs">The suggestion reaches a boundary or is uncertain. Check for background pixels and adjust sensitivity before applying.</p> : null}</> : <p>Adjust sensitivity or click another point to make a new suggestion.</p>}</div><div className="flex gap-2"><Button variant="outline" disabled={disabled || !candidate || selecting} onClick={applySelection}>Apply selection</Button><Button variant="outline" disabled={disabled} onClick={cancelSelection}>Cancel selection</Button></div></div> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm font-medium">Brush size: {size}px<input aria-label="Brush size in original pixels" type="range" min="1" max={Math.max(1, Math.min(512, Math.max(imageWidth, imageHeight)))} step="1" value={size} disabled={disabled || drawing} onChange={(event) => setSize(Number(event.target.value))} /></label>
        <label className="grid gap-1 text-sm font-medium">Edge softness: {Math.round(softness * 100)}%<input aria-label="Brush edge softness" type="range" min="0" max="100" step="1" value={Math.round(softness * 100)} disabled={disabled || drawing} onChange={(event) => setSoftness(Number(event.target.value) / 100)} /></label>
        <label className="grid gap-1 text-sm font-medium">Zoom<select aria-label="Mask zoom" value={zoom} disabled={drawing} onChange={(event) => setZoom(Number(event.target.value))} className="h-9 rounded-md border border-input bg-background px-2"><option value="1">Fit</option><option value="2">2× fit</option><option value="4">4× fit</option><option value="8">8× fit</option><option value="16">16× fit</option><option value="32">32× fit</option><option value="64">64× fit</option></select></label>
        <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={showMask} onChange={(event) => setShowMask(event.target.checked)} />Show mask</label><Button variant="outline" disabled={drawing} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit view</Button></div>
      </div>
      <div ref={viewportRef} role="group" aria-label="Foreground protection canvas" tabIndex={0}
        className={`relative h-[min(58vh,560px)] min-h-64 w-full touch-none overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring ${tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
        onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)} onLostPointerCapture={(event) => finishPointer(event, true)}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={(event) => {
          if (event.code === 'Space') { event.preventDefault(); spacePanRef.current = true; }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); moveHistory(event.shiftKey ? 1 : -1); }
        }} onKeyUp={(event) => { if (event.code === 'Space') spacePanRef.current = false; }} onBlur={() => { spacePanRef.current = false; }}>
        <div className="pointer-events-none absolute left-0 top-0" style={{ width: imageWidth, height: imageHeight, transformOrigin: '0 0', transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
          <img src={imageUrl} alt="Original room for foreground protection" draggable={false} onLoad={(event) => loadSelectionSource(event.currentTarget)} onError={() => { setSourceStatus('error'); setSelectionNotice('The room image could not be loaded. Close this editor and try reopening it.'); }} className="absolute left-0 top-0 select-none" style={{ width: imageWidth, height: imageHeight, maxWidth: 'none', imageRendering: zoom >= 4 ? 'pixelated' : 'auto' }} />
          <canvas ref={bindCanvas} aria-label="Painted foreground protection overlay" className="absolute left-0 top-0" width={previewWidth} height={previewHeight} style={{ width: imageWidth, height: imageHeight, opacity: showMask ? 1 : 0 }} />
          <canvas ref={candidateCanvasRef} aria-label="Suggested foreground selection overlay" className="absolute left-0 top-0" width={previewWidth} height={previewHeight} style={{ width: imageWidth, height: imageHeight, opacity: candidate && showMask ? 1 : 0 }} />
        </div>
        {cursor && (tool === 'paint' || tool === 'erase') && !disabled ? <div aria-hidden="true" className="pointer-events-none absolute rounded-full border border-white shadow-[0_0_0_1px_#065f46]" style={{ width: Math.max(2, size * scale), height: Math.max(2, size * scale), left: cursor.x, top: cursor.y, transform: 'translate(-50%, -50%)' }} /> : null}
      </div>
      <p role="status" className="text-sm text-muted-foreground">{currentMask.strokes.length ? `${manualStrokeCount} brush stroke${manualStrokeCount === 1 ? '' : 's'}${selectionCount ? ` and ${selectionCount} filled selection${selectionCount === 1 ? '' : 's'}` : ''} in this edit.` : 'No protected pixels yet.'} Paint and erase use original image pixels at every zoom. Use Pan or hold Space to reach details. Protection affects only artwork openings.</p>
      <DialogFooter><p className="mr-auto text-xs text-muted-foreground">Return to the editor, then save the template image to keep these changes.</p><Button variant="outline" onClick={close}>Back to template image</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
