'use client';

import { ChangeEvent, FormEvent, useState } from 'react';
import { closestCenter, DndContext, DragEndEvent, DragOverlay, DragStartEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, CheckCircle2, Plus, Trash2, Upload, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CollectionKind, ListingEditorData, UploadKind } from '@/lib/listing-editor';
import { ETSY_PRIMARY_COLOURS } from '@/lib/etsy-colours';
import { getNextPrintSize } from '@/lib/print-sizes';
import { ETSY_MAX_DOWNLOAD_FILES, ETSY_MAX_FILE_SIZE_BYTES } from '@/lib/etsy-download-limits';

type ListingEditorClientProps = {
  initialData: ListingEditorData | null;
  showAdminEditSection?: boolean;
  initialTab?: 'thumbnail' | 'images' | 'details' | 'tags' | 'downloads';
};

type EditorResponse = {
  data?: ListingEditorData | null;
  error?: string;
};

type SortableListingImageProps = {
  image: Pick<ListingEditorData['images'][number], 'id' | 'fileName' | 'originalFileName'>;
  index: number;
  disabled: boolean;
  imageUrl: string;
  onDelete: () => void;
  onPreview: () => void;
};

function SortableListingImage({ image, index, disabled, imageUrl, onDelete, onPreview }: SortableListingImageProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative h-32 w-32 touch-none select-none overflow-hidden rounded-lg border bg-muted ${
        isDragging ? 'z-10 border-dashed border-primary opacity-30' : 'border-border'
      } ${disabled ? 'cursor-wait' : 'cursor-grab active:cursor-grabbing'}`}
      onDoubleClick={onPreview}
      title="Drag to reorder; double-click to enlarge"
      {...attributes}
      {...listeners}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={image.originalFileName ?? image.fileName} draggable={false} className="pointer-events-none h-full w-full select-none object-cover" />
      {index === 0 ? <span className="pointer-events-none absolute left-2 top-2 rounded bg-background px-2 py-1 text-xs font-medium shadow">Featured</span> : null}
      <Button
        type="button"
        variant="destructive"
        size="icon"
        className="absolute bottom-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onDelete(); }}
        disabled={disabled}
        aria-label={`Delete ${image.originalFileName ?? image.fileName}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

const textAreaClassName =
  'min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const singleDownloadImageGuide = [
  'Listing image',
  'Bedroom',
  'Playroom',
  'Perfect gift',
  'Frames',
  'Sizes',
  'No Frames Included',
  'Digital Download',
  'How to print',
  'Personal Use Only',
];

function toNumberOrNull(value: string) {
  if (!value.trim()) {
    return null;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatPriceForInput(amount: number | null | undefined, divisor: number | null | undefined) {
  if (amount === null || amount === undefined) return '';
  return (amount / (divisor && divisor > 0 ? divisor : 100)).toFixed(2);
}

function createDetailsForm(listing: ListingEditorData['listing'] | undefined) {
  return {
    title: listing?.title ?? '',
    description: listing?.description ?? '',
    status: listing?.status ?? '',
    quantity: listing?.quantity?.toString() ?? '999',
    priceAmount: listing?.priceAmount === null || listing?.priceAmount === undefined
      ? '4.17'
      : formatPriceForInput(listing.priceAmount, listing.priceDivisor),
    priceDivisor: '100',
    priceCurrencyCode: listing?.priceCurrencyCode ?? 'GBP',
    taxonomyId: listing?.taxonomyId?.toString() ?? '',
    shopSectionId: listing?.shopSectionId?.toString() ?? '',
    whoMade: listing?.whoMade ?? 'i_did',
    whenMade: listing?.whenMade ?? '2020_2026',
    isSupply: listing?.isSupply ?? false,
    shouldAutoRenew: listing?.shouldAutoRenew ?? true,
    isPersonalizable: listing?.isPersonalizable ?? false,
    language: listing?.language ?? 'en-US',
    primaryColour: listing?.primaryColour ?? '',
    secondaryColour: listing?.secondaryColour ?? '',
  };
}

function itemText(value: string | null | undefined) {
  return value && value.trim() ? value : 'Not set';
}

function parseTags(value: string) {
  return value
    .split(/[,\r\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniqueTags(tags: string[]) {
  return tags.filter(
    (tag, index) => tags.findIndex((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index
  );
}

function haveSameTags(first: string[], second: string[]) {
  const normalizeTags = (tags: string[]) => tags.map((tag) => tag.trim().toLocaleLowerCase()).sort();
  return JSON.stringify(normalizeTags(first)) === JSON.stringify(normalizeTags(second));
}

export function ListingEditorClient({ initialData, showAdminEditSection = false, initialTab = 'thumbnail' }: ListingEditorClientProps) {
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<'thumbnail' | 'images' | 'details' | 'tags' | 'downloads'>(initialTab);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [deleteThumbnailOpen, setDeleteThumbnailOpen] = useState(false);
  const [deleteAllDownloadsOpen, setDeleteAllDownloadsOpen] = useState(false);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [simpleInputs, setSimpleInputs] = useState({ tag: '', material: '', style: '' });
  const [tagDraft, setTagDraft] = useState<string[]>(() => initialData?.tags.map((tag) => tag.value) ?? []);
  const [zipAssignments, setZipAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialData?.files.map((file) => [file.id, file.zipNumber?.toString() ?? '']) ?? [])
  );
  const [translation, setTranslation] = useState({ language: 'en-US', title: '', description: '' });
  const [inventory, setInventory] = useState({ name: '', value: '', sku: '', price: '', quantity: '' });
  const [personalization, setPersonalization] = useState({ instructions: '', isRequired: false, charCountMax: '' });
  const [buyerPrice, setBuyerPrice] = useState({ amount: '', divisor: '100', currencyCode: 'GBP', note: '' });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [form, setForm] = useState(() => createDetailsForm(initialData?.listing));

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Edit Listing</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Listing not found.</CardContent>
      </Card>
    );
  }

  const context = data.context;
  const usesDropboxPdfDownload = data.subSection.includeAllDownloads
    || data.subSection.numberOfDownloads === 6
    || data.subSection.numberOfDownloads === 12;
  const detailsChanged = JSON.stringify(form) !== JSON.stringify(createDetailsForm(data.listing));
  const desiredTags = uniqueTags([...tagDraft, ...parseTags(simpleInputs.tag)]);
  const tagsChanged = !haveSameTags(desiredTags, data.tags.map((tag) => tag.value));

  function getImageUrl(assetId: string) {
    return `/api/shops/listings/editor/assets?${new URLSearchParams({ ...context, kind: 'image', assetId })}`;
  }

  function getThumbnailUrl() {
    return `/api/shops/listings/editor/assets?${new URLSearchParams({ ...context, kind: 'thumbnail', assetId: 'thumbnail' })}`;
  }

  function updateForm(key: keyof typeof form, value: string | boolean) {
    setForm((currentForm) => ({
      ...currentForm,
      [key]: value,
    }));
  }

  async function loadTextFile(field: 'title' | 'description', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!file) {
      return;
    }

    if (file.type && file.type !== 'text/plain' && !file.name.toLocaleLowerCase().endsWith('.txt')) {
      setError('Choose a plain text (.txt) file.');
      return;
    }

    try {
      const contents = await file.text();
      updateForm(field, field === 'title' ? contents.trim() : contents);
      setError(null);
    } catch {
      setError(`Unable to read ${file.name}.`);
    }
  }

  function startImageDrag(event: DragStartEvent) {
    if (busyKey === null) setActiveImageId(String(event.active.id));
  }

  async function finishImageDrag(event: DragEndEvent) {
    setActiveImageId(null);
    if (!data || busyKey !== null || !event.over || event.active.id === event.over.id) return;

    const oldIndex = data.images.findIndex((image) => image.id === String(event.active.id));
    const newIndex = data.images.findIndex((image) => image.id === String(event.over!.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const previousData = data;
    const reorderedImages = arrayMove(data.images, oldIndex, newIndex);
    setData({ ...data, images: reorderedImages });
    setBusyKey('reorder-images');
    setError(null);

    try {
      const response = await fetch('/api/shops/listings/editor/assets/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, imageIds: reorderedImages.map((image) => image.id) }),
      });
      const result = (await response.json()) as EditorResponse;
      if (!response.ok) throw new Error(result.error ?? 'Unable to save image order.');
      if (!result.data) throw new Error('The saved image order was not returned.');
      setData(result.data);
    } catch (caughtError) {
      setData(previousData);
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save image order.');
    } finally {
      setBusyKey(null);
    }
  }

  function undoDetails() {
    if (!data) {
      return;
    }

    setForm(createDetailsForm(data.listing));
    setError(null);
  }

  function applyFreshData(nextData: ListingEditorData | null | undefined, preserveZipAssignments = false) {
    if (!nextData) {
      return;
    }

    setData(nextData);
    setZipAssignments((currentAssignments) => Object.fromEntries(
      nextData.files.map((file) => [
        file.id,
        preserveZipAssignments ? currentAssignments[file.id] ?? file.zipNumber?.toString() ?? '' : file.zipNumber?.toString() ?? '',
      ])
    ));
  }

  async function parseResponse(response: Response, fallbackMessage: string) {
    const payload = (await response.json()) as EditorResponse;

    if (!response.ok) {
      throw new Error(payload.error ?? fallbackMessage);
    }

    applyFreshData(payload.data);
    return payload.data;
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const response = await fetch('/api/shops/listings/editor', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...context,
          title: form.title,
          description: form.description,
          status: form.status,
          quantity: toNumberOrNull(form.quantity),
          priceAmount: form.priceAmount.trim() ? Math.round(Number(form.priceAmount) * 100) : null,
          priceDivisor: 100,
          priceCurrencyCode: form.priceCurrencyCode,
          taxonomyId: toNumberOrNull(form.taxonomyId),
          shopSectionId: toNumberOrNull(form.shopSectionId),
          whoMade: form.whoMade,
          whenMade: form.whenMade,
          isSupply: form.isSupply,
          shouldAutoRenew: form.shouldAutoRenew,
          isPersonalizable: form.isPersonalizable,
          language: form.language,
          primaryColour: form.primaryColour,
          secondaryColour: form.secondaryColour,
        }),
      });

      const nextData = await parseResponse(response, 'Unable to save listing details.');
      if (nextData) setForm(createDetailsForm(nextData.listing));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save listing details.');
    } finally {
      setSaving(false);
    }
  }

  async function addCollectionItem(kind: CollectionKind, payload: Record<string, unknown>) {
    setError(null);
    setBusyKey(`add-${kind}`);

    try {
      const response = await fetch('/api/shops/listings/editor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...context, kind, payload }),
      });

      await parseResponse(response, 'Unable to add item.');

      if (kind === 'tag' || kind === 'material' || kind === 'style') {
        setSimpleInputs((currentInputs) => ({ ...currentInputs, [kind]: '' }));
      }

      if (kind === 'translation') setTranslation({ language: 'en-US', title: '', description: '' });
      if (kind === 'inventory') setInventory({ name: '', value: '', sku: '', price: '', quantity: '' });
      if (kind === 'personalization') setPersonalization({ instructions: '', isRequired: false, charCountMax: '' });
      if (kind === 'buyerPrice') setBuyerPrice({ amount: '', divisor: '100', currencyCode: 'GBP', note: '' });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to add item.');
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteCollectionItem(kind: CollectionKind, itemId: string) {
    setError(null);
    setBusyKey(`${kind}-${itemId}`);

    try {
      const response = await fetch('/api/shops/listings/editor', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...context, kind, itemId }),
      });

      await parseResponse(response, 'Unable to delete item.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to delete item.');
    } finally {
      setBusyKey(null);
    }
  }

  async function loadTagsTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!file) return;
    if (file.type && file.type !== 'text/plain' && !file.name.toLocaleLowerCase().endsWith('.txt')) {
      setError('Choose a plain text (.txt) file.');
      return;
    }

    try {
      const contents = (await file.text()).trim();
      setSimpleInputs((inputs) => ({ ...inputs, tag: contents }));
      setError(null);
    } catch {
      setError(`Unable to read ${file.name}.`);
    }
  }

  function cancelTagChanges() {
    if (!data) return;
    setTagDraft(data.tags.map((tag) => tag.value));
    setSimpleInputs((inputs) => ({ ...inputs, tag: '' }));
    setError(null);
  }

  async function saveTagChanges() {
    if (!data) return;

    const tags = uniqueTags([...tagDraft, ...parseTags(simpleInputs.tag)]);
    if (tags.length > 13) {
      setError('A listing can have no more than 13 tags.');
      return;
    }

    setError(null);
    setBusyKey('save-tags');

    try {
      const response = await fetch('/api/shops/listings/editor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, tags }),
      });
      const payload = (await response.json()) as EditorResponse;
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save tags.');

      applyFreshData(payload.data);
      setTagDraft(payload.data?.tags.map((tag) => tag.value) ?? tags);
      setSimpleInputs((inputs) => ({ ...inputs, tag: '' }));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save tags.');
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadFiles(kind: UploadKind, files: File[]) {
    if (files.length === 0) return;

    if (kind === 'image' && data!.images.length + files.length > 20) {
      setError(`You can upload ${20 - data!.images.length} more image${20 - data!.images.length === 1 ? '' : 's'}.`);
      return;
    }

    setError(null);
    setBusyKey(`upload-${kind}`);

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.set('shopId', context.shopId);
        formData.set('sectionId', context.sectionId);
        formData.set('subSectionId', context.subSectionId);
        formData.set('listingId', context.listingId);
        formData.set('kind', kind);
        formData.set('file', file);

        const response = await fetch('/api/shops/listings/editor/assets', { method: 'POST', body: formData });
        await parseResponse(response, 'Unable to upload asset.');
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to upload asset.');
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadAsset(kind: UploadKind, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await uploadFiles(kind, files);
  }

  async function deleteAsset(kind: UploadKind, assetId: string) {
    setError(null);
    setBusyKey(`${kind}-${assetId}`);

    try {
      const response = await fetch('/api/shops/listings/editor/assets', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...context, kind, assetId }),
      });

      await parseResponse(response, 'Unable to delete asset.');
      return true;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to delete asset.');
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteAllDownloads() {
    setError(null);
    setBusyKey('delete-all-downloads');
    try {
      const response = await fetch('/api/shops/listings/editor/assets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, deleteAll: true }),
      });
      await parseResponse(response, 'Unable to delete all downloads.');
      setDeleteAllDownloadsOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to delete all downloads.');
    } finally {
      setBusyKey(null);
    }
  }

  async function createZipFiles() {
    if (!data || data.files.length === 0 || data.files.some((file) => !/^\d+$/.test(zipAssignments[file.id] ?? ''))) return;

    setError(null);
    setBusyKey('create-zips');
    try {
      const response = await fetch('/api/shops/listings/editor/assets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...context,
          assignments: data.files.map((file) => ({ fileId: file.id, zipNumber: Number(zipAssignments[file.id]) })),
        }),
      });
      await parseResponse(response, 'Unable to create zip files.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create zip files.');
    } finally {
      setBusyKey(null);
    }
  }

  async function reduceDownload(fileId: string) {
    setError(null);
    setBusyKey(`reduce-${fileId}`);
    try {
      const response = await fetch('/api/shops/listings/editor/assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, assetId: fileId }),
      });
      const payload = (await response.json()) as EditorResponse;
      if (!response.ok) throw new Error(payload.error ?? 'Unable to reduce download.');
      applyFreshData(payload.data, true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to reduce download.');
    } finally {
      setBusyKey(null);
    }
  }

  async function recompressDownload(fileId: string) {
    setError(null);
    setBusyKey(`reduce-quality-${fileId}`);
    try {
      const response = await fetch('/api/shops/listings/editor/assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, assetId: fileId, action: 'reduceQuality' }),
      });
      const payload = (await response.json()) as EditorResponse;
      if (!response.ok) throw new Error(payload.error ?? 'Unable to recompress download.');
      applyFreshData(payload.data, true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to recompress download.');
    } finally {
      setBusyKey(null);
    }
  }

  function renderSimpleCollection(kind: 'tag' | 'material' | 'style', title: string, items: Array<{ id: string; value: string }>) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Input
              value={simpleInputs[kind]}
              onChange={(event) => setSimpleInputs((currentInputs) => ({ ...currentInputs, [kind]: event.target.value }))}
              placeholder={title.slice(0, -1)}
            />
            <Button type="button" onClick={() => addCollectionItem(kind, { value: simpleInputs[kind] })} disabled={busyKey !== null}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {items.length > 0 ? (
              items.map((item) => (
                <span key={item.id} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  {item.value}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Remove ${item.value}`}
                    onClick={() => deleteCollectionItem(kind, item.id)}
                    disabled={busyKey !== null}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </span>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">None set.</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderAssets(kind: UploadKind, title: string, items: Array<{ id: string; fileName: string; originalFileName: string | null }>) {
    const accept = kind === 'image' ? 'image/jpeg,image/png,image/webp' : kind === 'video' ? 'video/mp4,video/quicktime,video/webm' : undefined;

    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload
            <input type="file" className="sr-only" accept={accept} onChange={(event) => uploadAsset(kind, event)} disabled={busyKey !== null} />
          </label>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Saved Name</TableHead>
                <TableHead>Original Name</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length > 0 ? (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.fileName}</TableCell>
                    <TableCell>{item.originalFileName ?? 'Unknown'}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Delete ${item.fileName}`}
                        onClick={() => deleteAsset(kind, item.id)}
                        disabled={busyKey !== null}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    None uploaded.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  function renderWorkflowAssetTable(
    kind: 'image' | 'file',
    title: string,
    items: Array<{
      id: string;
      fileName: string;
      originalFileName: string | null;
      sizeBytes?: number | null;
      widthPixels?: number | null;
      heightPixels?: number | null;
      jpegQuality?: number;
      zipNumber?: number | null;
    }>
  ) {
    if (kind === 'image') {
      const remaining = 20 - items.length;

      return (
        <div className="grid gap-6">
          <div>
            <h3 className="text-lg font-semibold">Photo and video</h3>
            <p className="text-sm text-muted-foreground">Show off different angles, available options, or details of your listing.</p>
            {data?.subSection.numberOfDownloads === 1 && !data.subSection.includeAllDownloads ? (
              <div className="mt-3 grid w-fit grid-cols-[max-content_max-content] gap-x-6 text-sm">
                <ol className="list-inside list-decimal">
                  {singleDownloadImageGuide.slice(0, 6).map((item) => <li key={item}>{item}</li>)}
                </ol>
                <ol start={7} className="list-inside list-decimal">
                  {singleDownloadImageGuide.slice(6).map((item) => <li key={item}>{item}</li>)}
                </ol>
              </div>
            ) : null}
          </div>
          <div>
            <p className="mb-4 font-semibold">Add up to 20 photos.</p>
            <div
              className="rounded-lg border border-dashed border-border p-5"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (busyKey !== null) return;
                void uploadFiles('image', Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/')));
              }}
            >
              {items.length === 0 ? (
                <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
                  <p className="font-medium">Drag and drop files or</p>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-muted px-5 py-3 text-sm font-semibold hover:bg-accent">
                    <Plus className="h-5 w-5" aria-hidden="true" /> Upload
                    <input type="file" multiple className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={(event) => uploadAsset('image', event)} disabled={busyKey !== null} />
                  </label>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={startImageDrag}
                  onDragCancel={() => setActiveImageId(null)}
                  onDragEnd={(event) => { void finishImageDrag(event); }}
                >
                <div className="flex flex-wrap gap-3">
                  <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
                    {items.map((item, index) => (
                      <SortableListingImage
                        key={item.id}
                        image={item}
                        index={index}
                        disabled={busyKey !== null}
                        imageUrl={getImageUrl(item.id)}
                        onPreview={() => setPreviewImage({ src: getImageUrl(item.id), alt: item.originalFileName ?? item.fileName })}
                        onDelete={() => { void deleteAsset('image', item.id); }}
                      />
                    ))}
                  </SortableContext>
                  {remaining > 0 ? (
                    <label className="flex h-32 w-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center text-sm font-medium hover:bg-accent">
                      <Plus className="h-6 w-6" aria-hidden="true" /> Add photos
                      <span className="text-xs font-normal text-muted-foreground">{remaining} remaining</span>
                      <input type="file" multiple className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={(event) => uploadAsset('image', event)} disabled={busyKey !== null} />
                    </label>
                  ) : null}
                </div>
                <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
                  {activeImageId ? (() => {
                    const activeImage = items.find((item) => item.id === activeImageId);
                    return activeImage ? (
                      <div className="h-32 w-32 overflow-hidden rounded-lg border-2 border-primary bg-muted shadow-xl">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={getImageUrl(activeImage.id)} alt={activeImage.originalFileName ?? activeImage.fileName} draggable={false} className="h-full w-full select-none object-cover" />
                      </div>
                    ) : null;
                  })() : null}
                </DragOverlay>
                </DndContext>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (usesDropboxPdfDownload) {
      const pdfFiles = items.filter((item) => /\.pdf$/i.test(item.originalFileName ?? item.fileName));
      return (
        <div className="grid gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          {pdfFiles.length > 0 ? pdfFiles.map((item) => (
            <div key={item.id} className="rounded-md border p-4">
              <div className="font-medium">{item.originalFileName ?? item.fileName}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {item.sizeBytes !== null && item.sizeBytes !== undefined
                  ? `${(item.sizeBytes / (1024 * 1024)).toFixed(2)} MB`
                  : 'Size unavailable'}
              </div>
            </div>
          )) : <p className="text-sm text-muted-foreground">No PDF file available.</p>}
        </div>
      );
    }

    const assignmentTotals = new Map<number, number>();
    for (const item of items) {
      const zipNumber = Number(zipAssignments[item.id]);
      if (Number.isInteger(zipNumber) && zipNumber > 0) assignmentTotals.set(zipNumber, (assignmentTotals.get(zipNumber) ?? 0) + (item.sizeBytes ?? 0));
    }
    const usedZipNumbers = [...assignmentTotals.keys()].sort((first, second) => first - second);
    const assignmentsAreConsecutive = usedZipNumbers.every((zipNumber, index) => zipNumber === index + 1);
    const canCreateZips = items.length > 0
      && items.every((item) => /^\d+$/.test(zipAssignments[item.id] ?? '') && item.sizeBytes !== null)
      && assignmentsAreConsecutive
      && usedZipNumbers.every((zipNumber) => zipNumber <= ETSY_MAX_DOWNLOAD_FILES)
      && [...assignmentTotals.values()].every((total) => total <= ETSY_MAX_FILE_SIZE_BYTES);
    const displayedZipCount = ETSY_MAX_DOWNLOAD_FILES;
    const zipRows = Array.from({ length: displayedZipCount }, (_, index) => index + 1).map((zipNumber) => ({
      zipNumber,
      zipped: data!.zippedFiles.find((zip) => zip.zipNumber === zipNumber) ?? null,
      sourceSize: items
        .filter((item) => zipAssignments[item.id] === String(zipNumber))
        .reduce((total, item) => total + (item.sizeBytes ?? 0), 0),
      fileCount: items.filter((item) => zipAssignments[item.id] === String(zipNumber)).length,
    }));

    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload Download
              <input
                type="file"
                multiple
                className="sr-only"
              onChange={(event) => uploadAsset(kind, event)}
              disabled={busyKey !== null}
            />
          </label>
          <Button type="button" onClick={createZipFiles} disabled={busyKey !== null || !canCreateZips}>
            {busyKey === 'create-zips' ? 'Creating...' : 'Zip ->'}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zipped Files</TableHead>
              <TableHead className="text-right">Actual ZIP size</TableHead>
              <TableHead className="text-right">Estimated source total</TableHead>
              <TableHead className="text-right">Files</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {zipRows.map((row) => (
              <TableRow
                key={row.zipNumber}
                className={(row.zipped?.sizeBytes ?? row.sourceSize) > ETSY_MAX_FILE_SIZE_BYTES ? 'bg-red-50 hover:bg-red-100' : undefined}
              >
                <TableCell className="font-medium">zip_{row.zipNumber}</TableCell>
                <TableCell className="text-right">{row.zipped ? `${(row.zipped.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : '-'}</TableCell>
                <TableCell className="text-right">{`${(row.sourceSize / (1024 * 1024)).toFixed(2)} MB`}</TableCell>
                <TableCell className="text-right">{row.fileCount}</TableCell>
                <TableCell className="text-right">
                  {row.sourceSize <= ETSY_MAX_FILE_SIZE_BYTES
                    ? `${((ETSY_MAX_FILE_SIZE_BYTES - row.sourceSize) / (1024 * 1024)).toFixed(2)} MB`
                    : <span className="text-destructive">Over limit</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead colSpan={2}>
                <div className="flex items-center justify-between gap-3">
                  <span>{title}</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteAllDownloadsOpen(true)}
                    disabled={busyKey !== null || items.length === 0}
                  >
                    Delete All
                  </Button>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length > 0 ? items.map((item) => {
              const individuallyInvalid = item.sizeBytes != null && item.sizeBytes > ETSY_MAX_FILE_SIZE_BYTES;
              return (
              <TableRow key={item.id} className={individuallyInvalid ? 'bg-red-50 hover:bg-red-100' : undefined}>
                <TableCell>
                  <div className="font-medium">
                    {item.originalFileName ?? item.fileName}
                    {/\.jpe?g$/i.test(item.originalFileName ?? item.fileName) ? ` (${item.jpegQuality ?? 100}%)` : ''}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {item.widthPixels && item.heightPixels ? `${item.widthPixels} x ${item.heightPixels} px | ` : ''}
                    {item.sizeBytes !== null && item.sizeBytes !== undefined
                      ? `${(item.sizeBytes / (1024 * 1024)).toFixed(2)} MB`
                      : 'Size unavailable'}
                  </div>
                  {individuallyInvalid ? (
                    <div className="mt-2 flex items-start gap-2 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>This file is larger than the 20 MB ZIP limit and must be reduced.</span>
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-grid grid-cols-[4rem_10rem_5rem_2.25rem] items-center gap-2">
                    <select
                      aria-label={`Zip number for ${item.fileName}`}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={zipAssignments[item.id] ?? ''}
                      onChange={(event) => {
                        const nextAssignments = { ...zipAssignments, [item.id]: event.target.value };
                        const selectedZip = Number(event.target.value);
                        const total = items
                          .filter((candidate) => Number(nextAssignments[candidate.id]) === selectedZip)
                          .reduce((sum, candidate) => sum + (candidate.sizeBytes ?? 0), 0);
                        setZipAssignments(nextAssignments);
                        setError(total > ETSY_MAX_FILE_SIZE_BYTES ? `ZIP ${selectedZip} exceeds Etsy's 20 MB file limit.` : null);
                      }}
                      disabled={busyKey !== null}
                    >
                      <option value="">-</option>
                      {Array.from({ length: ETSY_MAX_DOWNLOAD_FILES }, (_, index) => index + 1).map((number) => <option key={number} value={number}>{number}</option>)}
                    </select>
                    {(() => {
                      const target = getNextPrintSize(item.widthPixels, item.heightPixels);
                      return target ? (
                        <Button type="button" variant="outline" className="w-full" onClick={() => reduceDownload(item.id)} disabled={busyKey !== null}>
                          {busyKey === `reduce-${item.id}` ? 'Resizing...' : `${target.width} x ${target.height} px`}
                        </Button>
                      ) : <span aria-hidden="true" />;
                    })()}
                    {/\.jpe?g$/i.test(item.originalFileName ?? item.fileName) ? (
                      <Button type="button" variant="outline" className="w-full" onClick={() => recompressDownload(item.id)} disabled={busyKey !== null || (item.jpegQuality ?? 100) <= 10}>
                        {busyKey === `reduce-quality-${item.id}` ? 'Saving...' : (item.jpegQuality ?? 100) <= 10 ? '10%' : `${(item.jpegQuality ?? 100) - 10}%`}
                      </Button>
                    ) : <span aria-hidden="true" />}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Delete ${item.fileName}`}
                      onClick={() => deleteAsset(kind, item.id)}
                      disabled={busyKey !== null}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );}) : (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground">None uploaded.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  function renderThumbnail() {
    return (
      <div className="grid gap-6">
        <div>
          <h3 className="text-lg font-semibold">Thumbnail</h3>
          <p className="text-sm text-muted-foreground">
            This thumbnail is used to generate the artwork and the downloadable items. It is not uploaded to Etsy.
          </p>
        </div>
        {data?.thumbnail ? (
          <div
            className="group relative h-48 w-48 overflow-hidden rounded-lg border border-border bg-muted"
            onDoubleClick={() => setPreviewImage({
              src: getThumbnailUrl(),
              alt: data.thumbnail?.originalFileName ?? data.thumbnail?.fileName ?? 'Thumbnail',
            })}
            title="Double-click to enlarge"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getThumbnailUrl()}
              alt={data.thumbnail.originalFileName ?? data.thumbnail.fileName}
              className="h-full w-full object-cover"
            />
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute bottom-2 right-2 h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              aria-label="Delete thumbnail"
              onClick={() => setDeleteThumbnailOpen(true)}
              disabled={busyKey !== null}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <div
            className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border p-5"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (busyKey !== null) return;
              const image = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith('image/'));
              if (image) void uploadFiles('thumbnail', [image]);
            }}
          >
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-muted px-5 py-3 text-sm font-semibold hover:bg-accent">
              <Plus className="h-5 w-5" aria-hidden="true" /> Add photo
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => uploadAsset('thumbnail', event)}
                disabled={busyKey !== null}
              />
            </label>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="mb-4">{data.listing.localDirectoryName ?? data.listing.title}</CardTitle>
          {data.pendingChanges.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <span className="font-medium">Pending Etsy sync:</span>
              {data.pendingChanges.map((area) => (
                <span key={area} className="rounded-full bg-amber-100 px-2.5 py-1 font-medium">{area}</span>
              ))}
            </div>
          ) : null}
          <div className="flex gap-1 border-b border-border" role="tablist" aria-label="Listing editor sections">
            {([
              ['thumbnail', 'Thumbnail'],
              ['images', 'Images'],
              ['details', 'Details'],
              ['tags', 'Tags'],
              ['downloads', 'Downloads'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={activeTab === value}
                onClick={() => setActiveTab(value)}
                className={`border-b-2 px-4 py-3 text-sm font-medium ${
                  activeTab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
                {label !== 'Thumbnail' && data.pendingChanges.includes(label) ? (
                  <span className="ml-1 text-amber-600" aria-label="Changed">●</span>
                ) : null}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {activeTab === 'thumbnail' ? renderThumbnail() : null}
          {activeTab === 'images' ? renderWorkflowAssetTable('image', 'Images', data.images) : null}
          {activeTab === 'downloads' ? renderWorkflowAssetTable('file', 'Downloads', data.files) : null}
          {activeTab === 'details' ? (
            <form className="grid gap-4" onSubmit={saveDetails}>
                <div className="grid gap-2 text-sm font-medium">
                  <span>Title</span>
                  <span className="flex items-center gap-2">
                    <Input value={form.title} onChange={(event) => updateForm('title', event.target.value)} />
                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-input px-4 py-2 font-medium hover:bg-accent">
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      Load text
                      <input
                        type="file"
                        className="sr-only"
                        accept=".txt,text/plain"
                        onChange={(event) => loadTextFile('title', event)}
                      />
                    </label>
                  </span>
                </div>
                <div className="grid gap-2 text-sm font-medium">
                  <span>Description</span>
                  <span className="flex items-start gap-2">
                    <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} className={textAreaClassName} />
                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-input px-4 py-2 font-medium hover:bg-accent">
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      Load text
                      <input
                        type="file"
                        className="sr-only"
                        accept=".txt,text/plain"
                        onChange={(event) => loadTextFile('description', event)}
                      />
                    </label>
                  </span>
                </div>
                <div className="grid gap-4">
                  <label className="grid gap-2 text-sm font-medium">
                    Price (£)
                    <Input type="number" min="0" step="0.01" value={form.priceAmount} onChange={(event) => updateForm('priceAmount', event.target.value)} />
                  </label>
                  <label className="grid gap-2 text-sm font-medium">
                    Quantity
                    <Input type="number" value={form.quantity} onChange={(event) => updateForm('quantity', event.target.value)} />
                  </label>
                </div>
                <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm font-medium">
                    Primary Colour
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.primaryColour} onChange={(event) => updateForm('primaryColour', event.target.value)}>
                      <option value="">Select colour</option>
                      {ETSY_PRIMARY_COLOURS.map((colour) => <option key={colour.value} value={colour.value}>{colour.label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-2 text-sm font-medium">
                    Secondary Colour
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.secondaryColour} onChange={(event) => updateForm('secondaryColour', event.target.value)}>
                      <option value="">Select colour</option>
                      {ETSY_PRIMARY_COLOURS.map((colour) => <option key={colour.value} value={colour.value}>{colour.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={undoDetails} disabled={saving || !detailsChanged}>Undo</Button>
                  <Button type="submit" disabled={saving || !detailsChanged}>{saving ? 'Saving...' : 'Save'}</Button>
                </div>
            </form>
          ) : null}
          {activeTab === 'tags' ? (
            <div className="grid gap-4">
              <div>
                <h3 className="font-semibold">Tags</h3>
                <p className="text-sm text-muted-foreground">Add up to 13 tags to help people search for your listings.</p>
              </div>
              <div className="flex gap-2">
                <Input
                  value={simpleInputs.tag}
                  onChange={(event) => setSimpleInputs((inputs) => ({ ...inputs, tag: event.target.value }))}
                  placeholder="Shape, colour, style, function, etc."
                />
                <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent">
                  <Upload className="h-4 w-4" aria-hidden="true" /> Upload
                  <input type="file" className="sr-only" accept=".txt,text/plain" onChange={loadTagsTextFile} disabled={busyKey !== null} />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={cancelTagChanges} disabled={busyKey !== null || !tagsChanged}>Cancel</Button>
                <Button type="button" onClick={saveTagChanges} disabled={busyKey !== null || !tagsChanged}>
                  {busyKey === 'save-tags' ? 'Saving...' : 'Save'}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tagDraft.length > 0 ? tagDraft.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-medium">
                    {tag}
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 rounded-full" aria-label={`Remove ${tag}`} onClick={() => setTagDraft((tags) => tags.filter((value) => value !== tag))} disabled={busyKey !== null}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </span>
                )) : <p className="text-sm text-muted-foreground">None set.</p>}
                <span className="self-center text-sm text-muted-foreground">{desiredTags.length} of 13 used</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={previewImage !== null} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className="max-w-5xl p-4">
          <DialogHeader>
            <DialogTitle>{previewImage?.alt ?? 'Image preview'}</DialogTitle>
          </DialogHeader>
          {previewImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewImage.src} alt={previewImage.alt} className="max-h-[80vh] w-full object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteThumbnailOpen}
        onOpenChange={(open) => { if (busyKey === null) setDeleteThumbnailOpen(open); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete thumbnail?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this thumbnail? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteThumbnailOpen(false)} disabled={busyKey !== null}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                if (await deleteAsset('thumbnail', 'thumbnail')) setDeleteThumbnailOpen(false);
              }}
              disabled={busyKey !== null}
            >
              {busyKey === 'thumbnail-thumbnail' ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteAllDownloadsOpen}
        onOpenChange={(open) => { if (busyKey !== 'delete-all-downloads') setDeleteAllDownloadsOpen(open); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all download files?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete all these files? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteAllDownloadsOpen(false)} disabled={busyKey === 'delete-all-downloads'}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={deleteAllDownloads} disabled={busyKey === 'delete-all-downloads'}>
              {busyKey === 'delete-all-downloads' ? 'Deleting...' : 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {showAdminEditSection ? (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Edit Listing</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.shop.shopName} / {data.section.sectionName}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            {data.readyToUpload ? (
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
            )}
            {data.readyToUpload ? 'Ready to upload' : 'Not ready'}
          </div>
        </CardHeader>
        <CardContent>
          {!data.readyToUpload ? (
            <p className="mb-4 text-sm text-muted-foreground">Missing: {data.missingUploadFields.join(', ')}</p>
          ) : null}
          <form className="grid gap-4" onSubmit={saveDetails}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Title
                <Input value={form.title} onChange={(event) => updateForm('title', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Status
                <Input value={form.status} onChange={(event) => updateForm('status', event.target.value)} placeholder="blank until draft upload" />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Quantity
                <Input type="number" value={form.quantity} onChange={(event) => updateForm('quantity', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Listing Type
                <Input value={data.listing.listingType} readOnly />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Price (£)
                <Input type="number" min="0" step="0.01" value={form.priceAmount} onChange={(event) => updateForm('priceAmount', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Price Divisor
                <Input type="number" value="100" readOnly />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Currency
                <Input value={form.priceCurrencyCode} onChange={(event) => updateForm('priceCurrencyCode', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Taxonomy ID
                <Input type="number" value={form.taxonomyId} onChange={(event) => updateForm('taxonomyId', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Shop Section ID
                <Input type="number" value={form.shopSectionId} onChange={(event) => updateForm('shopSectionId', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Language
                <Input value={form.language} onChange={(event) => updateForm('language', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Who Made It
                <Input value={form.whoMade} onChange={(event) => updateForm('whoMade', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                When Made
                <Input value={form.whenMade} onChange={(event) => updateForm('whenMade', event.target.value)} />
              </label>
            </div>
            <label className="grid gap-2 text-sm font-medium">
              Description
              <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} className={textAreaClassName} />
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isSupply} onChange={(event) => updateForm('isSupply', event.target.checked)} />
                Is supply
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.shouldAutoRenew}
                  onChange={(event) => updateForm('shouldAutoRenew', event.target.checked)}
                />
                Auto renew
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isPersonalizable}
                  onChange={(event) => updateForm('isPersonalizable', event.target.checked)}
                />
                Personalizable
              </label>
            </div>
            <Button type="submit" disabled={saving || !detailsChanged}>
              {saving ? 'Saving...' : 'Save Details'}
            </Button>
          </form>
        </CardContent>
      </Card>
      ) : null}

      {showAdminEditSection ? (
      <>
      <div className="grid gap-4 xl:grid-cols-3">
        {renderSimpleCollection('tag', 'Tags', data.tags)}
        {renderSimpleCollection('material', 'Materials', data.materials)}
        {renderSimpleCollection('style', 'Styles', data.styles)}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {renderAssets('image', 'Images', data.images)}
        {renderAssets('file', 'Download Files', data.files)}
        {renderAssets('video', 'Videos', data.videos)}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Translations</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 md:grid-cols-[10rem_1fr_auto]">
            <Input value={translation.language} onChange={(event) => setTranslation({ ...translation, language: event.target.value })} />
            <Input value={translation.title} onChange={(event) => setTranslation({ ...translation, title: event.target.value })} placeholder="Title" />
            <Button type="button" onClick={() => addCollectionItem('translation', translation)} disabled={busyKey !== null}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </div>
          <textarea
            value={translation.description}
            onChange={(event) => setTranslation({ ...translation, description: event.target.value })}
            className={textAreaClassName}
            placeholder="Description"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Language</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.translations.length > 0 ? (
                data.translations.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.language}</TableCell>
                    <TableCell>{itemText(item.title)}</TableCell>
                    <TableCell>{itemText(item.description)}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="icon" onClick={() => deleteCollectionItem('translation', item.id)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    None set.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Inventory</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Input value={inventory.name} onChange={(event) => setInventory({ ...inventory, name: event.target.value })} placeholder="Name" />
            <Input value={inventory.value} onChange={(event) => setInventory({ ...inventory, value: event.target.value })} placeholder="Value" />
            <Input value={inventory.sku} onChange={(event) => setInventory({ ...inventory, sku: event.target.value })} placeholder="SKU" />
            <Input type="number" value={inventory.price} onChange={(event) => setInventory({ ...inventory, price: event.target.value })} placeholder="Price" />
            <Input
              type="number"
              value={inventory.quantity}
              onChange={(event) => setInventory({ ...inventory, quantity: event.target.value })}
              placeholder="Quantity"
            />
            <Button type="button" onClick={() => addCollectionItem('inventory', inventory)} disabled={busyKey !== null}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
            {data.inventory.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span>
                  {item.name}: {itemText(item.value)} {item.sku ? `(${item.sku})` : ''}
                </span>
                <Button type="button" variant="ghost" size="icon" onClick={() => deleteCollectionItem('inventory', item.id)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personalization</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <textarea
              value={personalization.instructions}
              onChange={(event) => setPersonalization({ ...personalization, instructions: event.target.value })}
              className={textAreaClassName}
              placeholder="Instructions"
            />
            <Input
              type="number"
              value={personalization.charCountMax}
              onChange={(event) => setPersonalization({ ...personalization, charCountMax: event.target.value })}
              placeholder="Max characters"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={personalization.isRequired}
                onChange={(event) => setPersonalization({ ...personalization, isRequired: event.target.checked })}
              />
              Required
            </label>
            <Button type="button" onClick={() => addCollectionItem('personalization', personalization)} disabled={busyKey !== null}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
            {data.personalization.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span>{item.instructions}</span>
                <Button type="button" variant="ghost" size="icon" onClick={() => deleteCollectionItem('personalization', item.id)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Buyer Price</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Input type="number" value={buyerPrice.amount} onChange={(event) => setBuyerPrice({ ...buyerPrice, amount: event.target.value })} placeholder="Amount" />
            <Input
              type="number"
              value={buyerPrice.divisor}
              onChange={(event) => setBuyerPrice({ ...buyerPrice, divisor: event.target.value })}
              placeholder="Divisor"
            />
            <Input
              value={buyerPrice.currencyCode}
              onChange={(event) => setBuyerPrice({ ...buyerPrice, currencyCode: event.target.value })}
              placeholder="Currency"
            />
            <Input value={buyerPrice.note} onChange={(event) => setBuyerPrice({ ...buyerPrice, note: event.target.value })} placeholder="Note" />
            <Button type="button" onClick={() => addCollectionItem('buyerPrice', buyerPrice)} disabled={busyKey !== null}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
            {data.buyerPrices.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span>
                  {item.currencyCode} {(item.amount / item.divisor).toFixed(2)} {item.note ? `- ${item.note}` : ''}
                </span>
                <Button type="button" variant="ghost" size="icon" onClick={() => deleteCollectionItem('buyerPrice', item.id)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      </>
      ) : null}
    </div>
  );
}
