'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Download, FlaskConical, Paintbrush, Pencil, Plus, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  PAPER_RATIOS, constrainPaperPlacement, defaultPaperPlacement, detectOpeningAtPoint,
  estimateOpeningAspect, invertHomography, openingHomography, paperPlacementCorners, paperPlacementHeight, placementKey, projectPoint, rebaseOpeningPlacements, suggestPaperRatio, validateOurTemplateImageDefinition,
} from '@/lib/our-template-image-geometry';
import type { OurTemplateImageDefinition, OurTemplateImageOpening, PaperPlacement } from '@/lib/our-template-image-types';
import type { TemplateOpeningCorners } from '@/lib/our-category-template-composite';
import { CORNER_KEYS, CORNER_LABELS, paperCssTransform, pointInsideOpening, polygonPoints, scenePointToOpening } from './scene-preview';
import { CornerDetailEditor } from './CornerDetailEditor';
import { ForegroundMaskEditor } from './ForegroundMaskEditor';
import { ForegroundMaskPreview } from './ForegroundMaskPreview';
import { TemplateImageTagInput } from './TemplateImageTagInput';
import type { TemplateImageTag } from '@/lib/our-template-image-tag-types';
import { validateDefinitionChildMode, type TemplateImageDefinitionMode, type TemplateImageVariantSlot } from '@/lib/our-template-image-definition-types';

export type ChildEditingContext = { parentDefinitionId: string; mode: TemplateImageDefinitionMode; variantSlot: TemplateImageVariantSlot };

export type SceneImage = OurTemplateImageDefinition & {
  id: string; name: string; originalFileName: string; createdAt: string; updatedAt: string;
  tags?: TemplateImageTag[];
};
type DeleteImpact = { affectedTemplateCount: number; affectedImageTemplateCount: number; affectedListingCount: number };
type Point = { x: number; y: number };
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

export function sceneUrl(scene: SceneImage, preview = false) {
  return `/api/our-template-images/${encodeURIComponent(scene.id)}/image?${preview ? 'preview=1&' : ''}v=${encodeURIComponent(scene.updatedAt)}`;
}

function previewPaperCorners(opening: OurTemplateImageOpening, placement: PaperPlacement, aspect: number) {
  try { return paperPlacementCorners(opening.corners, placement, aspect, opening.ratio, opening.orientation); }
  catch { return opening.corners; }
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'The request could not be completed.');
  return payload as T;
}

export function newestScenes(images: SceneImage[]) {
  return [...images].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id, undefined, { numeric: true }));
}

function newOpening(corners: TemplateOpeningCorners, count: number, width: number, height: number): OurTemplateImageOpening {
  const suggestion = suggestPaperRatio(corners, width, height);
  const opening: OurTemplateImageOpening = { id: crypto.randomUUID(), name: `Opening ${count + 1}`, corners, imageItemNumber: 1, ratio: suggestion.ratio, orientation: suggestion.orientation, placements: {} };
  opening.placements[placementKey(opening.ratio, opening.orientation)] = defaultPaperPlacement(estimateOpeningAspect(corners, width, height), opening.ratio, opening.orientation);
  return opening;
}

export function SceneEditor({ initial, tagOptions, tagsLoading, tagsError, onReloadTags, onTagCreated, onCancel, onSaved, childContext, defaultName }: {
  initial: SceneImage | null; tagOptions: TemplateImageTag[]; tagsLoading: boolean; tagsError: string | null;
  onReloadTags(): void; onTagCreated(tag: TemplateImageTag): void; onCancel(): void; onSaved(image: SceneImage): void;
  childContext?: ChildEditingContext; defaultName?: string;
}) {
  const [name, setName] = useState(initial?.name ?? defaultName ?? '');
  const noAreas = childContext?.mode === 'no-areas';
  const [tags, setTags] = useState<TemplateImageTag[]>(initial?.tags ?? []);
  const [tagCreating, setTagCreating] = useState(false);
  const [definition, setDefinition] = useState<OurTemplateImageDefinition>(() => initial ? structuredClone(initial) : { width: 0, height: 0, openings: [], lightingMode: 'auto' });
  const [file, setFile] = useState<File | null>(null);
  const [whiteFile, setWhiteFile] = useState<File | null>(null);
  const [blackFile, setBlackFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState(initial ? sceneUrl(initial) : '');
  const [activeId, setActiveId] = useState(initial?.openings[0]?.id ?? '');
  const [zoomedCorner, setZoomedCorner] = useState<keyof TemplateOpeningCorners | null>(null);
  const [maskEditing, setMaskEditing] = useState(false);
  const [manualPoints, setManualPoints] = useState<Point[] | null>(null);
  const [notice, setNotice] = useState('Click inside a print opening to suggest its four inner corners.');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sampleImage, setSampleImage] = useState<HTMLImageElement | null>(null);
  const [sampleUrls, setSampleUrls] = useState<Record<string, string>>({});
  const [hasAlpha, setHasAlpha] = useState(false);
  const sourceRef = useRef<HTMLImageElement>(null);
  const pixelsRef = useRef<Uint8Array | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef('');
  const dragRef = useRef<{ kind: 'corner'; key: keyof TemplateOpeningCorners } | { kind: 'paper'; start: Point; placement: PaperPlacement } | null>(null);
  const active = definition.openings.find((opening) => opening.id === activeId);
  const aspect = active ? estimateOpeningAspect(active.corners, definition.width, definition.height) : 1;
  const placement = active ? active.placements[placementKey(active.ratio, active.orientation)] ?? defaultPaperPlacement(aspect, active.ratio, active.orientation) : null;
  const suggestion = active ? suggestPaperRatio(active.corners, definition.width, definition.height) : null;
  const cornerSignature = JSON.stringify(definition.openings.map(({ id, corners }) => ({ id, corners })));
  const alphaOpeningIds = useMemo(() => {
    const pixels = pixelsRef.current;
    if (!hasAlpha || !pixels) return new Set<string>();
    return new Set(definition.openings.filter((opening) => {
      const points = CORNER_KEYS.map((key) => opening.corners[key]);
      const inverse = invertHomography(openingHomography(opening.corners));
      const left = Math.min(...points.map((point) => point.x)), right = Math.max(...points.map((point) => point.x));
      const top = Math.min(...points.map((point) => point.y)), bottom = Math.max(...points.map((point) => point.y));
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        if (pixels[(y * definition.width + x) * 4 + 3] >= 250) continue;
        const point = projectPoint(inverse, { x, y });
        if (point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) return true;
      }
      return false;
    }).map((opening) => opening.id));
  }, [hasAlpha, definition.width, definition.height, cornerSignature]);

  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);
  useEffect(() => {
    if (!sampleImage) { setSampleUrls({}); return; }
    const previews: Record<string, string> = {};
    for (const spec of PAPER_RATIOS) for (const orientation of ['portrait', 'landscape'] as const) {
      const ratio = orientation === 'portrait' ? spec.width / spec.height : spec.height / spec.width;
      const canvas = document.createElement('canvas'); canvas.width = Math.round(400 * ratio); canvas.height = 400;
      const context = canvas.getContext('2d');
      if (!context) continue;
      const scale = Math.max(canvas.width / sampleImage.naturalWidth, canvas.height / sampleImage.naturalHeight);
      context.drawImage(sampleImage, (canvas.width - sampleImage.naturalWidth * scale) / 2, (canvas.height - sampleImage.naturalHeight * scale) / 2, sampleImage.naturalWidth * scale, sampleImage.naturalHeight * scale);
      previews[placementKey(spec.key, orientation)] = canvas.toDataURL('image/png');
    }
    setSampleUrls(previews);
  }, [sampleImage]);

  function updateOpening(changes: Partial<OurTemplateImageOpening>) {
    if (changes.corners && active) {
      try {
        const placements = rebaseOpeningPlacements(active, changes.corners, definition.width, definition.height);
        const validated = validateOurTemplateImageDefinition({ ...definition, openings: [{ ...active, ...changes, placements }] });
        changes = { ...changes, placements: validated.openings[0].placements };
      } catch { return; }
    }
    setDefinition((current) => ({ ...current, openings: current.openings.map((opening) => opening.id === activeId ? { ...opening, ...changes } : opening) }));
  }
  function updatePlacement(preferred: PaperPlacement) {
    if (!active) return;
    const next = constrainPaperPlacement(preferred, aspect, active.ratio, active.orientation);
    try { paperPlacementCorners(active.corners, next, aspect, active.ratio, active.orientation); }
    catch { setNotice('The paper cannot extend past the perspective horizon. Reduce its zoom.'); return; }
    updateOpening({ placements: { ...active.placements, [placementKey(active.ratio, active.orientation)]: next } });
  }
  function switchPaper(ratio = active?.ratio, orientation = active?.orientation) {
    if (!active || !ratio || !orientation || (childContext?.mode === 'both' && orientation !== childContext.variantSlot)) return;
    const key = placementKey(ratio, orientation);
    updateOpening({ ratio, orientation, placements: { ...active.placements, [key]: active.placements[key] ?? defaultPaperPlacement(aspect, ratio, orientation) } });
  }
  function imageLoaded() {
    const image = sourceRef.current;
    if (!image) return;
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('The browser could not read this PNG.');
      context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      pixelsRef.current = new Uint8Array(data.buffer);
      let transparent = false; for (let i = 3; i < data.length; i += 4) { if (data[i] < 255) { transparent = true; break; } }
      setHasAlpha(transparent);
      setDefinition((current) => ({ ...current, width: canvas.width, height: canvas.height }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to read PNG pixels.'); }
  }
  function chooseScene(next: File | null) {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith('.png') || next.size > 25 * 1024 * 1024) { setError('Choose a PNG file of 25 MB or smaller.'); return; }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(next); objectUrlRef.current = url;
    setFile(next); setImageUrl(url); setError(null); pixelsRef.current = null;
    setDefinition((current) => ({ ...current, width: 0, height: 0, openings: [], foregroundMask: undefined })); setActiveId(''); setManualPoints(null);
    setNotice('Click inside a print opening. Replacing the source image starts a new set of corners.');
  }
  function pointerPoint(event: ReactPointerEvent<HTMLElement>): Point | null {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds || !definition.width) return null;
    return { x: Math.max(0, Math.min(definition.width - 1, (event.clientX - bounds.left) * definition.width / bounds.width)), y: Math.max(0, Math.min(definition.height - 1, (event.clientY - bounds.top) * definition.height / bounds.height)) };
  }
  function addOpening(corners: TemplateOpeningCorners) {
    if (noAreas) return false;
    try {
      validateOurTemplateImageDefinition({ ...definition, openings: [{ id: 'new', name: 'New opening', corners, imageItemNumber: 1, ratio: 'iso-a1', orientation: 'portrait', placements: {} }] });
      const opening = newOpening(corners, definition.openings.length, definition.width, definition.height);
      if (childContext?.mode === 'both' && childContext.variantSlot !== 'single') {
        opening.orientation = childContext.variantSlot;
        opening.placements[placementKey(opening.ratio, opening.orientation)] = defaultPaperPlacement(estimateOpeningAspect(corners, definition.width, definition.height), opening.ratio, opening.orientation);
      }
      setDefinition((current) => ({ ...current, openings: [...current.openings, opening] })); setActiveId(opening.id); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Choose four valid inner corners.'); return false; }
  }
  function clickScene(event: ReactPointerEvent<HTMLDivElement>) {
    if (noAreas || event.button !== 0 || saving || dragRef.current) return;
    const point = pointerPoint(event); if (!point) return;
    if (manualPoints) {
      const points = [...manualPoints, { x: Math.round(point.x), y: Math.round(point.y) }];
      if (points.length === 4) { const added = addOpening(Object.fromEntries(CORNER_KEYS.map((key, index) => [key, points[index]])) as TemplateOpeningCorners); setManualPoints(added ? null : []); if (added) setNotice('Opening added. Drag the handles to refine the inner corners.'); }
      else setManualPoints(points);
      return;
    }
    const existing = definition.openings.find((opening) => pointInsideOpening(opening.corners, point));
    if (existing) { setActiveId(existing.id); return; }
    if (!pixelsRef.current) return;
    try {
      const result = detectOpeningAtPoint(pixelsRef.current, definition.width, definition.height, point);
      addOpening(result.corners);
      setNotice(result.confidence === 'low' ? 'The detected opening is uncertain. Correct the four handles or remove it and use Place four corners manually.' : 'Opening detected. Check the inner corners and drag any handle to correct it.');
      setError(null);
    } catch (caught) { setNotice('This opening could not be detected confidently. Use Place four corners manually.'); setError(caught instanceof Error ? caught.message : 'Detection failed.'); }
  }
  function startDrag(event: ReactPointerEvent<HTMLElement>, kind: 'corner' | 'paper', key?: keyof TemplateOpeningCorners) {
    event.stopPropagation(); if (!active || !placement || saving) return;
    const point = pointerPoint(event); if (!point) return;
    dragRef.current = kind === 'corner' ? { kind, key: key! } : { kind, start: scenePointToOpening(active.corners, point), placement };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function zoomCorner(key: keyof TemplateOpeningCorners) {
    if (saving) return;
    dragRef.current = null;
    setZoomedCorner(key);
  }
  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current; const point = pointerPoint(event); if (!drag || !point || !active) return;
    if (drag.kind === 'corner') updateOpening({ corners: { ...active.corners, [drag.key]: { x: Math.round(point.x), y: Math.round(point.y) } } });
    else { const planePoint = scenePointToOpening(active.corners, point); updatePlacement({ ...drag.placement, x: drag.placement.x + planePoint.x - drag.start.x, y: drag.placement.y + planePoint.y - drag.start.y }); }
  }
  async function save() {
    if (!name.trim()) { setError('Enter a template image name.'); return; }
    if (manualPoints || (!childContext && !definition.openings.length)) { setError('Finish at least one opening before saving.'); return; }
    try { if (childContext) validateDefinitionChildMode(childContext.mode, childContext.variantSlot, definition); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Check the artwork areas before saving.'); return; }
    if (definition.lightingMode === 'paired' && !initial && (!whiteFile || !blackFile)) { setError('Choose both the white-artwork and black-artwork Canva exports.'); return; }
    setSaving(true); setError(null);
    try {
      const form = new FormData(); form.set('name', name); form.set('definition', JSON.stringify(definition));
      if (childContext) { form.set('parentDefinitionId', childContext.parentDefinitionId); form.set('variantSlot', childContext.variantSlot); }
      form.set('tagIds', JSON.stringify(tags.map((tag) => tag.id)));
      if (file) form.set('file', file); if (whiteFile) form.set('whiteFile', whiteFile); if (blackFile) form.set('blackFile', blackFile);
      const endpoint = initial ? `/api/our-template-images/${encodeURIComponent(initial.id)}` : childContext
        ? `/api/our-template-image-definitions/${encodeURIComponent(childContext.parentDefinitionId)}/images` : '/api/our-template-images';
      const payload = await responseJson<{ image: SceneImage }>(await fetch(endpoint, { method: initial ? 'PATCH' : 'POST', body: form }));
      onSaved(payload.image);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save the template image.'); }
    finally { setSaving(false); }
  }
  function selectSample(sample: File | null) {
    if (!sample) return; const url = URL.createObjectURL(sample); const image = new Image();
    image.onload = () => { setSampleImage(image); URL.revokeObjectURL(url); };
    image.onerror = () => { URL.revokeObjectURL(url); setError('This sample artwork could not be read.'); }; image.src = url;
  }

  return <div className="grid gap-5"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{initial ? 'Edit template image' : 'Create template image'}</h1><div className="flex gap-2"><Button variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button><Button disabled={saving || tagCreating || !imageUrl} onClick={() => { void save(); }}><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Saving…' : 'Save template image'}</Button></div></div>
    {childContext ? <p className="w-fit rounded-full border px-3 py-1 text-sm font-medium">{childContext.mode === 'no-areas' ? 'No areas' : childContext.mode === 'combined' ? 'Combined' : `Both — ${childContext.variantSlot === 'landscape' ? 'Landscape' : 'Portrait'}`}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {active && zoomedCorner ? <CornerDetailEditor key={`${active.id}-${zoomedCorner}`} imageUrl={imageUrl}
      imageWidth={definition.width} imageHeight={definition.height} opening={active} corner={zoomedCorner}
      onMove={(point) => updateOpening({ corners: { ...active.corners, [zoomedCorner]: point } })}
      onClose={() => { dragRef.current = null; setZoomedCorner(null); }} /> : null}
    {maskEditing && imageUrl && definition.width ? <ForegroundMaskEditor imageUrl={imageUrl}
      imageWidth={definition.width} imageHeight={definition.height} mask={definition.foregroundMask} disabled={saving}
      openingCorners={definition.openings.map((opening) => opening.corners)}
      onChange={(foregroundMask) => setDefinition((current) => ({ ...current, foregroundMask }))}
      onClose={() => setMaskEditing(false)} /> : null}
    <div className="grid items-start gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Template image name<Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label><label className="grid gap-2 text-sm font-medium">Canva room PNG<Input type="file" accept="image/png,.png" onChange={(event) => chooseScene(event.target.files?.[0] ?? null)} /><span className="text-xs font-normal text-muted-foreground">{initial?.originalFileName ?? 'Use an ordinary flattened PNG or a PNG with transparent print openings.'}</span></label></div>
    <div className="grid gap-2"><TemplateImageTagInput tags={tagOptions} selected={tags} onChange={setTags} onCreated={onTagCreated} onBusyChange={setTagCreating} allowCreate disabled={saving || tagsLoading} /><p className="text-xs text-muted-foreground">Choose up to 10 tags. Type part of a tag name, then press Enter or click a suggestion. Create a new tag when you need one.</p>{tagsError ? <p role="alert" className="text-sm text-red-700">{tagsError} <button type="button" className="underline" onClick={onReloadTags}>Retry loading tags</button></p> : null}</div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"><Card><CardHeader><CardTitle>{noAreas ? 'Template image' : 'Print openings'}</CardTitle><CardDescription>{noAreas ? 'This image is used without artwork areas.' : 'Click inside each frame. The inner outline is the fixed visible opening; the dashed outline is the paper behind its mount.'}</CardDescription></CardHeader><CardContent className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {!noAreas ? <Button variant="secondary" aria-pressed={!maskEditing} disabled={!definition.width || saving} onClick={() => setMaskEditing(false)}>Adjust corners</Button> : null}
        <Button variant="outline" aria-haspopup="dialog" aria-pressed={maskEditing} disabled={!definition.width || saving} onClick={() => { dragRef.current = null; setManualPoints(null); setMaskEditing(true); }}><Paintbrush className="h-4 w-4" aria-hidden="true" />Keep in front</Button>
        {!noAreas ? <Button variant="outline" disabled={!definition.width || saving} onClick={() => { setManualPoints([]); setNotice('Place top-left, top-right, bottom-right, then bottom-left.'); }}>Place four corners manually</Button> : null}
        {manualPoints ? <Button variant="outline" onClick={() => setManualPoints(null)}>Cancel manual opening</Button> : null}
      </div>
      <p className="text-xs text-muted-foreground">Use Keep in front to select or paint over objects that overlap the print, such as a toy's ear or foot. {definition.foregroundMask?.strokes.length ? 'Foreground protection is configured.' : 'The mask is saved with this template image.'}</p>
      <p role="status" className="text-sm text-muted-foreground">{manualPoints ? `Click ${CORNER_LABELS[manualPoints.length].toLowerCase()} (${manualPoints.length + 1} of 4).` : notice}</p>
      {imageUrl ? <div ref={stageRef} className="relative isolate w-full touch-none overflow-hidden rounded-md border bg-muted" style={{ aspectRatio: definition.width ? `${definition.width}/${definition.height}` : undefined }} onPointerDown={clickScene}>
        <img ref={sourceRef} src={imageUrl} alt="Room scene opening editor" onLoad={imageLoaded} onError={() => setError('The room PNG could not be loaded.')} className="block w-full select-none" draggable={false} />
        {definition.width ? <div className="pointer-events-none absolute inset-0" style={{ transformOrigin: '0 0' }}><svg viewBox={`0 0 ${definition.width} ${definition.height}`} className="absolute inset-0 h-full w-full" aria-hidden="true"><defs>{definition.openings.map((opening) => <clipPath key={opening.id} id={`clip-${opening.id}`}><polygon points={polygonPoints(opening.corners)} /></clipPath>)}</defs></svg>
          {definition.openings.map((opening) => {
            const openingAspect = estimateOpeningAspect(opening.corners, definition.width, definition.height);
            const paper = opening.placements[placementKey(opening.ratio, opening.orientation)] ?? defaultPaperPlacement(openingAspect, opening.ratio, opening.orientation);
            const corners = previewPaperCorners(opening, paper, openingAspect);
            const sampleUrl = sampleUrls[placementKey(opening.ratio, opening.orientation)];
            return <svg key={opening.id} viewBox={`0 0 ${definition.width} ${definition.height}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true"><foreignObject x="0" y="0" width={definition.width} height={definition.height} clipPath={`url(#clip-${opening.id})`}><div style={{ position: 'absolute', width: 1, height: 1, transformOrigin: '0 0', transform: paperCssTransform(corners), background: '#dbeafe' }}>{sampleUrl ? <img src={sampleUrl} alt="" style={{ width: 1, height: 1, maxWidth: 'none' }} /> : <div style={{ width: 1, height: 1, background: 'linear-gradient(135deg, #93c5fd 0%, #f0f9ff 50%, #60a5fa 100%)' }} />}</div></foreignObject></svg>;
          })}
          {alphaOpeningIds.size > 0 && definition.lightingMode === 'auto' ? <svg viewBox={`0 0 ${definition.width} ${definition.height}`} className="absolute inset-0 h-full w-full" aria-hidden="true"><defs><clipPath id="scene-foreground-openings">{definition.openings.filter((opening) => alphaOpeningIds.has(opening.id)).map((opening) => <polygon key={opening.id} points={polygonPoints(opening.corners)} />)}</clipPath></defs><image href={imageUrl} width={definition.width} height={definition.height} clipPath="url(#scene-foreground-openings)" /></svg> : null}
          <ForegroundMaskPreview definition={definition} imageUrl={imageUrl} transparentOpeningIds={alphaOpeningIds} />
          <svg viewBox={`0 0 ${definition.width} ${definition.height}`} className="absolute inset-0 h-full w-full" aria-hidden="true">{definition.openings.map((opening) => {
            const openingAspect = estimateOpeningAspect(opening.corners, definition.width, definition.height);
            const paper = opening.placements[placementKey(opening.ratio, opening.orientation)] ?? defaultPaperPlacement(openingAspect, opening.ratio, opening.orientation);
            return <g key={opening.id}><polygon points={polygonPoints(previewPaperCorners(opening, paper, openingAspect))} fill="none" stroke="#eab308" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /><polygon points={polygonPoints(opening.corners)} fill="none" stroke={opening.id === activeId ? '#2563eb' : '#16a34a'} strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={opening.corners.topLeft.x} y={Math.max(12, opening.corners.topLeft.y - 8)} fill="#2563eb" fontSize={Math.max(12, definition.width / 65)}>{opening.name}</text></g>;
          })}{manualPoints?.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={definition.width / 100} fill="#2563eb" />)}</svg>
        </div> : null}
        {active ? CORNER_KEYS.map((key, index) => <button key={key} type="button" disabled={saving}
          aria-label={`${CORNER_LABELS[index]} corner of ${active.name}`}
          title="Double-click or press Enter for a close-up; drag or use arrow keys to move the corner"
          className="absolute z-20 h-5 w-5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-blue-600 shadow focus:ring-2 focus:ring-ring"
          style={{ left: `${active.corners[key].x / definition.width * 100}%`, top: `${active.corners[key].y / definition.height * 100}%` }}
          onPointerDown={(event) => startDrag(event, 'corner', key)} onPointerMove={moveDrag}
          onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}
          onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); zoomCorner(key); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); zoomCorner(key); return; }
            const delta: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
            if (!delta[event.key]) return;
            event.preventDefault();
            const current = active.corners[key];
            updateOpening({ corners: { ...active.corners, [key]: {
              x: Math.max(0, Math.min(definition.width - 1, current.x + delta[event.key].x)),
              y: Math.max(0, Math.min(definition.height - 1, current.y + delta[event.key].y)),
            } } });
          }} />) : null}
        {active && placement ? <button type="button" className="absolute z-10 -translate-x-1/2 -translate-y-1/2 touch-none rounded bg-white/90 px-2 py-1 text-xs text-blue-700 shadow" style={{ left: `${(active.corners.topLeft.x + active.corners.topRight.x + active.corners.bottomLeft.x + active.corners.bottomRight.x) / 4 / definition.width * 100}%`, top: `${(active.corners.topLeft.y + active.corners.topRight.y + active.corners.bottomLeft.y + active.corners.bottomRight.y) / 4 / definition.height * 100}%` }} aria-label={`Move paper in ${active.name}`} onPointerDown={(event) => startDrag(event, 'paper')} onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>Move paper</button> : null}
      </div> : <p className="rounded border border-dashed p-10 text-center text-sm text-muted-foreground">Upload a Canva room PNG to identify the print openings.</p>}
      <p className="text-xs text-muted-foreground">Double-click a corner dot for a close-up, then double-click it again to return. Arrow keys move one original image pixel. Corners stay fixed when browser zoom or preview size changes. Use Test after saving to see the final lighting.</p><label className="grid gap-2 text-sm font-medium">Preview sample artwork (optional)<Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectSample(event.target.files?.[0] ?? null)} /><span className="text-xs font-normal text-muted-foreground">A centred crop is shown on the paper. Final tests also support listing artwork with its saved crop.</span></label>
    </CardContent></Card>
    <div className="grid gap-4">{!noAreas ? <Card><CardHeader><CardTitle>Openings ({definition.openings.length})</CardTitle></CardHeader><CardContent className="grid gap-4">{definition.openings.length ? <label className="grid gap-2 text-sm font-medium">Selected opening<select className={selectClass} value={activeId} onChange={(event) => setActiveId(event.target.value)}>{definition.openings.map((opening) => <option key={opening.id} value={opening.id}>{opening.name} — artwork {opening.imageItemNumber}</option>)}</select></label> : <p className="text-sm text-muted-foreground">Click a print opening or place its four corners manually.</p>}{active && placement ? <>
      <label className="grid gap-2 text-sm font-medium">Opening name<Input value={active.name} maxLength={100} onChange={(event) => updateOpening({ name: event.target.value })} /></label><label className="grid gap-2 text-sm font-medium">Artwork item<Input aria-label="Artwork item" type="number" min="1" max="100" value={active.imageItemNumber} onChange={(event) => updateOpening({ imageItemNumber: Number(event.target.value) })} /><span className="text-xs font-normal text-muted-foreground">Use the same item number in several frames to repeat its artwork.</span></label>
      {suggestion ? <p className="text-sm text-muted-foreground">Suggested: {PAPER_RATIOS.find((ratio) => ratio.key === suggestion.ratio)?.label}, {suggestion.orientation}. About {Math.round(suggestion.croppedFraction * 100)}% hidden by the mount. Angled frames use estimated proportions in the frame plane; adjust the ratio if needed.</p> : null}
      <label className="grid gap-2 text-sm font-medium">Paper ratio<select className={selectClass} value={active.ratio} onChange={(event) => switchPaper(event.target.value as OurTemplateImageOpening['ratio'])}>{PAPER_RATIOS.map((ratio) => <option key={ratio.key} value={ratio.key}>{ratio.label}</option>)}</select></label><label className="grid gap-2 text-sm font-medium">Paper orientation<select className={selectClass} disabled={childContext?.mode === 'both'} value={active.orientation} onChange={(event) => switchPaper(active.ratio, event.target.value as OurTemplateImageOpening['orientation'])}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
      <label className="grid gap-2 text-sm font-medium"><span className="flex justify-between gap-3">Paper zoom<span aria-hidden="true">{Math.round(placement.width / defaultPaperPlacement(aspect, active.ratio, active.orientation).width * 100)}%</span></span><input aria-label="Paper zoom" type="range" min={defaultPaperPlacement(aspect, active.ratio, active.orientation).width} max={defaultPaperPlacement(aspect, active.ratio, active.orientation).width * 4} step="0.01" value={placement.width} onChange={(event) => { const width = Number(event.target.value); updatePlacement({ x: placement.x - (width - placement.width) / 2, y: placement.y - (paperPlacementHeight({ ...placement, width }, aspect, active.ratio, active.orientation) - paperPlacementHeight(placement, aspect, active.ratio, active.orientation)) / 2, width }); }} /></label>
      <div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-sm">Paper horizontal<Input type="number" step="0.01" value={Number(placement.x.toFixed(4))} onChange={(event) => updatePlacement({ ...placement, x: Number(event.target.value) })} /></label><label className="grid gap-1 text-sm">Paper vertical<Input type="number" step="0.01" value={Number(placement.y.toFixed(4))} onChange={(event) => updatePlacement({ ...placement, y: Number(event.target.value) })} /></label></div><p className="text-xs text-muted-foreground">Paper movement and zoom keep every opening corner covered. Each ratio and orientation keeps its own saved placement.</p><Button variant="outline" onClick={() => updatePlacement(defaultPaperPlacement(aspect, active.ratio, active.orientation))}>Centre and cover opening</Button><Button variant="outline" onClick={() => { const remaining = definition.openings.filter((opening) => opening.id !== activeId); setDefinition({ ...definition, openings: remaining }); setActiveId(remaining[0]?.id ?? ''); }}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove opening</Button>
    </> : null}</CardContent></Card> : null}
    <Card><CardHeader><CardTitle>Foreground and lighting</CardTitle></CardHeader><CardContent className="grid gap-3"><label className="grid gap-2 text-sm font-medium">Lighting method<select className={selectClass} value={definition.lightingMode} onChange={(event) => setDefinition({ ...definition, lightingMode: event.target.value as OurTemplateImageDefinition['lightingMode'] })}><option value="auto">Preserve transparent foreground</option><option value="opaque">Replace opaque opening pixels</option><option value="paired">White / black Canva exports</option></select></label><p className="text-xs text-muted-foreground">Transparent openings keep the original translucent shadows, reflections and foreground objects. A single opaque PNG replaces the selected opening pixels, including shadows baked into those pixels.</p>{definition.lightingMode === 'paired' ? <><p className="text-xs text-muted-foreground">Export the identical room twice: once with pure white artwork and once with pure black artwork. Both PNGs must match the room dimensions. The pair recovers visibility and lighting over the print.</p><label className="grid gap-2 text-sm font-medium">White artwork PNG<Input type="file" accept="image/png,.png" onChange={(event) => setWhiteFile(event.target.files?.[0] ?? null)} /></label><label className="grid gap-2 text-sm font-medium">Black artwork PNG<Input type="file" accept="image/png,.png" onChange={(event) => setBlackFile(event.target.files?.[0] ?? null)} /></label>{initial?.lightingMode === 'paired' ? <p className="text-xs text-muted-foreground">Leave both files empty to retain the saved pair.</p> : null}</> : null}</CardContent></Card></div></div>
  </div>;
}

export function SceneTest({ scene, onClose, onFitted, childContext }: { scene: SceneImage; onClose(): void; onFitted(image: SceneImage): void; childContext?: ChildEditingContext }) {
  const items = [...new Set(scene.openings.map((opening) => opening.imageItemNumber))].sort((a, b) => a - b);
  const [files, setFiles] = useState<Record<number, File | null>>({});
  const [listings, setListings] = useState<Record<number, string>>({});
  const [result, setResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fitStatus, setFitStatus] = useState('');
  const [artworks, setArtworks] = useState<Array<{ id: string; name: string; orientation?: 'portrait' | 'landscape' }>>([]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result); }, [result]);
  useEffect(() => { let mounted = true; fetch('/api/our-template-images/samples').then((response) => responseJson<{ artworks: Array<{ id: string; name: string; orientation?: 'portrait' | 'landscape' }> }>(response)).then((payload) => { if (mounted) setArtworks(payload.artworks); }).catch(() => {}); return () => { mounted = false; }; }, []);
  async function run() {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      for (const item of items) { if (files[item]) form.set(`artwork-${item}`, files[item]!); else if (listings[item]?.trim()) form.set(`listing-${item}`, listings[item].trim()); else throw new Error(`Choose artwork or a listing for artwork item ${item}.`); }
      const response = await fetch(`/api/our-template-images/${encodeURIComponent(scene.id)}/test`, { method: 'POST', body: form });
      if (!response.ok) { const payload = await response.json(); throw new Error(payload.error ?? 'Unable to render the test.'); }
      setResult(URL.createObjectURL(await response.blob()));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to render the test.'); }
    finally { setBusy(false); }
  }
  async function fitArtwork() {
    setBusy(true); setError(null); setFitStatus('');
    try {
      const definition: OurTemplateImageDefinition = {
        width: scene.width, height: scene.height, lightingMode: scene.lightingMode,
        ...(scene.foregroundMask ? { foregroundMask: scene.foregroundMask } : {}),
        openings: scene.openings.map((opening) => ({
          ...opening,
          placements: { ...opening.placements, [placementKey(opening.ratio, opening.orientation)]: defaultPaperPlacement(
            estimateOpeningAspect(opening.corners, scene.width, scene.height), opening.ratio, opening.orientation,
          ) },
        })),
      };
      const form = new FormData(); form.set('name', scene.name); form.set('definition', JSON.stringify(definition));
      if (childContext) { form.set('parentDefinitionId', childContext.parentDefinitionId); form.set('variantSlot', childContext.variantSlot); }
      const payload = await responseJson<{ image: SceneImage }>(await fetch(`/api/our-template-images/${encodeURIComponent(scene.id)}`, { method: 'PATCH', body: form }));
      onFitted(payload.image);
      setResult('');
      setFitStatus('Artwork fitted to the openings. Render the preview to see it. This placement is also saved for listing generation.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to fit the artwork.'); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>Test {scene.name}</DialogTitle><DialogDescription>Uses the listing image renderer, saved paper placement and lighting. Listing artwork uses its saved crop for the selected ratio. Uploads use a centred crop. Fit artwork to openings reduces excess paper zoom and saves the placement for listing generation. Rendering a test leaves listing files and regeneration status unchanged.</DialogDescription></DialogHeader><div className="grid gap-4 md:grid-cols-2">{items.map((item) => <fieldset key={item} className="grid gap-3 rounded-md border p-3"><legend className="px-1 text-sm font-semibold">Artwork item {item}</legend><p className="text-xs text-muted-foreground">Feeds {scene.openings.filter((opening) => opening.imageItemNumber === item).map((opening) => `${opening.name} (${PAPER_RATIOS.find((ratio) => ratio.key === opening.ratio)?.label}, ${opening.orientation})`).join(', ')}.</p><label className="grid gap-1 text-sm">Upload sample artwork {item}<Input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { setFiles({ ...files, [item]: event.target.files?.[0] ?? null }); setResult(''); }} /></label><label className="grid gap-1 text-sm">Or choose existing artwork {item}<select className={selectClass} value={listings[item] ?? ''} disabled={busy || !!files[item]} onChange={(event) => { setListings({ ...listings, [item]: event.target.value }); setResult(''); }}><option value="">Choose listing artwork</option>{artworks.filter(artwork => !childContext || artwork.orientation === scene.openings.find(opening => opening.imageItemNumber === item)?.orientation).map((artwork) => <option key={artwork.id} value={artwork.id}>{artwork.name}</option>)}</select></label>{artworks.length === 0 ? <p className="text-xs text-muted-foreground">No saved listing artwork is available. Upload a sample instead.</p> : null}</fieldset>)}</div>{fitStatus ? <p role="status" className="text-sm text-muted-foreground">{fitStatus}</p> : null}{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}{result ? <img src={result} alt={`Completed room preview for ${scene.name}`} className="max-h-[65vh] w-full rounded-md object-contain" /> : null}<DialogFooter><Button variant="outline" onClick={() => { void fitArtwork(); }} disabled={busy || items.length === 0}>Fit artwork to openings</Button><Button variant="outline" onClick={onClose} disabled={busy}>Close</Button><Button disabled={busy} onClick={() => { void run(); }}>{busy ? 'Rendering…' : 'Render test preview'}</Button></DialogFooter></DialogContent></Dialog>;
}

