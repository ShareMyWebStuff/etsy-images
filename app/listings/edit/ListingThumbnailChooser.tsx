'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { RotateCcw, RotateCw, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { analyseListingThumbnailDimensions, type ListingThumbnailRatio } from '@/lib/listing-thumbnail-ratio';

type ThumbnailRotation = 0 | 90 | 180 | 270;
type SelectedImage = { fileName: string; width?: number; height?: number };
type PendingThumbnail = {
  file: File;
  url: string;
  rotation: ThumbnailRotation;
  ratio: ListingThumbnailRatio;
  width: number;
  height: number;
};

export function ListingThumbnailChooser({
  disabled = false,
  onSave,
}: {
  disabled?: boolean;
  onSave(file: File, rotation: ThumbnailRotation): Promise<void>;
}) {
  const helpId = useId();
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [pendingThumbnail, setPendingThumbnail] = useState<PendingThumbnail | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const objectUrl = useRef<string | null>(null);
  const mounted = useRef(true);

  function releaseImage() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
      releaseImage();
    };
  }, []);

  async function chooseThumbnail(file: File) {
    const currentRequest = ++requestId.current;
    releaseImage();
    setSelectedImage({ fileName: file.name });
    setPendingThumbnail(null);
    setError(null);
    setReading(true);
    try {
      const url = URL.createObjectURL(file);
      objectUrl.current = url;
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('The selected thumbnail could not be read. Choose a JPG, PNG, or WEBP image.'));
        image.src = url;
      });
      if (!mounted.current || requestId.current !== currentRequest) return;
      setSelectedImage({ fileName: file.name, ...dimensions });
      const analysis = analyseListingThumbnailDimensions(dimensions.width, dimensions.height);
      setPendingThumbnail({ file, url, rotation: 0, ratio: analysis.ratio, ...dimensions });
    } catch (caughtError) {
      if (!mounted.current || requestId.current !== currentRequest) return;
      releaseImage();
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to use that thumbnail.');
    } finally {
      if (mounted.current && requestId.current === currentRequest) setReading(false);
    }
  }

  function closePendingThumbnail() {
    requestId.current += 1;
    releaseImage();
    setPendingThumbnail(null);
  }

  async function savePendingThumbnail() {
    if (!pendingThumbnail || saving || disabled) return;
    const currentRequest = requestId.current;
    setError(null);
    setSaving(true);
    try {
      await onSave(pendingThumbnail.file, pendingThumbnail.rotation);
      if (mounted.current && requestId.current === currentRequest) closePendingThumbnail();
    } catch (caughtError) {
      if (mounted.current && requestId.current === currentRequest) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to upload the thumbnail.');
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  const controlsDisabled = disabled || reading || saving;

  return <>
    <div className="grid gap-2">
      <label className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-sm text-muted-foreground ${controlsDisabled ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}>
        <Upload className="h-5 w-5" aria-hidden="true" />
        Choose thumbnail image
        <input type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={helpId} disabled={controlsDisabled} className="sr-only" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void chooseThumbnail(file);
        }} />
      </label>
      <p id={helpId} className="text-sm text-muted-foreground">Choose a JPG, PNG, or WEBP image in a 2:3 or 4:5 ratio, portrait or landscape. Up to 6 pixels of rounding difference is allowed.</p>
      {selectedImage ? <p className="break-words text-sm text-muted-foreground">
        Selected: {selectedImage.fileName}{selectedImage.width && selectedImage.height ? ` · ${selectedImage.width} × ${selectedImage.height} px` : ''}
      </p> : null}
      {reading ? <p role="status" className="text-sm text-muted-foreground">Reading thumbnail image…</p> : null}
      {error && !pendingThumbnail ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>

    <Dialog open={pendingThumbnail !== null} onOpenChange={(open) => { if (!open && !saving) closePendingThumbnail(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Confirm thumbnail</DialogTitle>
          <DialogDescription>
            The image is approximately {pendingThumbnail?.ratio === '2x3' ? '2:3' : '4:5'}. Rotate it if needed, then save it. A small rounding difference will be resized to the exact ratio.
          </DialogDescription>
        </DialogHeader>
        {pendingThumbnail ? <div className="grid gap-4">
          <div className="flex min-h-96 items-center justify-center overflow-hidden rounded-lg border bg-muted p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingThumbnail.url} alt="Selected thumbnail" className="max-h-[55vh] max-w-full object-contain transition-transform" style={{ transform: `rotate(${pendingThumbnail.rotation}deg)` }} />
          </div>
          <p className="break-words text-center text-sm text-muted-foreground">{pendingThumbnail.file.name}</p>
          <p className="text-center text-sm text-muted-foreground">
            {pendingThumbnail.rotation % 180 === 0
              ? `${pendingThumbnail.width} × ${pendingThumbnail.height}`
              : `${pendingThumbnail.height} × ${pendingThumbnail.width}`}
            {' · '}{pendingThumbnail.rotation % 180 === 0
              ? pendingThumbnail.width > pendingThumbnail.height ? 'Landscape' : 'Portrait'
              : pendingThumbnail.height > pendingThumbnail.width ? 'Landscape' : 'Portrait'}
          </p>
          {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
          {saving ? <p role="status" className="text-sm text-muted-foreground">Saving thumbnail image…</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setPendingThumbnail((current) => current ? ({ ...current, rotation: ((current.rotation + 270) % 360) as ThumbnailRotation }) : null)} disabled={controlsDisabled}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Rotate left
              </Button>
              <Button type="button" variant="outline" onClick={() => setPendingThumbnail((current) => current ? ({ ...current, rotation: ((current.rotation + 90) % 360) as ThumbnailRotation }) : null)} disabled={controlsDisabled}>
                <RotateCw className="h-4 w-4" aria-hidden="true" /> Rotate right
              </Button>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closePendingThumbnail} disabled={controlsDisabled}>Cancel</Button>
              <Button type="button" onClick={() => void savePendingThumbnail()} disabled={controlsDisabled}>{saving ? 'Saving...' : 'Save thumbnail'}</Button>
            </div>
          </div>
        </div> : null}
      </DialogContent>
    </Dialog>
  </>;
}
