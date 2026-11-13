'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { TemplateOpeningCorners, TemplateOpeningRegion } from '@/lib/our-category-template-composite';
import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';
import { templateOpeningCornersForOrientation, updateTemplateOpeningCorners } from '@/lib/template-opening-orientations';
import { DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID, PRINTSHRIMP_CUSTOM_FONTS } from '@/lib/printshrimp/custom-fonts';

type Point = { x: number; y: number };
type ImageSize = { width: number; height: number };
type RegionDraft = {
  id: string;
  name: string;
  points: Point[];
  previousRegion?: TemplateOpeningRegion;
  orientation: ListingArtworkOrientation;
  imageItemNumber?: number;
  topText?: string;
  bottomText?: string;
  fontId?: string;
};

const CORNER_NAMES = ['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const;
const CORNER_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
const HANDLE_COLOURS = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b'] as const;
const REGION_COLOURS = ['#2563eb', '#9333ea', '#0891b2', '#16a34a', '#e11d48', '#ea580c'] as const;

function cornersToPoints(corners: TemplateOpeningCorners) {
  return CORNER_KEYS.map((key) => corners[key]);
}

function pointsToCorners(points: Point[]): TemplateOpeningCorners | null {
  if (points.length !== 4) return null;
  return {
    topLeft: points[0],
    topRight: points[1],
    bottomRight: points[2],
    bottomLeft: points[3],
  };
}

function nextAreaName(regions: TemplateOpeningRegion[]) {
  let number = 1;
  const names = new Set(regions.map((region) => region.name));
  while (names.has(`Area ${number}`)) number += 1;
  return `Area ${number}`;
}

export function TemplateCornerPicker({
  imageUrl,
  initialRegions,
  onRegionsChange,
  onDraftingChange,
  onImageSize,
  onRemoveImage,
  multipleItemCount,
  disabled = false,
}: {
  imageUrl: string;
  initialRegions: TemplateOpeningRegion[];
  onRegionsChange: (regions: TemplateOpeningRegion[]) => void;
  onDraftingChange?: (drafting: boolean) => void;
  onImageSize: (size: ImageSize) => void;
  onRemoveImage?: () => void;
  multipleItemCount?: number;
  disabled?: boolean;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const nextId = useRef(1);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [regions, setRegions] = useState<TemplateOpeningRegion[]>(initialRegions);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(initialRegions[0]?.id ?? null);
  const [draft, setDraft] = useState<RegionDraft | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [orientation, setOrientation] = useState<ListingArtworkOrientation>('portrait');

  useEffect(() => {
    setRegions(initialRegions);
    setActiveRegionId(initialRegions[0]?.id ?? null);
    setDraft(null);
    setImageSize(null);
    setHoverPoint(null);
    setOrientation('portrait');
    onDraftingChange?.(false);
  }, [imageUrl]);

  const activeRegion = regions.find((region) => region.id === activeRegionId) ?? null;
  const activePoints = draft?.id === activeRegionId
    ? draft.points
    : activeRegion
      ? cornersToPoints(templateOpeningCornersForOrientation(activeRegion, orientation))
      : [];
  const nextCornerName = draft && draft.points.length < 4 ? CORNER_NAMES[draft.points.length] : null;

  function pointFromPointer(clientX: number, clientY: number) {
    const image = imageRef.current;
    if (!image || !imageSize) return null;
    const bounds = image.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(imageSize.width - 1, Math.round((clientX - bounds.left) * imageSize.width / bounds.width))),
      y: Math.max(0, Math.min(imageSize.height - 1, Math.round((clientY - bounds.top) * imageSize.height / bounds.height))),
    };
  }

  function publishRegions(nextRegions: TemplateOpeningRegion[]) {
    setRegions(nextRegions);
    onRegionsChange(nextRegions);
  }

  function startArea(region?: TemplateOpeningRegion) {
    if (disabled || draft) return;
    const id = region?.id ?? `area-${Date.now()}-${nextId.current++}`;
    const name = region?.name ?? nextAreaName(regions);
    if (region) publishRegions(regions.filter((item) => item.id !== region.id));
    setDraft({
      id,
      name,
      points: [],
      previousRegion: region,
      orientation,
      ...(multipleItemCount ? {
        imageItemNumber: region?.imageItemNumber ?? 1,
        topText: region?.topText ?? '',
        bottomText: region?.bottomText ?? '',
        fontId: region?.fontId ?? DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
      } : {}),
    });
    setActiveRegionId(id);
    onDraftingChange?.(true);
  }

  function publishActivePoints(nextPoints: Point[]) {
    if (draft?.id === activeRegionId) {
      if (nextPoints.length < 4) {
        setDraft({ ...draft, points: nextPoints });
        return;
      }
      const corners = pointsToCorners(nextPoints);
      if (!corners) return;
      const completedRegion = {
        ...draft.previousRegion,
        id: draft.id,
        name: draft.name,
        corners: draft.previousRegion?.corners ?? corners,
        ...(multipleItemCount ? {
          imageItemNumber: draft.imageItemNumber ?? 1,
          topText: draft.topText ?? '',
          bottomText: draft.bottomText ?? '',
          fontId: draft.fontId ?? DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
        } : {}),
      };
      const nextRegions = [...regions, updateTemplateOpeningCorners(completedRegion, draft.orientation, corners)];
      publishRegions(nextRegions);
      setDraft(null);
      onDraftingChange?.(false);
      return;
    }
    if (!activeRegion) return;
    const corners = pointsToCorners(nextPoints);
    if (!corners) return;
    publishRegions(regions.map((region) => region.id === activeRegion.id ? updateTemplateOpeningCorners(region, orientation, corners) : region));
  }

  function deleteArea(id: string) {
    if (draft?.id === id) {
      setDraft(null);
      onDraftingChange?.(false);
    } else {
      publishRegions(regions.filter((region) => region.id !== id));
    }
    const remaining = regions.filter((region) => region.id !== id);
    setActiveRegionId(remaining[0]?.id ?? null);
  }

  function nudgePoint(index: number, xChange: number, yChange: number) {
    if (!imageSize) return;
    publishActivePoints(activePoints.map((point, pointIndex) => pointIndex === index ? {
      x: Math.max(0, Math.min(imageSize.width - 1, point.x + xChange)),
      y: Math.max(0, Math.min(imageSize.height - 1, point.y + yChange)),
    } : point));
  }

  function updateActiveRegion(changes: Partial<TemplateOpeningRegion>) {
    if (!activeRegion || disabled) return;
    publishRegions(regions.map((region) => region.id === activeRegion.id ? { ...region, ...changes } : region));
  }

  const magnifierSize = 144;
  const magnifierZoom = 5;
  const displayedRegions = draft ? [...regions, { id: draft.id, name: draft.name, corners: pointsToCorners(draft.points) }] : regions;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Artwork areas</p>
          <p className="text-xs text-muted-foreground">
            {nextCornerName
              ? `Click the ${nextCornerName.toLowerCase()} inner corner for ${draft?.name}.`
              : activeRegion
                ? `Editing ${activeRegion.name}. Drag its handles or use the arrow keys.`
                : 'This template has no artwork areas. Add one when artwork should appear on the image.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled || Boolean(draft)} onClick={() => startArea()}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add area
          </Button>
          {activeRegion ? <Button type="button" size="sm" variant="outline" disabled={disabled || Boolean(draft)} onClick={() => startArea(activeRegion)}>Reset corners</Button> : null}
          {onRemoveImage ? (
            <Button type="button" size="icon" variant="destructive" disabled={disabled} onClick={onRemoveImage} aria-label="Remove template image" title="Remove image and choose another">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      {activeRegion && (activeRegion.grid?.imageCount ?? 1) === 1 ? <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-1" role="group" aria-label="Area orientation">
          {(['portrait', 'landscape'] as const).map((value) => <Button key={value} type="button" size="sm" variant={orientation === value ? 'default' : 'ghost'}
            aria-pressed={orientation === value} disabled={disabled || Boolean(draft)} onClick={() => setOrientation(value)}>
            {value === 'portrait' ? 'Portrait' : 'Landscape'}
          </Button>)}
        </div>
        <p className="text-xs text-muted-foreground">Set the {orientation} bounds for {activeRegion.name}. Each orientation is saved separately.</p>
      </div> : null}

      {regions.length > 0 || draft ? (
        <div className="flex flex-wrap gap-2" aria-label="Artwork areas">
          {regions.map((region, index) => (
            <div key={region.id} className={`flex items-center rounded-md border ${activeRegionId === region.id ? 'border-primary bg-primary/5' : ''}`}>
              <button type="button" className="px-3 py-1.5 text-sm" disabled={disabled || Boolean(draft)} onClick={() => setActiveRegionId(region.id)}>
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: REGION_COLOURS[index % REGION_COLOURS.length] }} />
                {region.name}
              </button>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={disabled || Boolean(draft)} onClick={() => deleteArea(region.id)} aria-label={`Delete ${region.name}`} title={`Delete ${region.name}`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {draft ? (
            <div className="flex items-center rounded-md border border-primary bg-primary/5">
              <span className="px-3 py-1.5 text-sm">{draft.name}</span>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={disabled} onClick={() => deleteArea(draft.id)} aria-label={`Delete ${draft.name}`} title={`Delete ${draft.name}`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {multipleItemCount && activeRegion ? (
        <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            Image item number
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label={`${activeRegion.name} image item number`}
              value={activeRegion.imageItemNumber ?? 1}
              onChange={(event) => updateActiveRegion({ imageItemNumber: Number(event.target.value) })}
              disabled={disabled}
            >
              {Array.from({ length: multipleItemCount }, (_, index) => index + 1).map((number) => <option key={number} value={number}>Image {number}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Font
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label={`${activeRegion.name} font`}
              value={activeRegion.fontId ?? DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID}
              onChange={(event) => updateActiveRegion({ fontId: event.target.value })}
              disabled={disabled}
            >
              {PRINTSHRIMP_CUSTOM_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Top Text
            <input
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label={`${activeRegion.name} top text`}
              maxLength={40}
              value={activeRegion.topText ?? ''}
              onChange={(event) => updateActiveRegion({ topText: event.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Bottom Text
            <input
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label={`${activeRegion.name} bottom text`}
              maxLength={40}
              value={activeRegion.bottomText ?? ''}
              onChange={(event) => updateActiveRegion({ bottomText: event.target.value })}
              disabled={disabled}
            />
          </label>
        </div>
      ) : null}

      <div className="flex justify-center overflow-auto rounded-md border bg-muted/40 p-2">
        <div
          className={`relative inline-block ${nextCornerName && !disabled ? 'cursor-crosshair' : ''}`}
          onClick={(event) => {
            if (disabled || !draft || draft.points.length >= 4) return;
            const point = pointFromPointer(event.clientX, event.clientY);
            if (point) publishActivePoints([...draft.points, point]);
          }}
          onPointerMove={(event) => {
            const point = pointFromPointer(event.clientX, event.clientY);
            if (point) setHoverPoint(point);
          }}
          onPointerLeave={() => setHoverPoint(null)}
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Template corner selection"
            draggable={false}
            className="block max-h-[55vh] max-w-full select-none"
            onLoad={(event) => {
              const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
              setImageSize(size);
              onImageSize(size);
            }}
          />

          {imageSize ? (
            <>
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${imageSize.width} ${imageSize.height}`} preserveAspectRatio="none" aria-hidden="true">
                {displayedRegions.map((region, index) => {
                  const savedRegion = regions.find(candidate => candidate.id === region.id);
                  const points = savedRegion ? cornersToPoints(templateOpeningCornersForOrientation(savedRegion, orientation)) : draft?.id === region.id ? draft.points : [];
                  if (points.length < 2) return null;
                  const coordinates = points.map((point) => `${point.x},${point.y}`).join(' ');
                  const colour = REGION_COLOURS[index % REGION_COLOURS.length];
                  return points.length === 4
                    ? <polygon key={region.id} points={coordinates} fill={`${colour}29`} stroke={colour} strokeWidth={activeRegionId === region.id ? Math.max(3, imageSize.width / 300) : Math.max(2, imageSize.width / 450)} />
                    : <polyline key={region.id} points={coordinates} fill="none" stroke={colour} strokeWidth={Math.max(3, imageSize.width / 300)} />;
                })}
              </svg>

              {activePoints.map((point, index) => (
                <button
                  key={CORNER_KEYS[index]}
                  type="button"
                  aria-label={`${draft?.name ?? activeRegion?.name ?? 'Area'} ${CORNER_NAMES[index].toLowerCase()} opening corner`}
                  title={`${CORNER_NAMES[index]}: ${point.x}, ${point.y}`}
                  disabled={disabled}
                  className="absolute z-10 h-5 w-5 rounded-full border-2 border-white shadow-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed"
                  style={{
                    left: `${point.x / Math.max(1, imageSize.width - 1) * 100}%`,
                    top: `${point.y / Math.max(1, imageSize.height - 1) * 100}%`,
                    backgroundColor: HANDLE_COLOURS[index],
                    transform: 'translate(-50%, -50%)',
                    touchAction: 'none',
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    const nextPoint = pointFromPointer(event.clientX, event.clientY);
                    if (nextPoint) publishActivePoints(activePoints.map((current, pointIndex) => pointIndex === index ? nextPoint : current));
                  }}
                  onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                  onKeyDown={(event) => {
                    const amount = event.shiftKey ? 10 : 1;
                    const movement = event.key === 'ArrowLeft' ? [-amount, 0]
                      : event.key === 'ArrowRight' ? [amount, 0]
                        : event.key === 'ArrowUp' ? [0, -amount]
                          : event.key === 'ArrowDown' ? [0, amount]
                            : null;
                    if (!movement) return;
                    event.preventDefault();
                    nudgePoint(index, movement[0], movement[1]);
                  }}
                />
              ))}

              {hoverPoint ? (
                <div
                  className="pointer-events-none absolute z-20 overflow-hidden rounded-full border-2 border-white bg-white shadow-xl"
                  style={{
                    width: magnifierSize,
                    height: magnifierSize,
                    ...(hoverPoint.x > imageSize.width / 2 ? { left: 8 } : { right: 8 }),
                    ...(hoverPoint.y > imageSize.height / 2 ? { top: 8 } : { bottom: 8 }),
                    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: `${imageSize.width * magnifierZoom}px ${imageSize.height * magnifierZoom}px`,
                    backgroundPosition: `${magnifierSize / 2 - hoverPoint.x * magnifierZoom}px ${magnifierSize / 2 - hoverPoint.y * magnifierZoom}px`,
                  }}
                  aria-hidden="true"
                >
                  <span className="absolute left-1/2 top-0 h-full w-px bg-red-500" />
                  <span className="absolute left-0 top-1/2 h-px w-full bg-red-500" />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {activeRegionId ? (
        <div className="grid gap-1 text-xs sm:grid-cols-2">
          {CORNER_NAMES.map((name, index) => (
            <span key={name} className="tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{name}:</span>{' '}
              {activePoints[index] ? `${activePoints[index].x}, ${activePoints[index].y}` : 'Not selected'}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
