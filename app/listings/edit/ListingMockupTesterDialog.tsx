'use client';

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Download, RefreshCw, RotateCcw, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  ARTWORK_BACKGROUND_COLOUR_OPTIONS,
  DEFAULT_ARTWORK_BACKGROUND_COLOUR,
  type ArtworkBackgroundColour,
} from '@/lib/artwork-background-colours';
import {
  MOCKUP_RATIO_OPTIONS,
  constrainMockupPlacement,
  containArtwork,
  defaultMockupPlacement,
  displayPointToImagePoint,
  mockupExportDimensions,
  mockupFrameGeometry,
  mockupPlacementFromDrag,
  resizeMockupPlacement,
  scaleMockupPlacementForExport,
  type MockupFrameFinish,
  type MockupOrientation,
  type MockupPlacement,
  type MockupPoint,
  type MockupRatio,
  type MockupResizeCorner,
} from '@/lib/listing-mockup-tester';
import type { ListingEditorContext } from '@/lib/listing-editor';

export type ListingMockupArtworkOption = {
  id: string;
  label: string;
  url: string;
  ratio?: MockupRatio;
  primary?: boolean;
};

type BackgroundImage = {
  fileName: string;
  url: string;
  width: number;
  height: number;
};

const DEFAULT_FRAME_THICKNESS_PERCENT = 4;
const DEFAULT_FRAME_DEPTH_PERCENT = 1;
const DEFAULT_SHADOW_STRENGTH = 17;

type PlacementDrag =
  | { kind: 'create'; start: MockupPoint }
  | { kind: 'move'; start: MockupPoint; placement: MockupPlacement }
  | { kind: 'resize'; corner: MockupResizeCorner; placement: MockupPlacement };

const FRAME_OPTIONS: ReadonlyArray<{ key: MockupFrameFinish; label: string; horizontal?: string; vertical?: string; fallback: string }> = [
  { key: 'unframed', label: 'Unframed', fallback: '#ffffff' },
  { key: 'black', label: 'Black', horizontal: '/assets/printshrimp-frames/derived/black-rail-horizontal.png', vertical: '/assets/printshrimp-frames/derived/black-rail-vertical.png', fallback: '#111111' },
  { key: 'white', label: 'White', horizontal: '/assets/printshrimp-frames/derived/white-rail-horizontal.png', vertical: '/assets/printshrimp-frames/derived/white-rail-vertical.png', fallback: '#f5f4ef' },
  { key: 'oak', label: 'Oak', horizontal: '/assets/printshrimp-frames/derived/oak-rail-horizontal.png', vertical: '/assets/printshrimp-frames/derived/oak-rail-vertical.png', fallback: '#c9975e' },
];

const ACCEPTED_BACKGROUND_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PLACEMENT_SAFETY_FINISH: MockupFrameFinish = 'oak';
const PLACEMENT_SAFETY_THICKNESS = 12;
const PLACEMENT_SAFETY_SHADOW = 25;
const PLACEMENT_SAFETY_DEPTH = 5;

function loadImage(url: string, message: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(message));
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not create the mockup PNG.'));
    }, 'image/png');
  });
}

function slug(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'listing';
}

function railTile(image: HTMLImageElement, thickness: number, horizontal: boolean) {
  const canvas = document.createElement('canvas');
  if (horizontal) {
    canvas.width = 1024;
    canvas.height = Math.max(1, Math.round(thickness));
  } else {
    canvas.width = Math.max(1, Math.round(thickness));
    canvas.height = 1024;
  }
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not prepare the frame texture.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function polygonPath(context: CanvasRenderingContext2D, points: MockupPoint[]) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function fillRail(
  context: CanvasRenderingContext2D,
  points: MockupPoint[],
  texture: HTMLCanvasElement,
  fallback: string,
  offsetX: number,
  offsetY: number,
) {
  context.save();
  polygonPath(context, points);
  context.clip();
  const pattern = context.createPattern(texture, 'repeat');
  if (pattern && typeof pattern.setTransform === 'function') {
    pattern.setTransform(new DOMMatrix().translate(offsetX, offsetY));
  }
  context.fillStyle = pattern ?? fallback;
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.restore();
}

function shadeRail(
  context: CanvasRenderingContext2D,
  points: MockupPoint[],
  gradient: CanvasGradient,
) {
  context.save();
  polygonPath(context, points);
  context.clip();
  context.fillStyle = gradient;
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.restore();
}

function depthStyle(finish: Exclude<MockupFrameFinish, 'unframed'>) {
  if (finish === 'black') {
    return { fallback: '#151515', near: 'rgba(0, 0, 0, 0.08)', far: 'rgba(0, 0, 0, 0.38)', edge: 'rgba(0, 0, 0, 0.52)' };
  }
  if (finish === 'white') {
    return { fallback: '#e4e3de', near: 'rgba(80, 77, 70, 0.04)', far: 'rgba(80, 77, 70, 0.2)', edge: 'rgba(80, 77, 70, 0.28)' };
  }
  return { fallback: '#a87748', near: 'rgba(50, 29, 14, 0.05)', far: 'rgba(50, 29, 14, 0.28)', edge: 'rgba(65, 38, 18, 0.34)' };
}

function drawCastShadow(
  context: CanvasRenderingContext2D,
  geometry: ReturnType<typeof mockupFrameGeometry>,
  shadowStrength: number,
) {
  if (shadowStrength <= 0 || geometry.shadowBlur <= 0) return;
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = context.canvas.width;
  shadowCanvas.height = context.canvas.height;
  const shadowContext = shadowCanvas.getContext('2d');
  if (!shadowContext) return;

  const { backOuter, shadowBlur, shadowOffsetX, shadowOffsetY } = geometry;
  shadowContext.save();
  shadowContext.shadowColor = `rgba(18, 18, 18, ${Math.min(0.34, 0.07 + (shadowStrength * 0.009))})`;
  shadowContext.shadowBlur = shadowBlur * 1.35;
  shadowContext.shadowOffsetX = shadowOffsetX;
  shadowContext.shadowOffsetY = shadowOffsetY;
  shadowContext.fillStyle = '#000000';
  shadowContext.fillRect(backOuter.x, backOuter.y, backOuter.width, backOuter.height);
  shadowContext.restore();

  shadowContext.save();
  shadowContext.globalCompositeOperation = 'destination-out';
  shadowContext.fillStyle = '#000000';
  shadowContext.fillRect(backOuter.x - 2, backOuter.y - 2, backOuter.width + 4, backOuter.height + 4);
  shadowContext.restore();

  // Keep the cast shadow directional. Drawing the complete blurred rectangle
  // creates an even halo on every side of the frame, which looks like fading.
  context.save();
  context.beginPath();
  context.rect(
    backOuter.x,
    backOuter.y,
    context.canvas.width - backOuter.x,
    context.canvas.height - backOuter.y,
  );
  context.clip();
  context.drawImage(shadowCanvas, 0, 0);
  context.restore();
}

function drawFrame(
  context: CanvasRenderingContext2D,
  opening: MockupPlacement,
  finish: Exclude<MockupFrameFinish, 'unframed'>,
  thicknessPercent: number,
  depthPercent: number,
  shadowStrength: number,
  horizontalTexture: HTMLImageElement,
  verticalTexture: HTMLImageElement,
) {
  const option = FRAME_OPTIONS.find((candidate) => candidate.key === finish)!;
  const geometry = mockupFrameGeometry(opening, finish, thicknessPercent, shadowStrength, depthPercent);
  const {
    outer,
    backOuter,
    frameThickness,
    frameDepth,
    depthX,
    depthY,
  } = geometry;

  drawCastShadow(context, geometry, shadowStrength);

  const outerRight = outer.x + outer.width;
  const outerBottom = outer.y + outer.height;
  const backRight = backOuter.x + backOuter.width;
  const backBottom = backOuter.y + backOuter.height;
  const innerRight = opening.x + opening.width;
  const innerBottom = opening.y + opening.height;
  const horizontal = railTile(horizontalTexture, frameThickness, true);
  const vertical = railTile(verticalTexture, frameThickness, false);
  const depth = depthStyle(finish);

  if (frameDepth > 0) {
    const taper = Math.max(1, Math.round(frameDepth * 0.14));
    const backTopRight = { x: backRight - taper, y: backOuter.y + taper };
    const backBottomRight = { x: backRight - taper, y: backBottom - taper };
    const backBottomLeft = { x: backOuter.x + taper, y: backBottom - taper };
    const rightDepth = [
      { x: outerRight, y: outer.y }, backTopRight,
      backBottomRight, { x: outerRight, y: outerBottom },
    ];
    const bottomDepth = [
      { x: outer.x, y: outerBottom }, { x: outerRight, y: outerBottom },
      backBottomRight, backBottomLeft,
    ];
    fillRail(context, bottomDepth, horizontal, depth.fallback, finish === 'oak' ? -401 : -137, depthY);
    fillRail(context, rightDepth, vertical, depth.fallback, depthX, finish === 'oak' ? -277 : -91);

    const rightShade = context.createLinearGradient(outerRight, 0, backRight, 0);
    rightShade.addColorStop(0, depth.near);
    rightShade.addColorStop(1, depth.far);
    shadeRail(context, rightDepth, rightShade);
    const bottomShade = context.createLinearGradient(0, outerBottom, 0, backBottom);
    bottomShade.addColorStop(0, depth.near);
    bottomShade.addColorStop(1, depth.far);
    shadeRail(context, bottomDepth, bottomShade);

    context.save();
    context.lineWidth = Math.max(1, frameDepth * 0.08);
    context.strokeStyle = depth.edge;
    context.beginPath();
    context.moveTo(backTopRight.x, backTopRight.y);
    context.lineTo(backBottomRight.x, backBottomRight.y);
    context.moveTo(backBottomLeft.x, backBottomLeft.y);
    context.lineTo(backBottomRight.x, backBottomRight.y);
    context.stroke();
    context.restore();
  }

  const topRail = [
    { x: outer.x, y: outer.y }, { x: outerRight, y: outer.y },
    { x: innerRight, y: opening.y }, { x: opening.x, y: opening.y },
  ];
  const rightRail = [
    { x: outerRight, y: outer.y }, { x: outerRight, y: outerBottom },
    { x: innerRight, y: innerBottom }, { x: innerRight, y: opening.y },
  ];
  const bottomRail = [
    { x: outerRight, y: outerBottom }, { x: outer.x, y: outerBottom },
    { x: opening.x, y: innerBottom }, { x: innerRight, y: innerBottom },
  ];
  const leftRail = [
    { x: outer.x, y: outerBottom }, { x: outer.x, y: outer.y },
    { x: opening.x, y: opening.y }, { x: opening.x, y: innerBottom },
  ];
  fillRail(context, topRail, horizontal, option.fallback, finish === 'oak' ? -173 : 0, 0);
  fillRail(context, rightRail, vertical, option.fallback, 0, finish === 'oak' ? -317 : 0);
  fillRail(context, bottomRail, horizontal, option.fallback, finish === 'oak' ? -521 : -239, 0);
  fillRail(context, leftRail, vertical, option.fallback, 0, finish === 'oak' ? -683 : -211);

  context.save();
  context.beginPath();
  context.rect(0, 0, context.canvas.width, context.canvas.height);
  context.rect(opening.x, opening.y, opening.width, opening.height);
  context.clip('evenodd');
  context.lineWidth = Math.max(0.75, frameThickness * 0.035);
  context.strokeStyle = finish === 'white' ? 'rgba(90, 82, 70, 0.28)' : 'rgba(0, 0, 0, 0.48)';
  context.strokeRect(
    opening.x - (context.lineWidth / 2),
    opening.y - (context.lineWidth / 2),
    opening.width + context.lineWidth,
    opening.height + context.lineWidth,
  );
  context.restore();

  context.save();
  context.lineWidth = Math.max(0.75, frameThickness * 0.025);
  context.strokeStyle = finish === 'white' ? 'rgba(105, 100, 91, 0.18)' : 'rgba(0, 0, 0, 0.24)';
  context.beginPath();
  context.moveTo(outer.x, outer.y);
  context.lineTo(opening.x, opening.y);
  context.moveTo(outerRight, outer.y);
  context.lineTo(innerRight, opening.y);
  context.moveTo(outerRight, outerBottom);
  context.lineTo(innerRight, innerBottom);
  context.moveTo(outer.x, outerBottom);
  context.lineTo(opening.x, innerBottom);
  context.stroke();
  context.restore();
}

async function renderMockup({
  background,
  artworkUrl,
  backgroundColour,
  placement,
  ratio,
  orientation,
  finish,
  thicknessPercent,
  depthPercent,
  shadowStrength,
}: {
  background: BackgroundImage;
  artworkUrl: string;
  backgroundColour: ArtworkBackgroundColour;
  placement: MockupPlacement;
  ratio: MockupRatio;
  orientation: MockupOrientation;
  finish: MockupFrameFinish;
  thicknessPercent: number;
  depthPercent: number;
  shadowStrength: number;
}) {
  const frame = FRAME_OPTIONS.find((candidate) => candidate.key === finish)!;
  const [backgroundImage, artworkImage, horizontalTexture, verticalTexture] = await Promise.all([
    loadImage(background.url, 'The uploaded background could not be read.'),
    loadImage(artworkUrl, 'The selected listing artwork could not be loaded.'),
    frame.horizontal ? loadImage(frame.horizontal, `The ${frame.label} frame texture is unavailable.`) : Promise.resolve(null),
    frame.vertical ? loadImage(frame.vertical, `The ${frame.label} frame texture is unavailable.`) : Promise.resolve(null),
  ]);
  const output = mockupExportDimensions(background.width, background.height);
  const outputPlacement = scaleMockupPlacementForExport(
    placement,
    background.width,
    background.height,
    output.width,
    output.height,
    ratio,
    orientation,
    finish,
    thicknessPercent,
    shadowStrength,
    depthPercent,
  );
  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('The browser could not create the mockup canvas.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(backgroundImage, 0, 0, output.width, output.height);

  if (finish === 'unframed') {
    const geometry = mockupFrameGeometry(outputPlacement, finish, thicknessPercent, shadowStrength, depthPercent);
    context.save();
    context.shadowColor = shadowStrength === 0 ? 'rgba(0, 0, 0, 0)' : `rgba(0, 0, 0, ${Math.min(0.26, 0.06 + (shadowStrength * 0.008))})`;
    context.shadowBlur = geometry.shadowBlur;
    context.shadowOffsetX = geometry.shadowOffset * 0.35;
    context.shadowOffsetY = geometry.shadowOffset;
    context.fillStyle = backgroundColour;
    context.fillRect(outputPlacement.x, outputPlacement.y, outputPlacement.width, outputPlacement.height);
    context.restore();
  }

  context.fillStyle = backgroundColour;
  context.fillRect(outputPlacement.x, outputPlacement.y, outputPlacement.width, outputPlacement.height);
  const artwork = containArtwork(artworkImage.naturalWidth, artworkImage.naturalHeight, outputPlacement);
  context.drawImage(artworkImage, artwork.x, artwork.y, artwork.width, artwork.height);

  if (finish !== 'unframed') {
    if (!horizontalTexture || !verticalTexture) throw new Error(`The ${frame.label} frame texture is unavailable.`);
    drawFrame(context, outputPlacement, finish, thicknessPercent, depthPercent, shadowStrength, horizontalTexture, verticalTexture);
  } else {
    context.save();
    context.lineWidth = Math.max(1, Math.min(outputPlacement.width, outputPlacement.height) * 0.002);
    context.strokeStyle = 'rgba(70, 65, 58, 0.24)';
    context.strokeRect(outputPlacement.x, outputPlacement.y, outputPlacement.width, outputPlacement.height);
    context.restore();
  }

  return { blob: await canvasBlob(canvas), width: output.width, height: output.height };
}

export function ListingMockupTesterDialog({
  open,
  onOpenChange,
  context,
  listingName,
  artworkOptions,
  initialBackgroundColour = DEFAULT_ARTWORK_BACKGROUND_COLOUR,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  context: ListingEditorContext;
  listingName: string;
  artworkOptions: ListingMockupArtworkOption[];
  initialBackgroundColour?: ArtworkBackgroundColour;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<PlacementDrag | null>(null);
  const backgroundObjectUrl = useRef<string | null>(null);
  const resultObjectUrl = useRef<string | null>(null);
  const contextKey = `${context.shopId}:${context.sectionId}:${context.subSectionId}:${context.listingId}`;
  const primaryArtwork = artworkOptions.find((option) => option.primary) ?? artworkOptions[0] ?? null;
  const [background, setBackground] = useState<BackgroundImage | null>(null);
  const [selectedArtworkId, setSelectedArtworkId] = useState(primaryArtwork?.id ?? '');
  const [backgroundColour, setBackgroundColour] = useState<ArtworkBackgroundColour>(initialBackgroundColour);
  const [ratio, setRatio] = useState<MockupRatio>('iso-a');
  const [orientation, setOrientation] = useState<MockupOrientation>('portrait');
  const [finish, setFinish] = useState<MockupFrameFinish>('unframed');
  const [thicknessPercent, setThicknessPercent] = useState(DEFAULT_FRAME_THICKNESS_PERCENT);
  const [depthPercent, setDepthPercent] = useState(DEFAULT_FRAME_DEPTH_PERCENT);
  const [shadowStrength, setShadowStrength] = useState(DEFAULT_SHADOW_STRENGTH);
  const [placement, setPlacement] = useState<MockupPlacement | null>(null);
  const [generating, setGenerating] = useState(false);
  const [frameAssetState, setFrameAssetState] = useState<'ready' | 'loading' | 'error'>('ready');
  const [result, setResult] = useState<{ url: string; width: number; height: number } | null>(null);
  const [resultDirty, setResultDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function releaseBackground() {
    if (backgroundObjectUrl.current) URL.revokeObjectURL(backgroundObjectUrl.current);
    backgroundObjectUrl.current = null;
  }

  function releaseResult() {
    if (resultObjectUrl.current) URL.revokeObjectURL(resultObjectUrl.current);
    resultObjectUrl.current = null;
    setResult(null);
  }

  useEffect(() => {
    releaseBackground();
    releaseResult();
    setBackground(null);
    setPlacement(null);
    setSelectedArtworkId(primaryArtwork?.id ?? '');
    setBackgroundColour(initialBackgroundColour);
    setRatio('iso-a');
    setOrientation('portrait');
    setFinish('unframed');
    setThicknessPercent(DEFAULT_FRAME_THICKNESS_PERCENT);
    setDepthPercent(DEFAULT_FRAME_DEPTH_PERCENT);
    setShadowStrength(DEFAULT_SHADOW_STRENGTH);
    setError(null);
    setResultDirty(false);
  }, [contextKey, initialBackgroundColour]);

  useEffect(() => () => {
    if (backgroundObjectUrl.current) URL.revokeObjectURL(backgroundObjectUrl.current);
    if (resultObjectUrl.current) URL.revokeObjectURL(resultObjectUrl.current);
  }, []);

  useEffect(() => {
    if (selectedArtworkId && artworkOptions.some((option) => option.id === selectedArtworkId)) return;
    setSelectedArtworkId(primaryArtwork?.id ?? '');
  }, [artworkOptions, primaryArtwork, selectedArtworkId]);

  useEffect(() => {
    const frame = FRAME_OPTIONS.find((option) => option.key === finish)!;
    if (!frame.horizontal || !frame.vertical) {
      setFrameAssetState('ready');
      return;
    }
    let active = true;
    setFrameAssetState('loading');
    Promise.all([
      loadImage(frame.horizontal, `The ${frame.label} frame texture is unavailable.`),
      loadImage(frame.vertical, `The ${frame.label} frame texture is unavailable.`),
    ]).then(() => {
      if (active) setFrameAssetState('ready');
    }).catch((caughtError) => {
      if (!active) return;
      setFrameAssetState('error');
      setError(caughtError instanceof Error ? caughtError.message : 'The selected frame texture is unavailable.');
    });
    return () => { active = false; };
  }, [finish]);

  const selectedArtwork = artworkOptions.find((option) => option.id === selectedArtworkId) ?? null;
  const currentFrame = FRAME_OPTIONS.find((option) => option.key === finish)!;

  function markResultStale() {
    if (result) setResultDirty(true);
  }

  function settingsPlacement(
    nextRatio = ratio,
    nextOrientation = orientation,
  ) {
    if (!background || !placement) return;
    const centreX = placement.x + (placement.width / 2);
    const centreY = placement.y + (placement.height / 2);
    const next = constrainMockupPlacement({
      x: centreX - (placement.width / 2),
      y: centreY - (placement.height / 2),
      width: placement.width,
    }, background.width, background.height, nextRatio, nextOrientation, PLACEMENT_SAFETY_FINISH, PLACEMENT_SAFETY_THICKNESS, PLACEMENT_SAFETY_SHADOW, PLACEMENT_SAFETY_DEPTH);
    setPlacement(next);
  }

  async function chooseBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    if (!ACCEPTED_BACKGROUND_TYPES.has(file.type)) {
      setError('Choose a PNG, JPEG or WebP room background.');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url, 'The selected background is unreadable or is not a supported image.');
      releaseBackground();
      backgroundObjectUrl.current = url;
      setBackground({ fileName: file.name, url, width: image.naturalWidth, height: image.naturalHeight });
      setPlacement(null);
      releaseResult();
      setResultDirty(false);
    } catch (caughtError) {
      URL.revokeObjectURL(url);
      setError(caughtError instanceof Error ? caughtError.message : 'The selected background could not be loaded.');
    }
  }

  function resetPlacement() {
    if (!background) return;
    setPlacement(defaultMockupPlacement(background.width, background.height, ratio, orientation, PLACEMENT_SAFETY_FINISH, PLACEMENT_SAFETY_THICKNESS, PLACEMENT_SAFETY_SHADOW, PLACEMENT_SAFETY_DEPTH));
    markResultStale();
  }

  function pointerPoint(event: ReactPointerEvent<HTMLElement>) {
    const preview = previewRef.current;
    if (!preview || !background) return null;
    return displayPointToImagePoint(event.clientX, event.clientY, preview.getBoundingClientRect(), background.width, background.height);
  }

  function startCreate(event: ReactPointerEvent<HTMLDivElement>) {
    if (!background || generating || event.button !== 0) return;
    const point = pointerPoint(event);
    if (!point) return;
    drag.current = { kind: 'create', start: point };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPlacement(null);
    markResultStale();
  }

  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!background || !drag.current) return;
    const point = pointerPoint(event);
    if (!point) return;
    if (drag.current.kind === 'create') {
      setPlacement(mockupPlacementFromDrag(drag.current.start, point, background.width, background.height, ratio, orientation, PLACEMENT_SAFETY_FINISH, PLACEMENT_SAFETY_THICKNESS, PLACEMENT_SAFETY_SHADOW, PLACEMENT_SAFETY_DEPTH));
    } else if (drag.current.kind === 'move') {
      setPlacement(constrainMockupPlacement({
        x: drag.current.placement.x + point.x - drag.current.start.x,
        y: drag.current.placement.y + point.y - drag.current.start.y,
        width: drag.current.placement.width,
      }, background.width, background.height, ratio, orientation, PLACEMENT_SAFETY_FINISH, PLACEMENT_SAFETY_THICKNESS, PLACEMENT_SAFETY_SHADOW, PLACEMENT_SAFETY_DEPTH));
    } else {
      setPlacement(resizeMockupPlacement(drag.current.placement, drag.current.corner, point, background.width, background.height, ratio, orientation, PLACEMENT_SAFETY_FINISH, PLACEMENT_SAFETY_THICKNESS, PLACEMENT_SAFETY_SHADOW, PLACEMENT_SAFETY_DEPTH));
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  }

  function updateNumericPlacement(key: 'x' | 'y' | 'width', value: string) {
    if (!background || !placement) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    setPlacement(constrainMockupPlacement({ ...placement, [key]: number }, background.width, background.height, ratio, orientation, PLACEMENT_SAFETY_FINISH, PLACEMENT_SAFETY_THICKNESS, PLACEMENT_SAFETY_SHADOW, PLACEMENT_SAFETY_DEPTH));
    markResultStale();
  }

  async function generate() {
    if (!background || !placement || !selectedArtwork || frameAssetState !== 'ready') return;
    setGenerating(true);
    setError(null);
    try {
      const generated = await renderMockup({
        background,
        artworkUrl: selectedArtwork.url,
        backgroundColour,
        placement,
        ratio,
        orientation,
        finish,
        thicknessPercent,
        depthPercent,
        shadowStrength,
      });
      const url = URL.createObjectURL(generated.blob);
      releaseResult();
      resultObjectUrl.current = url;
      setResult({ url, width: generated.width, height: generated.height });
      setResultDirty(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to generate the room mockup.');
    } finally {
      setGenerating(false);
    }
  }

  const placementStyle = background && placement ? {
    left: `${placement.x / background.width * 100}%`,
    top: `${placement.y / background.height * 100}%`,
    width: `${placement.width / background.width * 100}%`,
    height: `${placement.height / background.height * 100}%`,
  } : undefined;
  const previewScale = background
    ? (previewRef.current?.clientWidth ?? background.width) / background.width
    : 1;
  const previewGeometry = placement
    ? mockupFrameGeometry(placement, finish, thicknessPercent, shadowStrength, depthPercent)
    : null;
  const previewFrameWidth = previewGeometry && finish !== 'unframed'
    ? Math.max(2, previewGeometry.frameThickness * previewScale)
    : 0;
  const previewDepthX = previewGeometry ? previewGeometry.depthX * previewScale : 0;
  const previewDepthY = previewGeometry ? previewGeometry.depthY * previewScale : 0;
  const previewShadowX = previewGeometry ? previewGeometry.shadowOffsetX * previewScale : 0;
  const previewShadowY = previewGeometry ? previewGeometry.shadowOffsetY * previewScale : 0;
  const previewShadowBlur = previewGeometry ? previewGeometry.shadowBlur * previewScale : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100%-2rem)] max-w-7xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tester</DialogTitle>
          <DialogDescription>
            Upload a room background, place the current listing artwork, choose a finish, then generate and download a private test mockup.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid content-start gap-4 rounded-lg border p-4" aria-label="Mockup sources">
            <div className="grid gap-2 text-sm font-medium">
              <span>Room background</span>
              <span className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => backgroundInputRef.current?.click()} disabled={generating}>
                  <Upload className="h-4 w-4" aria-hidden="true" /> Choose image
                </Button>
                <input ref={backgroundInputRef} aria-label="Room background image" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { void chooseBackground(event); }} disabled={generating} />
                <span className="font-normal text-muted-foreground">
                  {background ? `${background.fileName} (${background.width} × ${background.height}px)` : 'PNG, JPEG or WebP'}
                </span>
              </span>
            </div>

            <label className="grid gap-2 text-sm font-medium">
              Listing artwork
              <select
                aria-label="Listing artwork"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={selectedArtworkId}
                onChange={(event) => { setSelectedArtworkId(event.target.value); markResultStale(); }}
                disabled={generating || artworkOptions.length === 0}
              >
                {artworkOptions.length === 0 ? <option value="">No suitable artwork available</option> : artworkOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Background Colour
              <select
                aria-label="Background Colour"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={backgroundColour}
                onChange={(event) => {
                  setBackgroundColour(event.target.value as ArtworkBackgroundColour);
                  markResultStale();
                }}
                disabled={generating}
              >
                {!ARTWORK_BACKGROUND_COLOUR_OPTIONS.some((option) => option.value === backgroundColour) ? (
                  <option value={backgroundColour}>Custom — {backgroundColour}</option>
                ) : null}
                {ARTWORK_BACKGROUND_COLOUR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label} \u2014 {option.value}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="grid gap-4 rounded-lg border p-4" aria-label="Mockup settings">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Print ratio
                <select
                  aria-label="Print ratio"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={ratio}
                  onChange={(event) => {
                    const next = event.target.value as MockupRatio;
                    setRatio(next);
                    settingsPlacement(next);
                    const matchingArtwork = artworkOptions.find((option) => option.ratio === next);
                    if (matchingArtwork) setSelectedArtworkId(matchingArtwork.id);
                    markResultStale();
                  }}
                  disabled={generating}
                >
                  {MOCKUP_RATIO_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Orientation
                <select
                  aria-label="Print orientation"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={orientation}
                  onChange={(event) => {
                    const next = event.target.value as MockupOrientation;
                    setOrientation(next);
                    settingsPlacement(ratio, next);
                    markResultStale();
                  }}
                  disabled={generating}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
            </div>

            <label className="grid gap-2 text-sm font-medium">
              Frame finish
              <select
                aria-label="Frame finish"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={finish}
                onChange={(event) => {
                  const next = event.target.value as MockupFrameFinish;
                  setFinish(next);
                  setError(null);
                  markResultStale();
                }}
                disabled={generating}
              >
                {FRAME_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
              {frameAssetState === 'loading' ? <span className="text-xs font-normal text-muted-foreground">Loading {currentFrame.label} reference texture…</span> : null}
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Frame thickness: {thicknessPercent}%
              <input
                aria-label="Frame thickness"
                type="range"
                min="2"
                max="12"
                step="0.5"
                value={thicknessPercent}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setThicknessPercent(next);
                  markResultStale();
                }}
                disabled={generating || finish === 'unframed'}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Frame depth: {depthPercent}%
              <input
                aria-label="Frame depth"
                type="range"
                min="0"
                max="5"
                step="0.5"
                value={depthPercent}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setDepthPercent(next);
                  markResultStale();
                }}
                disabled={generating || finish === 'unframed'}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Shadow strength: {shadowStrength}%
              <input
                aria-label="Shadow strength"
                type="range"
                min="0"
                max="25"
                step="1"
                value={shadowStrength}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setShadowStrength(next);
                  markResultStale();
                }}
                disabled={generating}
              />
            </label>
          </section>
        </div>

        <section className="grid gap-3 rounded-lg border bg-muted/20 p-4" aria-label="Background placement preview">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Place the print</h3>
              <p className="text-sm text-muted-foreground">Drag on the background to create an opening. Drag inside it to move it, or drag a corner to resize it at the selected ratio.</p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={resetPlacement} disabled={!background || generating}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset placement
            </Button>
          </div>

          {background ? (
            <div className="flex max-h-[62vh] justify-center overflow-auto rounded-md border bg-black/5 p-2">
              <div
                ref={previewRef}
                className="relative inline-block max-h-[58vh] max-w-full cursor-crosshair touch-none select-none"
                onPointerDown={startCreate}
                onPointerMove={movePointer}
                onPointerUp={finishPointer}
                onPointerCancel={finishPointer}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={background.url} alt="Uploaded mockup room background" draggable={false} className="pointer-events-none block max-h-[58vh] max-w-full select-none" />
                {placement && placementStyle ? (
                  <div
                    className="absolute cursor-move border-2 border-dashed border-emerald-500"
                    style={{
                      ...placementStyle,
                      backgroundColor: backgroundColour,
                      boxShadow: finish === 'unframed'
                        ? `${previewShadowX}px ${previewShadowY}px ${previewShadowBlur}px rgba(0,0,0,${shadowStrength === 0 ? 0 : 0.26})`
                        : `0 0 0 ${previewFrameWidth}px ${finish === 'black' ? '#151515' : finish === 'white' ? '#f4f2ec' : '#c9975e'}, ${previewDepthX}px ${previewDepthY}px 0 ${previewFrameWidth}px ${finish === 'black' ? '#0d0d0d' : finish === 'white' ? '#d6d5d0' : '#9b6f46'}, ${previewDepthX + previewShadowX}px ${previewDepthY + previewShadowY}px ${previewShadowBlur}px 0 rgba(0,0,0,${shadowStrength === 0 ? 0 : Math.min(0.34, 0.07 + (shadowStrength * 0.009))})`,
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      const point = pointerPoint(event);
                      if (!point) return;
                      drag.current = { kind: 'move', start: point, placement };
                      event.currentTarget.setPointerCapture(event.pointerId);
                      markResultStale();
                    }}
                  >
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-semibold text-emerald-900 drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">Paper opening</span>
                    {(['top-left', 'top-right', 'bottom-right', 'bottom-left'] as MockupResizeCorner[]).map((corner) => (
                      <button
                        key={corner}
                        type="button"
                        aria-label={`Resize placement from ${corner.replace('-', ' ')}`}
                        className={`absolute h-4 w-4 rounded-full border-2 border-white bg-emerald-600 shadow ${corner.includes('top') ? '-top-2' : '-bottom-2'} ${corner.includes('left') ? '-left-2' : '-right-2'} cursor-nwse-resize`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          drag.current = { kind: 'resize', corner, placement };
                          event.currentTarget.setPointerCapture(event.pointerId);
                          markResultStale();
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">Upload a room background to start.</div>
          )}

          {background && placement ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="grid gap-1 text-xs font-medium">X position (px)<Input type="number" min="0" value={placement.x} onChange={(event) => updateNumericPlacement('x', event.target.value)} disabled={generating} /></label>
              <label className="grid gap-1 text-xs font-medium">Y position (px)<Input type="number" min="0" value={placement.y} onChange={(event) => updateNumericPlacement('y', event.target.value)} disabled={generating} /></label>
              <label className="grid gap-1 text-xs font-medium">Opening width (px)<Input type="number" min="1" value={placement.width} onChange={(event) => updateNumericPlacement('width', event.target.value)} disabled={generating} /></label>
              <label className="grid gap-1 text-xs font-medium">Opening height (px)<Input value={placement.height} readOnly aria-readonly="true" /></label>
            </div>
          ) : null}
        </section>

        {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        {artworkOptions.length === 0 ? <p role="alert" className="rounded-md border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-900">This listing has no original thumbnail or printable artwork image available for the Tester.</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">Exports use the original sources. Smaller backgrounds are resampled to the export size; this does not add source detail.</p>
          <Button type="button" onClick={() => { void generate(); }} disabled={generating || !background || !placement || !selectedArtwork || frameAssetState !== 'ready'}>
            {generating ? <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> Generating…</> : 'Generate'}
          </Button>
        </div>

        {result ? (
          <section className="grid gap-3 rounded-lg border p-4" aria-label="Generated mockup">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Generated mockup</h3>
                <p className="text-xs text-muted-foreground">{result.width} × {result.height}px PNG</p>
              </div>
              <Button type="button" variant="outline" asChild>
                <a href={result.url} download={`${slug(listingName)}-${finish}-mockup.png`}>
                  <Download className="h-4 w-4" aria-hidden="true" /> Download PNG
                </a>
              </Button>
            </div>
            {resultDirty ? <p role="status" className="rounded-md border border-amber-400/50 bg-amber-50 p-2 text-sm text-amber-900">Settings changed. Generate again to update this result.</p> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.url} alt={`${listingName} ${currentFrame.label.toLocaleLowerCase()} room mockup`} className="mx-auto max-h-[70vh] max-w-full rounded border object-contain" />
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
