'use client';

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  MOCKUP_RATIO_OPTIONS,
  constrainMockupPlacement,
  defaultMockupPlacement,
  displayPointToImagePoint,
  mockupExportDimensions,
  mockupPlacementFromDrag,
  resizeMockupPlacement,
  scaleMockupPlacementForExport,
  type MockupOrientation,
  type MockupPlacement,
  type MockupPoint,
  type MockupRatio,
  type MockupResizeCorner,
} from '@/lib/listing-mockup-tester';

type BackgroundImage = {
  fileName: string;
  url: string;
  width: number;
  height: number;
};

type PlacementDrag =
  | { kind: 'create'; start: MockupPoint }
  | { kind: 'move'; start: MockupPoint; placement: MockupPlacement }
  | { kind: 'resize'; corner: MockupResizeCorner; placement: MockupPlacement };

const ACCEPTED_BACKGROUND_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const NO_FRAME = ['unframed', 0, 0, 0] as const;

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
      else reject(new Error('The browser could not create the backdrop PNG.'));
    }, 'image/png');
  });
}

function fileSlug(value: string) {
  return value.replace(/\.[^.]+$/, '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'backdrop';
}

async function downloadBackdrop(
  background: BackgroundImage,
  placement: MockupPlacement,
  ratio: MockupRatio,
  orientation: MockupOrientation,
) {
  const backgroundImage = await loadImage(background.url, 'The uploaded background could not be read.');
  const output = mockupExportDimensions(background.width, background.height);
  const outputPlacement = scaleMockupPlacementForExport(
    placement,
    background.width,
    background.height,
    output.width,
    output.height,
    ratio,
    orientation,
    ...NO_FRAME,
  );
  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not create the backdrop canvas.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, output.width, output.height);
  context.drawImage(backgroundImage, 0, 0, output.width, output.height);
  context.clearRect(outputPlacement.x, outputPlacement.y, outputPlacement.width, outputPlacement.height);

  const blob = await canvasBlob(canvas);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${fileSlug(background.fileName)}-paper-opening.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function BackdropImagesClient() {
  const previewRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<PlacementDrag | null>(null);
  const backgroundObjectUrl = useRef<string | null>(null);
  const [background, setBackground] = useState<BackgroundImage | null>(null);
  const [ratio, setRatio] = useState<MockupRatio>('iso-a');
  const [orientation, setOrientation] = useState<MockupOrientation>('portrait');
  const [placement, setPlacement] = useState<MockupPlacement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (backgroundObjectUrl.current) URL.revokeObjectURL(backgroundObjectUrl.current);
  }, []);

  function constrain(preferred: Pick<MockupPlacement, 'x' | 'y' | 'width'>, nextRatio = ratio, nextOrientation = orientation) {
    if (!background) return null;
    return constrainMockupPlacement(
      preferred,
      background.width,
      background.height,
      nextRatio,
      nextOrientation,
      ...NO_FRAME,
    );
  }

  function revalidatePlacement(nextRatio = ratio, nextOrientation = orientation) {
    if (!placement) return;
    const centreX = placement.x + (placement.width / 2);
    const centreY = placement.y + (placement.height / 2);
    const next = constrain({
      x: centreX - (placement.width / 2),
      y: centreY - (placement.height / 2),
      width: placement.width,
    }, nextRatio, nextOrientation);
    if (next) setPlacement(next);
  }

  async function chooseBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    if (!ACCEPTED_BACKGROUND_TYPES.has(file.type)) {
      setError('Choose a PNG, JPEG or WebP background image.');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url, 'The selected background is unreadable or is not a supported image.');
      if (backgroundObjectUrl.current) URL.revokeObjectURL(backgroundObjectUrl.current);
      backgroundObjectUrl.current = url;
      setBackground({ fileName: file.name, url, width: image.naturalWidth, height: image.naturalHeight });
      setPlacement(null);
    } catch (caughtError) {
      URL.revokeObjectURL(url);
      setError(caughtError instanceof Error ? caughtError.message : 'The selected background could not be loaded.');
    }
  }

  function resetPlacement() {
    if (!background) return;
    setPlacement(defaultMockupPlacement(
      background.width,
      background.height,
      ratio,
      orientation,
      ...NO_FRAME,
    ));
  }

  function pointerPoint(event: ReactPointerEvent<HTMLElement>) {
    if (!previewRef.current || !background) return null;
    return displayPointToImagePoint(
      event.clientX,
      event.clientY,
      previewRef.current.getBoundingClientRect(),
      background.width,
      background.height,
    );
  }

  function startCreate(event: ReactPointerEvent<HTMLDivElement>) {
    if (!background || downloading || event.button !== 0) return;
    const point = pointerPoint(event);
    if (!point) return;
    drag.current = { kind: 'create', start: point };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPlacement(null);
  }

  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!background || !drag.current) return;
    const point = pointerPoint(event);
    if (!point) return;
    if (drag.current.kind === 'create') {
      setPlacement(mockupPlacementFromDrag(
        drag.current.start,
        point,
        background.width,
        background.height,
        ratio,
        orientation,
        ...NO_FRAME,
      ));
    } else if (drag.current.kind === 'move') {
      setPlacement(constrain({
        x: drag.current.placement.x + point.x - drag.current.start.x,
        y: drag.current.placement.y + point.y - drag.current.start.y,
        width: drag.current.placement.width,
      }));
    } else {
      setPlacement(resizeMockupPlacement(
        drag.current.placement,
        drag.current.corner,
        point,
        background.width,
        background.height,
        ratio,
        orientation,
        ...NO_FRAME,
      ));
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  }

  function updateNumericPlacement(key: 'x' | 'y' | 'width', value: string) {
    if (!placement) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const next = constrain({ ...placement, [key]: number });
    if (next) setPlacement(next);
  }

  async function download() {
    if (!background || !placement) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadBackdrop(background, placement, ratio, orientation);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to download the backdrop image.');
    } finally {
      setDownloading(false);
    }
  }

  const placementStyle = background && placement ? {
    left: `${placement.x / background.width * 100}%`,
    top: `${placement.y / background.height * 100}%`,
    width: `${placement.width / background.width * 100}%`,
    height: `${placement.height / background.height * 100}%`,
  } : undefined;

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Backdrop Images</h1>
        <p className="mt-1 text-sm text-muted-foreground">Upload a room image, mark the paper opening, then download the backdrop guide.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Backdrop settings</CardTitle></CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="grid content-start gap-3 rounded-lg border p-4" aria-label="Backdrop source">
              <span className="text-sm font-medium">Background image</span>
              <span className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={downloading}>
                  <Upload className="h-4 w-4" aria-hidden="true" /> Choose image
                </Button>
                <input
                  ref={inputRef}
                  aria-label="Backdrop background image"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => { void chooseBackground(event); }}
                  disabled={downloading}
                />
                <span className="text-sm text-muted-foreground">
                  {background ? `${background.fileName} (${background.width} × ${background.height}px)` : 'PNG, JPEG or WebP'}
                </span>
              </span>
            </section>

            <section className="grid gap-4 rounded-lg border p-4" aria-label="Opening settings">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  Paper ratio
                  <select
                    aria-label="Paper ratio"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={ratio}
                    onChange={(event) => {
                      const next = event.target.value as MockupRatio;
                      setRatio(next);
                      revalidatePlacement(next, orientation);
                    }}
                    disabled={downloading}
                  >
                    {MOCKUP_RATIO_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Orientation
                  <select
                    aria-label="Paper orientation"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={orientation}
                    onChange={(event) => {
                      const next = event.target.value as MockupOrientation;
                      setOrientation(next);
                      revalidatePlacement(ratio, next);
                    }}
                    disabled={downloading}
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
              </div>
            </section>
          </div>

          <section className="grid gap-3 rounded-lg border bg-muted/20 p-4" aria-label="Backdrop placement preview">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Set the paper opening</h2>
                <p className="text-sm text-muted-foreground">Drag on the background to create the pink area. Drag inside it to move it or use a corner to resize it.</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={resetPlacement} disabled={!background || downloading}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset placement
              </Button>
            </div>

            {background ? (
              <div className="flex max-h-[68vh] justify-center overflow-auto rounded-md border bg-black/5 p-2">
                <div
                  ref={previewRef}
                  className="relative inline-block max-h-[64vh] max-w-full cursor-crosshair touch-none select-none"
                  onPointerDown={startCreate}
                  onPointerMove={movePointer}
                  onPointerUp={finishPointer}
                  onPointerCancel={finishPointer}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={background.url} alt="Uploaded backdrop background" draggable={false} className="pointer-events-none block max-h-[64vh] max-w-full select-none" />
                  {placement && placementStyle ? (
                    <div
                      data-testid="paper-opening"
                      className="absolute cursor-move border-2 border-white bg-[#ff1493] shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                      style={placementStyle}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        const point = pointerPoint(event);
                        if (!point) return;
                        drag.current = { kind: 'move', start: point, placement };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                    >
                      {(['top-left', 'top-right', 'bottom-right', 'bottom-left'] as MockupResizeCorner[]).map((corner) => (
                        <button
                          key={corner}
                          type="button"
                          aria-label={`Resize paper opening from ${corner.replace('-', ' ')}`}
                          className={`absolute h-4 w-4 rounded-full border-2 border-white bg-[#ff1493] shadow ${corner.includes('top') ? '-top-2' : '-bottom-2'} ${corner.includes('left') ? '-left-2' : '-right-2'} cursor-nwse-resize`}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            drag.current = { kind: 'resize', corner, placement };
                            event.currentTarget.setPointerCapture(event.pointerId);
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex min-h-72 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">Upload a background image to start.</div>
            )}

            {background && placement ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="grid gap-1 text-xs font-medium">X position (px)<Input type="number" min="0" value={placement.x} onChange={(event) => updateNumericPlacement('x', event.target.value)} disabled={downloading} /></label>
                <label className="grid gap-1 text-xs font-medium">Y position (px)<Input type="number" min="0" value={placement.y} onChange={(event) => updateNumericPlacement('y', event.target.value)} disabled={downloading} /></label>
                <label className="grid gap-1 text-xs font-medium">Opening width (px)<Input type="number" min="1" value={placement.width} onChange={(event) => updateNumericPlacement('width', event.target.value)} disabled={downloading} /></label>
                <label className="grid gap-1 text-xs font-medium">Opening height (px)<Input value={placement.height} readOnly aria-readonly="true" /></label>
              </div>
            ) : null}
          </section>

          {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">The pink editing guide becomes a transparent opening in the downloaded PNG. The uploaded file is not altered.</p>
            <Button type="button" onClick={() => { void download(); }} disabled={downloading || !background || !placement}>
              <Download className="h-4 w-4" aria-hidden="true" /> {downloading ? 'Preparing download…' : 'Download'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
