'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { OurCategoryEditorData } from '@/lib/our-categories';
import type { TemplateOpeningRegion } from '@/lib/our-category-template-composite';
import {
  DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
  PRINTSHRIMP_CUSTOM_FONTS,
  type PrintShrimpCustomFontId,
} from '@/lib/printshrimp/custom-fonts';
import {
  TEMPLATE_GRID_FRAME_OPTIONS,
  TEMPLATE_GRID_RATIO_OPTIONS,
  defaultTemplateGridLayout,
  resizeTemplateGridLayout,
  templateGridCellRects,
  validateTemplateGridLayout,
  type TemplateGridCell,
  type TemplateGridLayout,
} from '@/lib/template-grid-layout';
import { TemplateGridAreaEditor } from './TemplateGridAreaEditor';

const selectClassName = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
const checkboxClassName = 'h-4 w-4 rounded border-input accent-primary';

function parentTemplateImageUrl(categoryId: string) {
  return `/our-templates/${encodeURIComponent(categoryId)}/edit?tab=image-templates`;
}

function GridPreview({ region, layout }: { region: TemplateOpeningRegion; layout: TemplateGridLayout }) {
  const width = Math.max(1, region.corners.topRight.x - region.corners.topLeft.x + 1);
  const height = Math.max(1, region.corners.bottomLeft.y - region.corners.topLeft.y + 1);
  const cells = templateGridCellRects(width, height, layout);
  return (
    <div className="flex justify-center overflow-auto rounded-md border bg-muted/20 p-3">
      <div className="relative w-full max-w-3xl border-2 border-dashed border-pink-500 bg-pink-100/40" style={{ aspectRatio: `${width} / ${height}` }}>
        {cells.map((rect) => {
          const cell = layout.cells[rect.index];
          return (
            <div
              key={rect.index}
              className="absolute flex items-center justify-center bg-white/80 text-xs font-semibold shadow-sm"
              style={{
                left: `${rect.x / width * 100}%`,
                top: `${rect.y / height * 100}%`,
                width: `${rect.width / width * 100}%`,
                height: `${rect.height / height * 100}%`,
                border: cell.frameEnabled ? `5px solid ${cell.frameFinish === 'oak' ? '#b9804d' : cell.frameFinish === 'black' ? '#161616' : '#e5e5e2'}` : '1px solid #db2777',
              }}
            >Image {rect.index + 1}</div>
          );
        })}
      </div>
    </div>
  );
}

function AreaGridDialog({
  region,
  itemCount,
  onCancel,
  onComplete,
}: {
  region: TemplateOpeningRegion;
  itemCount: number;
  onCancel(): void;
  onComplete(layout: TemplateGridLayout): void;
}) {
  const [layout, setLayout] = useState<TemplateGridLayout>(() => region.grid
    ? structuredClone(region.grid)
    : defaultTemplateGridLayout(1));

  function complete() {
    try {
      onComplete(validateTemplateGridLayout(layout, itemCount));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The grid settings are invalid.');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {region.name}</DialogTitle>
          <DialogDescription>Choose the number of images, grid size and spacing. Complete saves this area layout.</DialogDescription>
        </DialogHeader>

        <GridPreview region={region} layout={layout} />

        <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium">
              No of Images
              <select
                aria-label="No of Images"
                className={selectClassName}
                value={layout.imageCount}
                onChange={(event) => setLayout((current) => resizeTemplateGridLayout(current, Number(event.target.value)))}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((number) => <option key={number} value={number}>{number}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Number of rows
              <select
                aria-label="Number of rows"
                className={selectClassName}
                value={layout.rows}
                onChange={(event) => {
                  const rows = Number(event.target.value);
                  setLayout((current) => ({ ...current, rows, columns: Math.max(current.columns, Math.ceil(current.imageCount / rows)) }));
                }}
              >
                {Array.from({ length: Math.min(4, layout.imageCount) }, (_, index) => index + 1).map((number) => <option key={number} value={number}>{number}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Number of columns
              <select
                aria-label="Number of columns"
                className={selectClassName}
                value={layout.columns}
                onChange={(event) => setLayout((current) => ({ ...current, columns: Number(event.target.value) }))}
              >
                {Array.from({ length: layout.imageCount }, (_, index) => index + 1).map((number) => (
                  <option key={number} value={number} disabled={layout.rows * number < layout.imageCount}>{number}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium md:col-span-3">
              Horizontal gap: {layout.horizontalGapPercent}%
              <input aria-label="Horizontal gap" type="range" min="0" max="50" step="1" value={layout.horizontalGapPercent} onChange={(event) => setLayout((current) => ({ ...current, horizontalGapPercent: Number(event.target.value) }))} />
            </label>
            <label className="grid gap-2 text-sm font-medium md:col-span-3">
              Vertical gap: {layout.verticalGapPercent}%
              <input aria-label="Vertical gap" type="range" min="0" max="50" step="1" value={layout.verticalGapPercent} onChange={(event) => setLayout((current) => ({ ...current, verticalGapPercent: Number(event.target.value) }))} />
            </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={complete}>Complete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImageCellDialog({
  regionName,
  cellIndex,
  cell,
  itemCount,
  onCancel,
  onComplete,
}: {
  regionName: string;
  cellIndex: number;
  cell: TemplateGridCell;
  itemCount: number;
  onCancel(): void;
  onComplete(cell: TemplateGridCell): void;
}) {
  const [draft, setDraft] = useState<TemplateGridCell>(() => structuredClone(cell));
  const imageNumber = cellIndex + 1;
  const update = (changes: Partial<TemplateGridCell>) => setDraft((current) => ({ ...current, ...changes }));
  const validBorderSize = !draft.borderEnabled || (draft.borderSizePercent >= 2.5 && draft.borderSizePercent <= 10);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-h-[94vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{regionName} · Image {imageNumber}</DialogTitle>
          <DialogDescription>Choose the listing artwork and how this image should be displayed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium md:col-span-2">
            Listing Image
            <select aria-label="Listing Image" className={selectClassName} value={draft.imageItemNumber} disabled={itemCount === 1} onChange={(event) => update({ imageItemNumber: Number(event.target.value) })}>
              {Array.from({ length: itemCount }, (_, index) => index + 1).map((number) => <option key={number} value={number}>Image {number}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Print Ratio
            <select aria-label="Print Ratio" className={selectClassName} value={draft.ratio} onChange={(event) => update({ ratio: event.target.value as TemplateGridCell['ratio'] })}>
              {TEMPLATE_GRID_RATIO_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Orientation
            <select aria-label="Orientation" className={selectClassName} value={draft.orientation} onChange={(event) => update({ orientation: event.target.value as TemplateGridCell['orientation'] })}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium md:col-span-2">
            <input aria-label="Border" type="checkbox" className={checkboxClassName} checked={draft.borderEnabled} onChange={(event) => update({ borderEnabled: event.target.checked })} />
            Border
          </label>
          {draft.borderEnabled ? <label className="grid gap-2 text-sm font-medium md:col-span-2">
            Border Size (%)
            <Input aria-label="Border Size (%)" type="number" min="2.5" max="10" step="0.5" value={draft.borderSizePercent} onChange={(event) => update({ borderSizePercent: Number(event.target.value) })} />
            <span className="text-xs font-normal text-muted-foreground">Choose between 2.5% and 10%.</span>
          </label> : null}
          <label className="grid gap-2 text-sm font-medium md:col-span-2">
            Frame Finish
            <select aria-label="Frame Finish" className={selectClassName} value={draft.frameFinish} onChange={(event) => {
              const frameFinish = event.target.value as TemplateGridCell['frameFinish'];
              update({ frameFinish, frameEnabled: frameFinish !== 'unframed' });
            }}>
              {TEMPLATE_GRID_FRAME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium md:col-span-2">
            Frame Thickness: {draft.frameThicknessPercent}%
            <input aria-label="Frame Thickness" type="range" min="2" max="12" step="0.5" value={draft.frameThicknessPercent} disabled={!draft.frameEnabled} onChange={(event) => update({ frameThicknessPercent: Number(event.target.value) })} />
          </label>
          <label className="grid gap-2 text-sm font-medium md:col-span-2">
            Frame Depth: {draft.frameDepthPercent}%
            <input aria-label="Frame Depth" type="range" min="0" max="5" step="0.5" value={draft.frameDepthPercent} disabled={!draft.frameEnabled} onChange={(event) => update({ frameDepthPercent: Number(event.target.value) })} />
          </label>
          <label className="grid gap-2 text-sm font-medium md:col-span-2">
            Shadow Strength: {draft.shadowStrength}%
            <input aria-label="Shadow Strength" type="range" min="0" max="25" step="1" value={draft.shadowStrength} onChange={(event) => update({ shadowStrength: Number(event.target.value) })} />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Top Text
            <Input maxLength={40} value={draft.topText} onChange={(event) => update({ topText: event.target.value })} />
            <span className="text-right text-xs font-normal text-muted-foreground">{draft.topText.length} / 40</span>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Bottom Text
            <Input maxLength={40} value={draft.bottomText} onChange={(event) => update({ bottomText: event.target.value })} />
            <span className="text-right text-xs font-normal text-muted-foreground">{draft.bottomText.length} / 40</span>
          </label>
          <label className="grid gap-2 text-sm font-medium md:col-span-2">
            Font
            <select aria-label="Font" className={selectClassName} value={draft.fontId} onChange={(event) => update({ fontId: event.target.value as PrintShrimpCustomFontId })}>
              {PRINTSHRIMP_CUSTOM_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
            </select>
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={!validBorderSize} onClick={() => onComplete({ ...draft, configured: true })}>Complete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewImageTemplateEditorClient({
  data,
  initialTemplate = null,
}: {
  data: OurCategoryEditorData;
  initialTemplate?: OurCategoryEditorData['imageTemplates'][number] | null;
}) {
  const [name, setName] = useState(initialTemplate?.name ?? '');
  const [description, setDescription] = useState(initialTemplate?.description ?? '');
  const [useOnPrints, setUseOnPrints] = useState(
    Boolean(data.values.printsFrames && (initialTemplate?.useOnPrints ?? true)),
  );
  const [useOnCustomised, setUseOnCustomised] = useState(
    Boolean(data.values.customisePrints && (initialTemplate?.useOnCustomised ?? true)),
  );
  const [useOnDigital, setUseOnDigital] = useState(
    Boolean(data.values.digitalDownload && (initialTemplate?.useOnDigital ?? true)),
  );
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(() => initialTemplate
    ? `/api/our-categories/templates/${encodeURIComponent(initialTemplate.id)}/image?v=${encodeURIComponent(initialTemplate.updatedAt)}`
    : null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(() => (
    initialTemplate?.imageWidth && initialTemplate.imageHeight
      ? { width: initialTemplate.imageWidth, height: initialTemplate.imageHeight }
      : null
  ));
  const [regions, setRegions] = useState<TemplateOpeningRegion[]>(() => structuredClone(initialTemplate?.openingRegions ?? []));
  const [imageRemoved, setImageRemoved] = useState(false);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ regionId: string; cellIndex: number } | null>(null);
  const [deleteRegionId, setDeleteRegionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const editingRegion = regions.find((region) => region.id === editingRegionId) ?? null;
  const editingCellRegion = editingCell ? regions.find((region) => region.id === editingCell.regionId) ?? null : null;
  const editingCellValue = editingCellRegion?.grid?.cells[editingCell?.cellIndex ?? -1] ?? null;
  const deleteRegion = regions.find((region) => region.id === deleteRegionId) ?? null;
  const defaultedCellCount = regions.reduce((total, region) => total + (region.grid?.cells.filter((cell) => !cell.configured).length ?? 0), 0);
  const hasTemplateImage = Boolean(file || (initialTemplate && !imageRemoved));
  const canSave = useMemo(() => Boolean(
    name.trim()
    && description.trim()
    && hasTemplateImage
    && imageSize,
  ), [description, hasTemplateImage, imageSize, name]);

  useEffect(() => () => { if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  function chooseFile(nextFile: File | null) {
    if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    setFile(nextFile);
    setImageUrl(nextFile ? URL.createObjectURL(nextFile) : null);
    setImageRemoved(!nextFile);
    setImageSize(null);
    setRegions([]);
  }

  function removeImage() {
    chooseFile(null);
    setFileInputKey((current) => current + 1);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data.categoryId || !hasTemplateImage || !imageSize) return;
    if (!canSave) {
      toast.error('Enter the template name and description, then upload a template image.');
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('name', name);
      formData.set('description', description);
      formData.set('displayFonts', 'false');
      formData.set('borderEnabled', 'false');
      formData.set('borderSizePercent', '5');
      formData.set('topText', '');
      formData.set('bottomText', '');
      formData.set('fontId', DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID);
      if (file) formData.set('file', file);
      formData.set('imageWidth', String(imageSize.width));
      formData.set('imageHeight', String(imageSize.height));
      formData.set('openingRegions', JSON.stringify(regions));
      formData.set('useOnPrints', String(useOnPrints));
      formData.set('useOnCustomised', String(useOnCustomised));
      formData.set('useOnDigital', String(useOnDigital));
      const response = await fetch(
        initialTemplate
          ? `/api/our-categories/templates/${encodeURIComponent(initialTemplate.id)}`
          : `/api/our-categories/${encodeURIComponent(data.categoryId)}/templates`,
        { method: initialTemplate ? 'PUT' : 'POST', body: formData },
      );
      const payload = await response.json() as { template?: { id: string }; error?: string };
      if (!response.ok || !payload.template) throw new Error(payload.error ?? 'Unable to create the image template.');
      toast.success(initialTemplate ? 'Image template saved.' : 'Image template created.');
      window.location.assign(parentTemplateImageUrl(data.categoryId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create the image template.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form onSubmit={save} className="grid gap-5">
        <div>
          <h1 className="text-2xl font-semibold">{initialTemplate ? 'Edit Image Template' : 'Create Image Template'}</h1>
          <p className="text-sm text-muted-foreground">{initialTemplate ? 'Edit' : 'Create'} grid-based artwork areas for {data.values.name}.</p>
        </div>

        <Card>
          <CardHeader><CardTitle>Template Details</CardTitle></CardHeader>
          <CardContent className="grid gap-5">
            <label className="grid gap-2 text-sm font-medium">
              Template Name
              <Input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
              <span className="text-right text-xs font-normal text-muted-foreground">{name.length} / 100</span>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Template Description
              <textarea required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <span className="text-right text-xs font-normal text-muted-foreground">{description.length} / 500</span>
            </label>
            <div className="grid gap-3 rounded-md border p-4">
              {data.values.printsFrames ? (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className={checkboxClassName} checked={useOnPrints} disabled={saving} onChange={(event) => setUseOnPrints(event.target.checked)} />
                  Prints – use on prints
                </label>
              ) : null}
              {data.values.customisePrints ? (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className={checkboxClassName} checked={useOnCustomised} disabled={saving} onChange={(event) => setUseOnCustomised(event.target.checked)} />
                  Customized prints – use on customised prints
                </label>
              ) : null}
              {data.values.digitalDownload ? (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className={checkboxClassName} checked={useOnDigital} disabled={saving} onChange={(event) => setUseOnDigital(event.target.checked)} />
                  Digital Downloads – use on digital downloads
                </label>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Template Image</CardTitle><CardDescription>Upload a PNG, then draw the areas that will contain listing artwork.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              Template Image
              <Input key={fileInputKey} required={!hasTemplateImage} type="file" accept="image/png" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
            </label>
            {imageUrl ? <TemplateGridAreaEditor
              imageUrl={imageUrl}
              initialImageSize={imageSize}
              regions={regions}
              disabled={saving}
              onImageSize={setImageSize}
              onRegionsChange={setRegions}
              onEditRegion={(region) => setEditingRegionId(region.id)}
              onEditCell={(region, cellIndex) => setEditingCell({ regionId: region.id, cellIndex })}
              onRequestDeleteRegion={(region) => setDeleteRegionId(region.id)}
              onRemoveImage={removeImage}
            /> : (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground"><Upload className="h-6 w-6" aria-hidden="true" />Choose a PNG template image.</div>
            )}
            {defaultedCellCount > 0 ? <p className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950">
              {defaultedCellCount} {defaultedCellCount === 1 ? 'image is' : 'images are'} using the default settings. Click an image if you want to change its settings.
            </p> : null}
          </CardContent>
        </Card>

        <div className="sticky bottom-3 z-40 flex items-center justify-between rounded-lg border bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/90">
          <Button type="button" variant="outline" onClick={() => window.location.assign(parentTemplateImageUrl(data.categoryId!))} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving || !canSave}><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Saving…' : initialTemplate ? 'Save' : 'Create'}</Button>
        </div>
      </form>

      {editingRegion ? <AreaGridDialog
        key={editingRegion.id}
        region={editingRegion}
        itemCount={data.values.itemCount}
        onCancel={() => setEditingRegionId(null)}
        onComplete={(layout) => {
          setRegions((current) => current.map((region) => region.id === editingRegion.id ? { ...region, grid: layout } : region));
          setEditingRegionId(null);
        }}
      /> : null}

      {editingCell && editingCellRegion && editingCellValue ? <ImageCellDialog
        key={`${editingCell.regionId}-${editingCell.cellIndex}`}
        regionName={editingCellRegion.name}
        cellIndex={editingCell.cellIndex}
        cell={editingCellValue}
        itemCount={data.values.itemCount}
        onCancel={() => setEditingCell(null)}
        onComplete={(cell) => {
          setRegions((current) => current.map((region) => region.id !== editingCell.regionId || !region.grid ? region : {
            ...region,
            grid: {
              ...region.grid,
              cells: region.grid.cells.map((currentCell, index) => index === editingCell.cellIndex ? cell : currentCell),
            },
          }));
          setEditingCell(null);
        }}
      /> : null}

      <Dialog open={deleteRegion !== null} onOpenChange={(open) => { if (!open) setDeleteRegionId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete {deleteRegion?.name}?</DialogTitle><DialogDescription>This will remove the area and all of its grid settings.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteRegionId(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => {
              if (deleteRegion) setRegions((current) => current.filter((region) => region.id !== deleteRegion.id));
              setDeleteRegionId(null);
            }}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
