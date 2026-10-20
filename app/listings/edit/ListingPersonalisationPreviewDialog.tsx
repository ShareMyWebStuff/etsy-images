'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
  PRINTSHRIMP_CUSTOM_FONTS,
  type PrintShrimpCustomFontId,
} from '@/lib/printshrimp/custom-fonts';
import type { ListingEditorContext } from '@/lib/listing-editor';

type PreviewImage = { sizeKey: string; sizeLabel: string; url: string };

type ListingPersonalisationPreviewDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  context: ListingEditorContext;
  sizes: Array<{ key: string; label: string }>;
  allowTop: boolean;
  allowBottom: boolean;
};

export function ListingPersonalisationPreviewDialog({
  open,
  onOpenChange,
  context,
  sizes,
  allowTop,
  allowBottom,
}: ListingPersonalisationPreviewDialogProps) {
  const [topText, setTopText] = useState('');
  const [bottomText, setBottomText] = useState('');
  const [fontId, setFontId] = useState<PrintShrimpCustomFontId>(DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID);
  const [borderEnabled, setBorderEnabled] = useState(false);
  const [borderSizePercent, setBorderSizePercent] = useState('5');
  const [images, setImages] = useState<PreviewImage[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; current: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);
  const generation = useRef<AbortController | null>(null);

  function releaseImages() {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
    setImages([]);
    setActiveIndex(0);
  }

  useEffect(() => {
    if (!open) return;
    generation.current?.abort();
    releaseImages();
    setTopText('');
    setBottomText('');
    setFontId(DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID);
    setBorderEnabled(false);
    setBorderSizePercent('5');
    setGenerating(false);
    setProgress(null);
    setError(null);
  }, [open]);

  useEffect(() => () => {
    generation.current?.abort();
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
  }, []);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) generation.current?.abort();
    onOpenChange(nextOpen);
  }

  async function generateImages() {
    generation.current?.abort();
    const controller = new AbortController();
    generation.current = controller;
    releaseImages();
    setGenerating(true);
    setError(null);
    setProgress({ completed: 0, total: sizes.length, current: sizes[0]?.label ?? null });
    const created: PreviewImage[] = [];
    try {
      for (let index = 0; index < sizes.length; index += 1) {
        const size = sizes[index];
        setProgress({ completed: index, total: sizes.length, current: size.label });
        const response = await fetch('/api/shops/listings/editor/personalisation-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            ...context,
            sizeKey: size.key,
            topText,
            bottomText,
            fontId,
            borderEnabled,
            borderSizePercent: Number(borderSizePercent),
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(payload.error ?? `Unable to generate the ${size.label} image.`);
        }
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error(`The ${size.label} preview was not returned as an image.`);
        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        created.push({ sizeKey: size.key, sizeLabel: size.label, url });
        setProgress({ completed: index + 1, total: sizes.length, current: sizes[index + 1]?.label ?? null });
      }
      setImages(created);
      setActiveIndex(0);
    } catch (caughtError) {
      if (!(caughtError instanceof DOMException && caughtError.name === 'AbortError')) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to generate the paper-size images.');
      }
    } finally {
      if (generation.current === controller) {
        generation.current = null;
        setGenerating(false);
      }
    }
  }

  const activeImage = images[activeIndex] ?? null;
  const imagesLeft = progress ? progress.total - progress.completed : 0;
  const fontDisabled = !allowTop && !allowBottom;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>View Images</DialogTitle>
          <DialogDescription>
            Enter example customised text, choose a font and border, then generate the smallest enabled paper size for each aspect ratio.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            Top Text
            <Input aria-label="Preview Top Text" maxLength={40} value={topText} onChange={(event) => setTopText(event.target.value)} disabled={!allowTop || generating} />
            <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{topText.length} / 40</span>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Bottom Text
            <Input aria-label="Preview Bottom Text" maxLength={40} value={bottomText} onChange={(event) => setBottomText(event.target.value)} disabled={!allowBottom || generating} />
            <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{bottomText.length} / 40</span>
          </label>
        </div>

        <label className="grid gap-2 text-sm font-medium">
          Font
          <select
            aria-label="Preview Font"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            value={fontId}
            onChange={(event) => setFontId(event.target.value as PrintShrimpCustomFontId)}
            disabled={fontDisabled || generating}
          >
            {PRINTSHRIMP_CUSTOM_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
          </select>
        </label>

        <div className="grid gap-3 rounded-md border p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={borderEnabled} onChange={(event) => setBorderEnabled(event.target.checked)} disabled={generating} />
            Border
          </label>
          {borderEnabled ? <label className="grid max-w-xs gap-2 text-sm font-medium">
            Border Size (%)
            <Input
              aria-label="Preview Border Size (%)"
              type="number"
              min="2.5"
              max="10"
              step="0.5"
              value={borderSizePercent}
              onChange={(event) => setBorderSizePercent(event.target.value)}
              disabled={generating}
            />
            <span className="text-xs font-normal text-muted-foreground">Choose between 2.5% and 10%.</span>
          </label> : null}
        </div>

        {!allowTop && !allowBottom ? (
          <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            The assigned template does not allow customised text. The previews will show the artwork and optional border only.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-sm" role="status" aria-live="polite">
            {generating && progress ? (
              <span>{imagesLeft} {imagesLeft === 1 ? 'image' : 'images'} left to generate{progress.current ? ` — creating ${progress.current}` : ''}.</span>
            ) : images.length > 0 ? (
              <span>All {images.length} {images.length === 1 ? 'image has' : 'images have'} been generated.</span>
            ) : (
              <span>{sizes.length} aspect-ratio {sizes.length === 1 ? 'image' : 'images'} will be generated.</span>
            )}
          </div>
          <Button type="button" onClick={() => void generateImages()} disabled={generating || sizes.length === 0 || (borderEnabled && (Number(borderSizePercent) < 2.5 || Number(borderSizePercent) > 10))}>
            {generating ? <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> Generating...</> : 'Generate'}
          </Button>
        </div>

        {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

        {activeImage && !generating ? (
          <section className="grid gap-3 rounded-md border bg-muted/20 p-4" aria-label="Generated paper-size image">
            <div className="flex items-center justify-between gap-3">
              <Button type="button" size="sm" variant="outline" onClick={() => setActiveIndex((current) => current - 1)} disabled={activeIndex === 0}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
              </Button>
              <p className="font-semibold">{activeImage.sizeLabel} <span className="font-normal text-muted-foreground">({activeIndex + 1} of {images.length})</span></p>
              <Button type="button" size="sm" variant="outline" onClick={() => setActiveIndex((current) => current + 1)} disabled={activeIndex === images.length - 1}>
                Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={activeImage.url} alt={`${activeImage.sizeLabel} customised artwork preview`} className="mx-auto max-h-[60vh] max-w-full rounded border bg-white object-contain" />
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
