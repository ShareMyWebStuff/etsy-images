'use client';

import { ChangeEvent, FormEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import { closestCenter, DndContext, DragEndEvent, DragOverlay, DragStartEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, CheckCircle2, Download, FileText, ImageIcon, Plus, Sparkles, Trash2, Upload, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CollectionKind, ListingEditorData, UploadKind } from '@/lib/listing-editor';
import { ETSY_PRIMARY_COLOURS } from '@/lib/etsy-colours';
import { getNextPrintSize } from '@/lib/print-sizes';
import { ETSY_MAX_DOWNLOAD_FILES, ETSY_MAX_FILE_SIZE_BYTES } from '@/lib/etsy-download-limits';
import { LISTING_EDITOR_MAX_IMAGES, LISTING_IMAGE_GUIDE } from '@/lib/listing-image-limits';
import { buildAspectRatiosImagePrompt, buildBedroomDoorImagePrompt, buildBedroomImagePrompt, buildBesideBedImagePrompt, buildCustomisedPlayroomImagePrompt, buildCustomisedShelveImagePrompt, buildDigitalDownloadIncludedImagePrompt, buildFramesImagePrompt, buildHowToPrintIncludedImagePrompt, buildListingImagePrompt, buildNoFrameIncludedImagePrompt, buildPerfectGiftImagePrompt, buildPersonalUseIncludedImagePrompt, buildPlayroomImagePrompt, buildSizesImagePrompt, buildThreeFramesImagePrompt } from '@/lib/listing-prompts';
import { buildDigitalDownloadGeneratePrompt } from '@/lib/digital-download-generate-prompt';
import { buildDetailsGeneratePrompt } from '@/lib/details-generate-prompt';
import { buildDownloadDetailsPrompt, missingDownloadDetailsPromptFields } from '@/lib/download-details-prompt';
import { buildThumbnailGeneratePrompt, buildThumbnailIllustrationPrompt, buildThumbnailPrintMasterPrompt, missingThumbnailGeneratePromptFields, missingThumbnailIllustrationPromptFields } from '@/lib/thumbnail-generate-prompt';
import { loadBundledPersonalisationFont, prepareClipboardImage, type PreparedClipboardImage } from '@/lib/browser-personalisation';
import { buildCameronsImagePrompt, buildGuysImagePrompt, buildIslasImagePrompt, buildVickiesImagePrompt, PERSONALISATION_SOURCE_HEIGHT_PX, PERSONALISATION_SOURCE_WIDTH_PX, prepareImagePersonalisationPrompt, type PersonalisationPromptMode } from '@/lib/image-personalisation-prompt';
import { DEFAULT_PERSONALISATION_FONT_ID, getPersonalisationFont, PERSONALISATION_FONTS } from '@/lib/personalisation-fonts';

type ListingEditorClientProps = {
  initialData: ListingEditorData | null;
  showAdminEditSection?: boolean;
  initialTab?: 'thumbnail' | 'etsy-products' | 'images' | 'details' | 'tags' | 'downloads' | 'dropbox' | 'todo';
};

type WorkflowTab = NonNullable<ListingEditorClientProps['initialTab']>;

type EtsyProductsForm = {
  listOnEtsy: boolean;
  digitalDownload: boolean;
  printsFrames: boolean;
  customTop: boolean;
  customBottom: boolean;
  customiseDigitalDownloads: boolean;
  customisePrints: boolean;
  downloadSectionId: number | null;
  returnPolicyId: string;
  sizes: Record<string, boolean>;
  frames: Record<string, boolean>;
};

type EtsyReturnPolicy = {
  id: string;
  label: string;
  acceptsReturns: boolean;
  acceptsExchanges: boolean;
};

type EtsyDownloadSection = { id: number; title: string };

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
    digitalTitle: listing?.digitalTitle ?? '',
    digitalDescription: listing?.digitalDescription ?? '',
    digitalQuantity: listing?.digitalQuantity?.toString() ?? '',
    status: listing?.status ?? '',
    quantity: listing?.quantity?.toString() ?? '',
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
    etsySku: listing?.etsySku ?? '',
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

function createEtsyProductsForm(data: ListingEditorData | null | undefined): EtsyProductsForm {
  return {
    listOnEtsy: data?.etsyProducts.config.listOnEtsy ?? true,
    digitalDownload: data?.etsyProducts.config.digitalDownload ?? false,
    printsFrames: data?.etsyProducts.config.printsFrames ?? true,
    customTop: data?.etsyProducts.config.customTop ?? true,
    customBottom: data?.etsyProducts.config.customBottom ?? true,
    customiseDigitalDownloads: data?.etsyProducts.config.customiseDigitalDownloads ?? false,
    customisePrints: data?.etsyProducts.config.customisePrints ?? true,
    downloadSectionId: data?.etsyProducts.config.downloadSectionId ?? null,
    returnPolicyId: data?.etsyProducts.config.returnPolicyId ?? '',
    sizes: Object.fromEntries(data?.etsyProducts.sizes.map((size) => [size.key, size.enabled]) ?? []),
    frames: Object.fromEntries(data?.etsyProducts.frames.map((frame) => [frame.key, frame.enabled]) ?? []),
  };
}

function formatProductPrice(amountPence: number, currencyCode: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currencyCode || 'GBP',
  }).format(amountPence / 100);
}

export function ListingEditorClient({ initialData, showAdminEditSection = false, initialTab = 'thumbnail' }: ListingEditorClientProps) {
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<WorkflowTab>(initialTab);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [deleteThumbnailOpen, setDeleteThumbnailOpen] = useState(false);
  const [deleteAllDownloadsOpen, setDeleteAllDownloadsOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [selectedPromptRow, setSelectedPromptRow] = useState<string | null>(null);
  const [promptClipboardStatus, setPromptClipboardStatus] = useState<string | null>(null);
  const [promptCopying, setPromptCopying] = useState<'text' | 'image' | null>(null);
  const [preparedPersonalisationPrompt, setPreparedPersonalisationPrompt] = useState<string | null>(null);
  const [personalisationPromptSettings, setPersonalisationPromptSettings] = useState(() => ({
    headerText: initialData?.listing.personalisationHeaderText ?? "Rory's",
    footerText: initialData?.listing.personalisationFooterText ?? 'Bedroom',
    fontId: initialData?.listing.personalisationFontId ?? DEFAULT_PERSONALISATION_FONT_ID,
  }));
  const personalisationPreparationId = useRef(0);
  const personalisationSourceImage = useRef<PreparedClipboardImage | null>(null);
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
  const [etsyProductsForm, setEtsyProductsForm] = useState<EtsyProductsForm>(() => createEtsyProductsForm(initialData));
  const [returnPolicies, setReturnPolicies] = useState<EtsyReturnPolicy[]>([]);
  const [returnPoliciesLoading, setReturnPoliciesLoading] = useState(false);
  const [returnPoliciesError, setReturnPoliciesError] = useState<string | null>(null);
  const [downloadSections, setDownloadSections] = useState<EtsyDownloadSection[]>([]);
  const [downloadSectionsLoading, setDownloadSectionsLoading] = useState(false);
  const [downloadSectionsError, setDownloadSectionsError] = useState<string | null>(null);
  const [createDownloadSectionOpen, setCreateDownloadSectionOpen] = useState(false);
  const [newDownloadSectionName, setNewDownloadSectionName] = useState('');
  const [createDownloadSectionError, setCreateDownloadSectionError] = useState<string | null>(null);
  const [listingDescription, setListingDescription] = useState(initialData?.listing.listingDescription ?? '');
  const [listingItem, setListingItem] = useState(initialData?.listing.listingItem ?? '');
  const [roomTheme, setRoomTheme] = useState(initialData?.listing.roomTheme ?? '');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [form, setForm] = useState(() => createDetailsForm(initialData?.listing));
  const [activeDetailsVariant, setActiveDetailsVariant] = useState<'print' | 'digital'>(
    initialData?.listing.listingType === 'digital' ? 'digital' : 'print'
  );

  useEffect(() => {
    const shopId = data?.context.shopId;
    if (!shopId || data?.listing.listingType === 'digital') return;
    const controller = new AbortController();
    setReturnPoliciesLoading(true);
    setReturnPoliciesError(null);
    fetch(`/api/shops/listings/editor/return-policies?shopId=${encodeURIComponent(shopId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as { policies?: EtsyReturnPolicy[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Unable to load Etsy return policies.');
        const policies = payload.policies ?? [];
        setReturnPolicies(policies);
        const noReturnsPolicies = policies.filter((policy) => !policy.acceptsReturns && !policy.acceptsExchanges);
        const defaultPolicy = noReturnsPolicies.length === 1
          ? noReturnsPolicies[0]
          : policies.length === 1
            ? policies[0]
            : null;
        if (defaultPolicy) {
          setEtsyProductsForm((current) => current.returnPolicyId
            ? current
            : { ...current, returnPolicyId: defaultPolicy.id });
        }
      })
      .catch((caughtError) => {
        if (caughtError instanceof DOMException && caughtError.name === 'AbortError') return;
        setReturnPoliciesError(caughtError instanceof Error ? caughtError.message : 'Unable to load Etsy return policies.');
      })
      .finally(() => { if (!controller.signal.aborted) setReturnPoliciesLoading(false); });
    return () => controller.abort();
  }, [data?.context.shopId, data?.listing.listingType]);

  useEffect(() => {
    const shopId = data?.context.shopId;
    if (!shopId || activeTab !== 'etsy-products') return;
    const controller = new AbortController();
    setDownloadSectionsLoading(true);
    setDownloadSectionsError(null);
    fetch(`/api/shops/listings/editor/download-sections?shopId=${encodeURIComponent(shopId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { sections?: EtsyDownloadSection[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Unable to load Etsy download sections.');
        setDownloadSections(payload.sections ?? []);
      })
      .catch((caughtError) => {
        if (caughtError instanceof DOMException && caughtError.name === 'AbortError') return;
        setDownloadSectionsError(caughtError instanceof Error ? caughtError.message : 'Unable to load Etsy download sections.');
      })
      .finally(() => { if (!controller.signal.aborted) setDownloadSectionsLoading(false); });
    return () => controller.abort();
  }, [data?.context.shopId, activeTab]);

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
  const usesDropboxPdfDownload = data.listing.includeAllItems
    || data.listing.numberOfItems === 3
    || data.listing.numberOfItems === 6
    || data.listing.numberOfItems === 12;
  const detailsChanged = JSON.stringify(form) !== JSON.stringify(createDetailsForm(data.listing));
  const desiredTags = uniqueTags([...tagDraft, ...parseTags(simpleInputs.tag)]);
  const tagsChanged = !haveSameTags(desiredTags, data.tags.map((tag) => tag.value));
  const etsyProductsChanged = JSON.stringify(etsyProductsForm) !== JSON.stringify(createEtsyProductsForm(data));
  const listingDescriptionChanged = listingDescription.trim() !== data.listing.listingDescription;
  const listingItemChanged = listingItem.trim() !== data.listing.listingItem;
  const roomThemeChanged = roomTheme.trim() !== data.listing.roomTheme;
  const savedPersonalisationPromptSettings = {
    headerText: data.listing.personalisationHeaderText,
    footerText: data.listing.personalisationFooterText,
    fontId: data.listing.personalisationFontId,
  };
  const personalisationPromptSettingsChanged = JSON.stringify(personalisationPromptSettings)
    !== JSON.stringify(savedPersonalisationPromptSettings);
  const selectedPersonalisationFont = getPersonalisationFont(personalisationPromptSettings.fontId)
    ?? getPersonalisationFont(DEFAULT_PERSONALISATION_FONT_ID)!;
  const thumbnailGeneratePromptInput = {
    numberOfAnimals: data.listing.numberOfItems,
    animals: data.listing.listingDescription,
    collectionTheme: data.listing.roomTheme,
    sectionName: data.section.sectionName,
  };
  const missingThumbnailPromptFields = missingThumbnailGeneratePromptFields(thumbnailGeneratePromptInput);
  const thumbnailIllustrationPromptInput = {
    animal: data.listing.listingItem,
    listingDescription: data.listing.listingDescription,
    collectionTheme: data.listing.roomTheme,
    sectionName: data.section.sectionName,
  };
  const missingThumbnailIllustrationFields = missingThumbnailIllustrationPromptFields(thumbnailIllustrationPromptInput);
  const downloadDetailsFrameColours = data.etsyProducts.frames
    .filter((frame) => frame.key !== 'no_frame' && etsyProductsForm.frames[frame.key])
    .map((frame) => frame.key === 'oak' ? 'Natural Oak' : frame.label);
  const downloadDetailsImage = data.files.find((file) => file.widthPixels && file.heightPixels);
  const downloadDetailsPromptValues = {
    animalName: data.listing.listingItem,
    animalDescription: data.listing.listingDescription,
    roomTheme: data.listing.roomTheme,
    frameColour: downloadDetailsFrameColours.includes('Natural Oak')
      ? 'Natural Oak'
      : downloadDetailsFrameColours[0] ?? 'Natural Oak',
    orientation: (downloadDetailsImage?.widthPixels ?? 0) > (downloadDetailsImage?.heightPixels ?? 0)
      ? 'landscape'
      : 'portrait',
    fileType: 'jpeg',
    frameColours: downloadDetailsFrameColours.join(', ') || 'Natural Oak',
    filesIncluded: data.files.map((file) => file.originalFileName ?? file.fileName).join(', '),
    recommendedPaper: data.materials.map((material) => material.value).join(', ')
      || 'Heavyweight matte photo paper, approximately 200–250 gsm',
    licenceType: 'Personal use only',
  };
  const missingDownloadDetailsFields = missingDownloadDetailsPromptFields(downloadDetailsPromptValues);

  function getImageUrl(assetId: string) {
    return `/api/shops/listings/editor/assets?${new URLSearchParams({ ...context, kind: 'image', assetId })}`;
  }

  function getThumbnailUrl() {
    return `/api/shops/listings/editor/assets?${new URLSearchParams({ ...context, kind: 'thumbnail', assetId: 'thumbnail' })}`;
  }

  function promptRowProps(rowId: string) {
    return {
      className: selectedPromptRow === rowId
        ? 'cursor-pointer bg-green-50 hover:bg-green-100'
        : 'cursor-pointer',
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if (event.target instanceof Element && event.target.closest('button')) return;
        setSelectedPromptRow((current) => current === rowId ? null : rowId);
      },
    };
  }

  function updatePersonalisationPromptSetting(key: 'headerText' | 'footerText' | 'fontId', value: string) {
    personalisationPreparationId.current += 1;
    setPreparedPersonalisationPrompt(null);
    setPersonalisationPromptSettings((current) => ({ ...current, [key]: value }));
  }

  function getDetailsGeneratePrompt() {
    if (!data) return '';
    const personalisationAreas = [
      etsyProductsForm.customTop ? 'top' : null,
      etsyProductsForm.customBottom ? 'bottom' : null,
    ].filter((area): area is string => area !== null);
    const personalisationDetails = personalisationAreas.length > 0
      ? `Optional ${personalisationAreas.join(' and ')} text personalisation is available.`
      : '';

    return buildDetailsGeneratePrompt({
      sectionName: data.section.sectionName,
      listingName: data.listing.localDirectoryName ?? data.listing.title,
      animal: data.listing.listingItem,
      roomTheme: data.listing.roomTheme,
      digitalDownload: etsyProductsForm.digitalDownload,
      paperDetails: data.materials.map((material) => material.value).join(', '),
      printSizes: data.etsyProducts.sizes
        .filter((size) => etsyProductsForm.sizes[size.key])
        .map((size) => size.label)
        .join(', '),
      frameColours: data.etsyProducts.frames
        .filter((frame) => etsyProductsForm.frames[frame.key])
        .map((frame) => frame.label)
        .join(', '),
      personalisationDetails,
      digitalFilesIncluded: data.files
        .map((file) => file.originalFileName ?? file.fileName)
        .join(', '),
    });
  }

  async function copyPromptText(text: string, copiedLabel = 'Prompt text') {
    setPromptCopying('text');
    setPromptClipboardStatus(null);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard access is not available in this browser.');
      await navigator.clipboard.writeText(text);
      setPromptClipboardStatus(`${copiedLabel} copied to the clipboard.`);
    } catch (caughtError) {
      setPromptClipboardStatus(caughtError instanceof Error ? caughtError.message : 'Unable to copy the prompt text.');
    } finally {
      setPromptCopying(null);
    }
  }

  async function getPersonalisationSourceImage() {
    if (personalisationSourceImage.current) return personalisationSourceImage.current;
    const response = await fetch(getThumbnailUrl(), { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load the original listing artwork.');
    const preparedImage = await prepareClipboardImage(await response.blob());
    personalisationSourceImage.current = preparedImage;
    return preparedImage;
  }

  async function copyPersonalisationPrompt(mode: PersonalisationPromptMode, label: string) {
    const preparationId = personalisationPreparationId.current + 1;
    personalisationPreparationId.current = preparationId;
    setPreparedPersonalisationPrompt(null);
    setPromptClipboardStatus(null);
    setPromptCopying('text');
    try {
      const prepared = await prepareImagePersonalisationPrompt({
        mode,
        headerText: personalisationPromptSettings.headerText,
        footerText: personalisationPromptSettings.footerText,
        font: selectedPersonalisationFont,
        sourceWidth: PERSONALISATION_SOURCE_WIDTH_PX,
        sourceHeight: PERSONALISATION_SOURCE_HEIGHT_PX,
        loadFont: loadBundledPersonalisationFont,
      });
      if (preparationId !== personalisationPreparationId.current) return;
      setPreparedPersonalisationPrompt(prepared.prompt);
      try {
        if (!navigator.clipboard) throw new Error('Clipboard access is not available in this browser.');
        await navigator.clipboard.writeText(prepared.prompt);
        setPromptClipboardStatus(`${label} copied to the clipboard for ${prepared.sourceWidth} × ${prepared.sourceHeight}px artwork. The prompt calculates the shared font size after curved-line placement.`);
      } catch {
        setPromptClipboardStatus(`${label} is prepared. Click “Copy prepared prompt” to copy it.`);
      }
    } catch (caughtError) {
      if (preparationId === personalisationPreparationId.current) {
        setPromptClipboardStatus(caughtError instanceof Error ? caughtError.message : `Unable to prepare ${label}.`);
      }
    } finally {
      setPromptCopying(null);
    }
  }

  async function copyPersonalisationSourceImage() {
    setPromptCopying('image');
    setPromptClipboardStatus(null);
    try {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        throw new Error('Image clipboard access is not available in this browser.');
      }
      const sourceImage = await getPersonalisationSourceImage();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': sourceImage.blob })]);
      setPromptClipboardStatus(`Original listing artwork copied at ${sourceImage.width} × ${sourceImage.height}px. Attach the selected font separately.`);
    } catch (caughtError) {
      setPromptClipboardStatus(caughtError instanceof Error ? caughtError.message : 'Unable to copy the original listing artwork.');
    } finally {
      setPromptCopying(null);
    }
  }

  async function copyPromptThumbnail() {
    setPromptCopying('image');
    setPromptClipboardStatus(null);
    try {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        throw new Error('Image clipboard access is not available in this browser.');
      }
      const response = await fetch(getThumbnailUrl());
      if (!response.ok) throw new Error('Unable to load the thumbnail.');
      const thumbnail = await prepareClipboardImage(await response.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': thumbnail.blob })]);
      setPromptClipboardStatus('Thumbnail copied to the clipboard.');
    } catch (caughtError) {
      setPromptClipboardStatus(caughtError instanceof Error ? caughtError.message : 'Unable to copy the thumbnail.');
    } finally {
      setPromptCopying(null);
    }
  }

  async function savePersonalisationPromptSettings() {
    setBusyKey('save-personalisation-prompt-settings');
    setPromptClipboardStatus(null);
    try {
      const response = await fetch('/api/shops/listings/editor/personalisation-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, ...personalisationPromptSettings }),
      });
      const payload = (await response.json()) as EditorResponse;
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save personalisation settings.');
      applyFreshData(payload.data);
      setPromptClipboardStatus('Personalisation settings saved.');
    } catch (caughtError) {
      setPromptClipboardStatus(caughtError instanceof Error ? caughtError.message : 'Unable to save personalisation settings.');
    } finally {
      setBusyKey(null);
    }
  }

  function updateForm(key: keyof typeof form, value: string | boolean) {
    setForm((currentForm) => ({
      ...currentForm,
      [key]: value,
    }));
  }

  async function loadTextFile(field: 'title' | 'description' | 'digitalTitle' | 'digitalDescription', event: ChangeEvent<HTMLInputElement>) {
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
      updateForm(field, field === 'title' || field === 'digitalTitle' ? contents.trim() : contents);
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
    setListingDescription(nextData.listing.listingDescription);
    setListingItem(nextData.listing.listingItem);
    setRoomTheme(nextData.listing.roomTheme);
    setPersonalisationPromptSettings({
      headerText: nextData.listing.personalisationHeaderText,
      footerText: nextData.listing.personalisationFooterText,
      fontId: nextData.listing.personalisationFontId,
    });
    setPreparedPersonalisationPrompt(null);
    personalisationSourceImage.current = null;
    setEtsyProductsForm(createEtsyProductsForm(nextData));
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
          quantity: toNumberOrNull(form.quantity),
          digitalTitle: form.digitalTitle,
          digitalDescription: form.digitalDescription,
          digitalQuantity: toNumberOrNull(form.digitalQuantity),
          primaryColour: form.primaryColour,
          secondaryColour: form.secondaryColour,
          etsySku: form.etsySku,
          ...(showAdminEditSection ? {
            status: form.status,
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
          } : {}),
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

  async function saveListingDescription() {
    setError(null);
    setBusyKey('listing-description');
    try {
      const response = await fetch('/api/shops/listings/editor/listing-description', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, listingDescription }),
      });
      await parseResponse(response, 'Unable to save the listing description.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save the listing description.');
    } finally {
      setBusyKey(null);
    }
  }

  async function saveRoomTheme() {
    setError(null);
    setBusyKey('room-theme');
    try {
      const response = await fetch('/api/shops/listings/editor/room-theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, roomTheme }),
      });
      await parseResponse(response, 'Unable to save the room theme.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save the room theme.');
    } finally {
      setBusyKey(null);
    }
  }

  async function saveListingItem() {
    setError(null);
    setBusyKey('listing-item');
    try {
      const response = await fetch('/api/shops/listings/editor/listing-item', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, listingItem }),
      });
      await parseResponse(response, 'Unable to save the listing item.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save the listing item.');
    } finally {
      setBusyKey(null);
    }
  }

  async function saveEtsyProducts() {
    setError(null);
    setBusyKey('save-etsy-products');

    try {
      const response = await fetch('/api/shops/listings/editor/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...context,
          ...etsyProductsForm,
        }),
      });
      await parseResponse(response, 'Unable to save Etsy products.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save Etsy products.');
    } finally {
      setBusyKey(null);
    }
  }

  async function createDownloadSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newDownloadSectionName.trim()) {
      setCreateDownloadSectionError('Enter a section name.');
      return;
    }
    setCreateDownloadSectionError(null);
    setBusyKey('create-download-section');
    try {
      const response = await fetch('/api/shops/listings/editor/download-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: context.shopId, title: newDownloadSectionName.trim() }),
      });
      const payload = await response.json() as { section?: EtsyDownloadSection; error?: string };
      if (!response.ok || !payload.section) throw new Error(payload.error ?? 'Unable to create Etsy download section.');
      const section = payload.section;
      setDownloadSections((current) => [...current.filter((item) => item.id !== section.id), section]
        .sort((first, second) => first.title.localeCompare(second.title)));
      setEtsyProductsForm((current) => ({ ...current, downloadSectionId: section.id }));
      setNewDownloadSectionName('');
      setCreateDownloadSectionOpen(false);
    } catch (caughtError) {
      setCreateDownloadSectionError(caughtError instanceof Error ? caughtError.message : 'Unable to create Etsy download section.');
    } finally {
      setBusyKey(null);
    }
  }

  async function runDropboxAction() {
    if (!data?.dropbox.action) return;
    setError(null);
    setBusyKey('dropbox');

    try {
      const response = await fetch('/api/shops/listings/dropbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, action: 'dropbox' }),
      });
      await parseResponse(response, 'Unable to update Dropbox.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to update Dropbox.');
    } finally {
      setBusyKey(null);
    }
  }

  async function createGroupedZipFiles() {
    setError(null);
    setBusyKey('create-grouped-zips');

    try {
      const response = await fetch('/api/shops/listings/dropbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, action: 'zip' }),
      });
      await parseResponse(response, 'Unable to create the grouped ZIP files.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create the grouped ZIP files.');
    } finally {
      setBusyKey(null);
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

  async function deleteAllTags() {
    if (!data) return;

    setError(null);
    setBusyKey('delete-all-tags');

    try {
      const response = await fetch('/api/shops/listings/editor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, tags: [] }),
      });
      const payload = (await response.json()) as EditorResponse;
      if (!response.ok) throw new Error(payload.error ?? 'Unable to delete all tags.');

      applyFreshData(payload.data);
      setTagDraft([]);
      setSimpleInputs((inputs) => ({ ...inputs, tag: '' }));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to delete all tags.');
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadFiles(kind: UploadKind, files: File[]) {
    if (files.length === 0) return;

    if (kind === 'image' && data!.images.length + files.length > LISTING_EDITOR_MAX_IMAGES) {
      const remainingImages = LISTING_EDITOR_MAX_IMAGES - data!.images.length;
      setError(`You can upload ${remainingImages} more image${remainingImages === 1 ? '' : 's'}.`);
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
      const remaining = LISTING_EDITOR_MAX_IMAGES - items.length;

      return (
        <div className="grid gap-6">
          <div>
            <h3 className="text-lg font-semibold">Photo and video</h3>
            <p className="text-sm text-muted-foreground">Show off different angles, available options, or details of your listing.</p>
            <div className="mt-3 grid w-fit grid-cols-[max-content_max-content_max-content] gap-x-6 text-sm">
              <ol className="list-inside list-decimal">
                {LISTING_IMAGE_GUIDE.slice(0, 7).map((item) => <li key={item}>{item}</li>)}
              </ol>
              <ol start={8} className="list-inside list-decimal">
                {LISTING_IMAGE_GUIDE.slice(7, 11).map((item) => <li key={item}>{item}</li>)}
              </ol>
              <ol start={12} className="list-inside list-decimal">
                {LISTING_IMAGE_GUIDE.slice(11).map((item) => <li key={item}>{item}</li>)}
              </ol>
            </div>
          </div>
          <div>
            <p className="mb-4 font-semibold">Add up to {LISTING_EDITOR_MAX_IMAGES} photos.</p>
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
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">The source animals are stored in separate grouped ZIP files for Dropbox.</p>
            </div>
            {data?.dropbox.canCreateZips ? (
              <Button type="button" onClick={createGroupedZipFiles} disabled={busyKey !== null}>
                {busyKey === 'create-grouped-zips'
                  ? 'Creating ZIPs...'
                  : data.dropbox.zipsCurrent ? 'Re-zip files' : 'Zip files'}
              </Button>
            ) : null}
          </div>
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
    if (!data) return null;
    return (
      <div className="grid gap-6">
        <section className="grid gap-2">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Listing Item</h3>
              <p className="text-sm text-muted-foreground">
                {data.listing.listingItemInherited
                  ? 'Using the first 100 characters of the listing name.'
                  : 'A custom listing item is set for this listing.'}
              </p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{listingItem.length} / 100</span>
          </div>
          <Input
            value={listingItem}
            maxLength={100}
            onChange={(event) => setListingItem(event.target.value)}
            placeholder="Enter the listing item"
            disabled={busyKey === 'listing-item'}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setListingItem(data.listing.listingItem)}
              disabled={busyKey !== null || !listingItemChanged}
            >
              Undo
            </Button>
            <Button type="button" onClick={saveListingItem} disabled={busyKey !== null || !listingItemChanged}>
              {busyKey === 'listing-item' ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </section>
        <div className="border-t" />
        <section className="grid gap-2">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Room Theme</h3>
              <p className="text-sm text-muted-foreground">
                {data.listing.roomThemeInherited
                  ? `Using the section default: ${data.section.roomTheme}`
                  : 'Override the section room theme for this listing.'}
              </p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{roomTheme.length} / 200</span>
          </div>
          <textarea
            value={roomTheme}
            maxLength={200}
            onChange={(event) => setRoomTheme(event.target.value)}
            className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Enter the room theme"
            disabled={busyKey === 'room-theme'}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRoomTheme(data.listing.roomTheme)}
              disabled={busyKey !== null || !roomThemeChanged}
            >
              Undo
            </Button>
            <Button type="button" onClick={saveRoomTheme} disabled={busyKey !== null || !roomThemeChanged}>
              {busyKey === 'room-theme' ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </section>
        <div className="border-t" />
        <section className="grid gap-2">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Listing description</h3>
              <p className="text-sm text-muted-foreground">Describe this listing in up to 1,000 characters.</p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{listingDescription.length} / 1000</span>
          </div>
          <textarea
            value={listingDescription}
            maxLength={1000}
            onChange={(event) => setListingDescription(event.target.value)}
            className={textAreaClassName}
            placeholder="Enter the listing description"
            disabled={busyKey === 'listing-description'}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setListingDescription(data.listing.listingDescription)}
              disabled={busyKey !== null || !listingDescriptionChanged}
            >
              Undo
            </Button>
            <Button
              type="button"
              onClick={saveListingDescription}
              disabled={busyKey !== null || !listingDescriptionChanged}
            >
              {busyKey === 'listing-description' ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </section>
        <div className="border-t" />
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

  function renderEtsyProducts() {
    if (!data) return null;
    const checkbox = (
      checked: boolean,
      label: string,
      onChange: (checked: boolean) => void
    ) => (
      <label key={label} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/60">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={busyKey !== null}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        <span>{label}</span>
      </label>
    );

    return (
      <div className="grid gap-6">
        <div>
          <h3 className="text-lg font-semibold">Etsy Products</h3>
          <p className="text-sm text-muted-foreground">Choose exactly what customers can buy from this listing.</p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          {checkbox(etsyProductsForm.listOnEtsy, 'List this listing on Etsy', (checked) =>
            setEtsyProductsForm((current) => ({ ...current, listOnEtsy: checked }))
          )}
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <section className="rounded-lg border p-4">
            <h4 className="mb-2 font-semibold">Downloads</h4>
            {checkbox(etsyProductsForm.digitalDownload, 'Digital Download', (checked) =>
              setEtsyProductsForm((current) => ({ ...current, digitalDownload: checked }))
            )}
            <div className="my-2 border-t" />
            <label htmlFor="download-section" className="block text-sm font-medium">Download Section</label>
            <div className="mt-2 flex gap-2">
              <select
                id="download-section"
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                value={etsyProductsForm.downloadSectionId ?? ''}
                onChange={(event) => setEtsyProductsForm((current) => ({
                  ...current,
                  downloadSectionId: event.target.value ? Number(event.target.value) : null,
                }))}
                disabled={busyKey !== null || downloadSectionsLoading}
              >
                <option value="">{downloadSectionsLoading ? 'Loading Etsy sections...' : 'Choose a section'}</option>
                {etsyProductsForm.downloadSectionId !== null
                  && !downloadSections.some((section) => section.id === etsyProductsForm.downloadSectionId)
                  ? <option value={etsyProductsForm.downloadSectionId}>Section #{etsyProductsForm.downloadSectionId} (not found)</option>
                  : null}
                {downloadSections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
              </select>
              <Button type="button" size="icon" variant="outline" onClick={() => setCreateDownloadSectionOpen(true)} disabled={busyKey !== null} aria-label="Create download section" title="Create download section">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {downloadSectionsError ? <p className="mt-2 text-xs text-destructive">{downloadSectionsError}</p> : null}
            {!downloadSectionsLoading && !downloadSectionsError && downloadSections.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No Download Sections yet. Use + to create one.</p>
            ) : null}
            {etsyProductsForm.downloadSectionId === null ? <p className="mt-2 text-xs text-amber-700">Required to complete this listing.</p> : null}
          </section>
          <section className="rounded-lg border p-4">
            <h4 className="mb-2 font-semibold">Prints / Frames</h4>
            {checkbox(etsyProductsForm.printsFrames, 'Prints / Frames', (checked) =>
              setEtsyProductsForm((current) => ({ ...current, printsFrames: checked }))
            )}
            <div className="my-2 border-t" />
            <h5 className="mb-2 text-sm font-semibold">Sizes</h5>
            {data.etsyProducts.sizes.map((size) => checkbox(
              etsyProductsForm.sizes[size.key] ?? false,
              size.label,
              (checked) => setEtsyProductsForm((current) => ({
                ...current,
                sizes: { ...current.sizes, [size.key]: checked },
              }))
            ))}
          </section>
          <section className="rounded-lg border p-4">
            <h4 className="mb-2 font-semibold">Frames</h4>
            {data.etsyProducts.frames.map((frame) => checkbox(
              etsyProductsForm.frames[frame.key] ?? false,
              frame.label,
              (checked) => setEtsyProductsForm((current) => ({
                ...current,
                frames: { ...current.frames, [frame.key]: checked },
              }))
            ))}
          </section>
          <section className="rounded-lg border p-4">
            <h4 className="mb-2 font-semibold">Customised</h4>
            <p className="mb-2 text-xs text-muted-foreground">
              Leave both unchecked for no customisation. Top and bottom are separate optional text boxes with no additional fee.
            </p>
            {checkbox(etsyProductsForm.customTop, 'Top of image', (checked) =>
              setEtsyProductsForm((current) => ({ ...current, customTop: checked }))
            )}
            {checkbox(etsyProductsForm.customBottom, 'Bottom of image', (checked) =>
              setEtsyProductsForm((current) => ({ ...current, customBottom: checked }))
            )}
            <div className="my-2 border-t" />
            {checkbox(etsyProductsForm.customiseDigitalDownloads, 'Customise digital downloads', (checked) =>
              setEtsyProductsForm((current) => ({ ...current, customiseDigitalDownloads: checked }))
            )}
            {checkbox(etsyProductsForm.customisePrints, 'Customise prints', (checked) =>
              setEtsyProductsForm((current) => ({ ...current, customisePrints: checked }))
            )}
          </section>
        </div>
        {data.listing.listingType !== 'digital' ? (
          <section className="rounded-lg border p-4">
            <h4 className="font-semibold">Physical delivery</h4>
            <p className="mt-1 text-xs text-muted-foreground">Choose the Etsy return policy applied when this physical listing is synced.</p>
            <label className="mt-3 grid gap-2 text-sm font-medium">
              Return policy
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={etsyProductsForm.returnPolicyId}
                onChange={(event) => setEtsyProductsForm((current) => ({ ...current, returnPolicyId: event.target.value }))}
                disabled={busyKey !== null || returnPoliciesLoading}
              >
                <option value="">{returnPoliciesLoading ? 'Loading Etsy policies...' : 'Choose a return policy'}</option>
                {returnPolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.label}</option>)}
              </select>
            </label>
            {returnPoliciesError ? <p className="mt-2 text-sm text-destructive">{returnPoliciesError}</p> : null}
            {!returnPoliciesLoading && !returnPoliciesError && returnPolicies.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">Create a return policy in Etsy Policy settings, then reload this page.</p>
            ) : null}
          </section>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setEtsyProductsForm(createEtsyProductsForm(data))}
            disabled={busyKey !== null || !etsyProductsChanged}
          >
            Undo
          </Button>
          <Button type="button" onClick={saveEtsyProducts} disabled={busyKey !== null || !etsyProductsChanged}>
            {busyKey === 'save-etsy-products' ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    );
  }

  function renderProductsTable() {
    if (!data) return null;
    return (
      <section className="mt-4 grid gap-3 border-t pt-6">
        <div>
          <h3 className="text-lg font-semibold">Products</h3>
          <p className="text-sm text-muted-foreground">
            Each size and frame option uses the listing SKU shown above.
          </p>
        </div>
        <div className="w-fit max-w-full overflow-x-auto rounded-md border">
          <Table className="w-auto table-auto">
            <TableHeader>
              <TableRow>
                <TableHead className="h-10 whitespace-nowrap px-3">Product</TableHead>
                <TableHead className="h-10 whitespace-nowrap px-3">Frame</TableHead>
                <TableHead className="h-10 whitespace-nowrap px-3 text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.etsyProducts.products.length > 0 ? data.etsyProducts.products.map((product) => (
                <TableRow key={product.key}>
                  <TableCell className="whitespace-nowrap px-3 py-2 font-medium">
                    {product.type === 'digital' ? 'Digital Download' : product.sizeLabel}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2">
                    {product.type === 'digital' ? '—' : product.frame === 'frame' ? 'Frame' : 'No Frame'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {formatProductPrice(product.priceAmountPence, product.currencyCode)}
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Select at least one size and frame option on the Etsy Products tab.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    );
  }

  function renderDropbox() {
    if (!data) return null;
    return (
      <div className="grid gap-5">
        <div>
          <h3 className="text-lg font-semibold">Dropbox</h3>
          <p className="text-sm text-muted-foreground">Create or refresh the Dropbox files for this listing.</p>
        </div>
        {data.dropbox.message ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{data.dropbox.message}</span>
          </div>
        ) : data.dropbox.current ? (
          <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>The Dropbox listing is up to date.</span>
          </div>
        ) : null}
        {data.dropbox.bundle?.sharedUrl ? (
          <a href={data.dropbox.bundle.sharedUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline underline-offset-4">
            Open Dropbox folder
          </a>
        ) : null}
        {data.dropbox.action ? (
          <div>
            <Button type="button" onClick={runDropboxAction} disabled={busyKey !== null}>
              {busyKey === 'dropbox'
                ? data.dropbox.action === 'create' ? 'Creating...' : 'Updating...'
                : data.dropbox.action === 'create' ? 'Create Dropbox' : 'Update Dropbox'}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderTodo() {
    if (!data) return null;
    if (data.todoItems.length === 0) {
      return (
        <div className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h3 className="font-semibold">This listing is complete</h3>
            <p>There are no outstanding items.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="grid gap-4">
        <div>
          <h3 className="text-lg font-semibold">Todo</h3>
          <p className="text-sm text-muted-foreground">Complete these {data.todoItems.length} items to make this listing complete.</p>
        </div>
        <ul className="divide-y rounded-md border">
          {data.todoItems.map((item) => (
            <li key={`${item.tab}-${item.label}`} className="flex items-center justify-between gap-4 p-4">
              <span className="flex items-center gap-3 text-sm font-medium">
                <XCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                {item.label}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => setActiveTab(item.tab)}>
                Open {item.tab === 'etsy-products' ? 'Etsy Products' : item.tab === 'downloads' ? 'Digital Downloads' : item.tab.charAt(0).toUpperCase() + item.tab.slice(1)}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  function downloadPromptThumbnail() {
    const thumbnail = data?.thumbnail;
    if (!thumbnail) {
      setPromptClipboardStatus('Upload a thumbnail before downloading the prompt image.');
      return;
    }

    const download = document.createElement('a');
    download.href = getThumbnailUrl();
    download.download = thumbnail.originalFileName?.trim() || thumbnail.fileName || 'thumbnail.png';
    document.body.appendChild(download);
    download.click();
    download.remove();
    setPromptClipboardStatus(`${download.download} is downloading to your browser’s Downloads folder.`);
  }

  function renderPromptThumbnailDownloadButton(promptLabel: string) {
    return (
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={downloadPromptThumbnail}
        aria-label={`Download thumbnail image for ${promptLabel}`}
        title="Download thumbnail image"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  function renderPersonalisationPromptRow(mode: PersonalisationPromptMode, label: string) {
    const rowId = `images-personalisation-${mode}`;
    return (
      <TableRow key={rowId} {...promptRowProps(rowId)}>
        <TableCell className="font-medium">Images</TableCell>
        <TableCell>{label}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => copyPersonalisationPrompt(mode, `${label} prompt`)}
              disabled={promptCopying !== null}
              aria-label={`Copy ${label} prompt`}
              title={`Copy ${label} prompt`}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={copyPersonalisationSourceImage}
              disabled={promptCopying !== null}
              aria-label={`Copy original listing artwork for ${label} prompt`}
              title="Copy original listing artwork"
            >
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            {renderPromptThumbnailDownloadButton(`${label} prompt`)}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className="grid gap-4">
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

      <Card>
        <CardHeader className="pb-0">
          <div className="mb-4 flex items-center justify-between gap-4">
            <CardTitle>{data.listing.localDirectoryName ?? data.listing.title}</CardTitle>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => {
                setPromptClipboardStatus(null);
                setPromptsOpen(true);
              }}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Prompts
            </Button>
          </div>
          {data.pendingChanges.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <span className="font-medium">Pending Etsy sync:</span>
              {data.pendingChanges.map((area) => (
                <span key={area} className="rounded-full bg-amber-100 px-2.5 py-1 font-medium">{area}</span>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Listing editor sections">
            {([
              ['thumbnail', 'Thumbnail'],
              ['etsy-products', 'Etsy Products'],
              ['images', 'Images'],
              ['details', 'Details'],
              ['tags', 'Tags'],
              ['downloads', 'Digital Downloads'],
              ['dropbox', 'Dropbox'],
              ['todo', 'Todo'],
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
                {label !== 'Todo' && data.pendingChanges.includes(label) ? (
                  <span className="ml-1 text-amber-600" aria-label="Changed">●</span>
                ) : null}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {activeTab === 'thumbnail' ? renderThumbnail() : null}
          {activeTab === 'etsy-products' ? renderEtsyProducts() : null}
          {activeTab === 'images' ? renderWorkflowAssetTable('image', 'Images', data.images) : null}
          {activeTab === 'downloads' ? renderWorkflowAssetTable('file', 'Digital Downloads', data.files) : null}
          {activeTab === 'dropbox' ? renderDropbox() : null}
          {activeTab === 'todo' ? renderTodo() : null}
          {activeTab === 'details' ? (
            <form className="grid gap-4" onSubmit={saveDetails}>
                <div role="tablist" aria-label="Etsy listing details" className="flex w-fit gap-1 rounded-md border p-1">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDetailsVariant === 'print'}
                    onClick={() => setActiveDetailsVariant('print')}
                    className={`rounded px-4 py-2 text-sm font-medium ${activeDetailsVariant === 'print' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                  >
                    Print
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDetailsVariant === 'digital'}
                    onClick={() => setActiveDetailsVariant('digital')}
                    className={`rounded px-4 py-2 text-sm font-medium ${activeDetailsVariant === 'digital' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                  >
                    Digital Download
                  </button>
                </div>
                <p className="text-sm text-muted-foreground">Enter a separate Etsy title, description and quantity for each listing type.</p>
                <div className="grid gap-2 text-sm font-medium">
                  <span>Title</span>
                  <span className="flex items-center gap-2">
                    <Input
                      maxLength={255}
                      value={activeDetailsVariant === 'print' ? form.title : form.digitalTitle}
                      onChange={(event) => updateForm(activeDetailsVariant === 'print' ? 'title' : 'digitalTitle', event.target.value)}
                    />
                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-input px-4 py-2 font-medium hover:bg-accent">
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      Load text
                      <input
                        type="file"
                        className="sr-only"
                        accept=".txt,text/plain"
                        onChange={(event) => loadTextFile(activeDetailsVariant === 'print' ? 'title' : 'digitalTitle', event)}
                      />
                    </label>
                  </span>
                </div>
                <div className="grid gap-2 text-sm font-medium">
                  <span>Etsy Description</span>
                  <span className="flex items-start gap-2">
                    <textarea
                      value={activeDetailsVariant === 'print' ? form.description : form.digitalDescription}
                      onChange={(event) => updateForm(activeDetailsVariant === 'print' ? 'description' : 'digitalDescription', event.target.value)}
                      className={textAreaClassName}
                    />
                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-input px-4 py-2 font-medium hover:bg-accent">
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      Load text
                      <input
                        type="file"
                        className="sr-only"
                        accept=".txt,text/plain"
                        onChange={(event) => loadTextFile(activeDetailsVariant === 'print' ? 'description' : 'digitalDescription', event)}
                      />
                    </label>
                  </span>
                </div>
                <label className="grid gap-2 text-sm font-medium">
                  Quantity
                  <Input
                    type="number"
                    min="0"
                    value={activeDetailsVariant === 'print' ? form.quantity : form.digitalQuantity}
                    onChange={(event) => updateForm(activeDetailsVariant === 'print' ? 'quantity' : 'digitalQuantity', event.target.value)}
                  />
                </label>
                <div className="border-t pt-4">
                  <label className="grid max-w-md gap-2 text-sm font-medium">
                    Etsy SKU
                    <Input
                      value={form.etsySku}
                      maxLength={32}
                      onChange={(event) => updateForm('etsySku', event.target.value)}
                      placeholder="Enter one SKU for this listing"
                    />
                    <span className="text-xs font-normal text-muted-foreground">The same SKU is sent for every size and frame variation when syncing to Etsy.</span>
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
                {renderProductsTable()}
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
                <Button
                  type="button"
                  variant="destructive"
                  onClick={deleteAllTags}
                  disabled={busyKey !== null || (data.tags.length === 0 && desiredTags.length === 0)}
                >
                  {busyKey === 'delete-all-tags' ? 'Deleting...' : 'Delete All'}
                </Button>
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

      <Dialog
        open={promptsOpen}
        onOpenChange={(open) => {
          setPromptsOpen(open);
          if (!open) {
            personalisationPreparationId.current += 1;
            setPreparedPersonalisationPrompt(null);
            setPromptClipboardStatus(null);
            setSelectedPromptRow(null);
          }
        }}
      >
        <DialogContent className={`max-h-[90vh] max-w-5xl content-start overflow-y-auto ${data.thumbnail ? 'min-h-[28rem]' : ''}`}>
          <DialogHeader>
            <DialogTitle>Prompts</DialogTitle>
            <DialogDescription>
              This is where we can put prompts and images into the clipboard for pasting into ChatGPT.
            </DialogDescription>
          </DialogHeader>
          {data.thumbnail ? (
          <section className="grid gap-3 rounded-md border bg-muted/20 p-4" aria-labelledby="personalisation-prompt-settings-heading">
            <div>
              <h3 id="personalisation-prompt-settings-heading" className="font-semibold">Image personalisation</h3>
              <p className="text-sm text-muted-foreground">Shared text and font settings for the Top text, Bottom text and Both text prompts.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Header text
                <Input
                  value={personalisationPromptSettings.headerText}
                  maxLength={200}
                  onChange={(event) => updatePersonalisationPromptSetting('headerText', event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Footer text
                <Input
                  value={personalisationPromptSettings.footerText}
                  maxLength={200}
                  onChange={(event) => updatePersonalisationPromptSetting('footerText', event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid min-w-64 flex-1 gap-1.5 text-sm font-medium">
                Font
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={personalisationPromptSettings.fontId}
                  onChange={(event) => updatePersonalisationPromptSetting('fontId', event.target.value)}
                >
                  {PERSONALISATION_FONTS.map((font) => (
                    <option key={font.id} value={font.id}>{font.displayName}</option>
                  ))}
                </select>
              </label>
              <Button type="button" variant="outline" asChild>
                <a href={selectedPersonalisationFont.assetPath} download={selectedPersonalisationFont.downloadFileName}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download selected font
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busyKey !== null || !personalisationPromptSettingsChanged}
                onClick={() => setPersonalisationPromptSettings(savedPersonalisationPromptSettings)}
              >
                Undo
              </Button>
              <Button
                type="button"
                disabled={busyKey !== null || !personalisationPromptSettingsChanged}
                onClick={savePersonalisationPromptSettings}
              >
                {busyKey === 'save-personalisation-prompt-settings' ? 'Saving...' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Attach the selected font file alongside your image in ChatGPT for accurate text rendering.</p>
            {preparedPersonalisationPrompt ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyPromptText(preparedPersonalisationPrompt, 'Prepared personalisation prompt')}
                  disabled={promptCopying !== null}
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  Copy prepared prompt
                </Button>
              </div>
            ) : null}
          </section>
          ) : null}
          {missingThumbnailPromptFields.length > 0 ? (
            <div
              className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">The Thumbnail / Generate image prompt cannot be copied.</p>
                <p>Complete the following required {missingThumbnailPromptFields.length === 1 ? 'field' : 'fields'}: {missingThumbnailPromptFields.join(', ')}.</p>
              </div>
            </div>
          ) : null}
          <div className="rounded-md border">
              {/* 2.5rem header plus twelve 2.75rem prompt rows. */}
              <Table
                containerClassName="max-h-[35.5rem]"
                className="min-w-[42rem] [&_tbody_tr]:h-11 [&_tbody_td]:whitespace-nowrap [&_tbody_td]:px-3 [&_tbody_td]:py-1 [&_tbody_button]:h-8 [&_tbody_button]:w-8"
              >
                <TableHeader className="sticky top-0 z-10 bg-card shadow-sm [&_th]:h-10">
                  <TableRow>
                    <TableHead>Tab</TableHead>
                    <TableHead>Prompt</TableHead>
                    <TableHead className="w-40">Clipboard</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow {...promptRowProps('thumbnail-generate-image')}>
                    <TableCell className="font-medium">Thumbnail</TableCell>
                    <TableCell>
                      Generate image
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span title={missingThumbnailPromptFields.length > 0 ? `Fill in ${missingThumbnailPromptFields.join(', ')} first` : 'Copy Generate image prompt'}>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={() => copyPromptText(buildThumbnailGeneratePrompt(thumbnailGeneratePromptInput), 'Thumbnail Generate image prompt')}
                            disabled={promptCopying !== null || missingThumbnailPromptFields.length > 0}
                            aria-label="Copy Thumbnail Generate image prompt"
                            title="Copy Generate image prompt"
                          >
                            <FileText className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </span>
                        <span title={missingThumbnailIllustrationFields.length > 0 ? `Fill in ${missingThumbnailIllustrationFields.join(', ')} first` : 'Copy Thumbnail prompt 1'}>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={() => copyPromptText(buildThumbnailIllustrationPrompt(thumbnailIllustrationPromptInput), 'Thumbnail prompt 1')}
                            disabled={promptCopying !== null || missingThumbnailIllustrationFields.length > 0}
                            aria-label="Copy Thumbnail prompt 1"
                            title="Copy Thumbnail prompt 1"
                            className="font-semibold"
                          >
                            1
                          </Button>
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(buildThumbnailPrintMasterPrompt(), 'Thumbnail prompt 2')}
                          disabled={promptCopying !== null}
                          aria-label="Copy Thumbnail prompt 2"
                          title="Copy Thumbnail prompt 2"
                          className="font-semibold"
                        >
                          2
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {data.thumbnail ? (
                    <>
                  <TableRow {...promptRowProps('images-listing-image')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Listing Image</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(buildListingImagePrompt(data.listing.roomTheme), 'Listing Image prompt')}
                          disabled={promptCopying !== null}
                          aria-label="Copy Listing Image prompt"
                          title="Copy Listing Image prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Listing Image prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Listing Image prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-bedroom')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Bedroom</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildBedroomImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Bedroom prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Bedroom prompt"
                          title="Copy Bedroom prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Bedroom prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Bedroom prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-playroom')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Playroom</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildPlayroomImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Playroom prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Playroom prompt"
                          title="Copy Playroom prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Playroom prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Playroom prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-perfect-gift')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Perfect Gift</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildPerfectGiftImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Perfect Gift prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Perfect Gift prompt"
                          title="Copy Perfect Gift prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Perfect Gift prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Perfect Gift prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-frames')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>4 Frames</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildFramesImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            '4 Frames prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy 4 Frames prompt"
                          title="Copy 4 Frames prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for 4 Frames prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('4 Frames prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-three-frames')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>3 Frames</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildThreeFramesImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            '3 Frames prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy 3 Frames prompt"
                          title="Copy 3 Frames prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for 3 Frames prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('3 Frames prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-sizes')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Sizes</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildSizesImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Sizes prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Sizes prompt"
                          title="Copy Sizes prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Sizes prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Sizes prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-aspect-ratios')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Aspect ratios</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => copyPromptText(buildAspectRatiosImagePrompt(), 'Aspect ratios prompt')}
                        disabled={promptCopying !== null}
                        aria-label="Copy Aspect ratios prompt"
                        title="Copy Aspect ratios prompt"
                      >
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-camerons-image')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Camerons image</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildCameronsImagePrompt(selectedPersonalisationFont),
                            'Camerons image prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Camerons image prompt"
                          title="Copy Camerons image prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Camerons image prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Camerons image prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-guys-image')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Guys image</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildGuysImagePrompt(selectedPersonalisationFont),
                            'Guys image prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Guys image prompt"
                          title="Copy Guys image prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Guys image prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Guys image prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-vickies-image')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Vickies image</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildVickiesImagePrompt(selectedPersonalisationFont),
                            'Vickies image prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Vickies image prompt"
                          title="Copy Vickies image prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Vickies image prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Vickies image prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-islas-image')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Islas image</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildIslasImagePrompt(selectedPersonalisationFont),
                            'Islas image prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Islas image prompt"
                          title="Copy Islas image prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Islas image prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Islas image prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-no-frame-included')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>No Frame Included</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildNoFrameIncludedImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'No Frame Included prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy No Frame Included prompt"
                          title="Copy No Frame Included prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for No Frame Included prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('No Frame Included prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-digital-download-included')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Digital Download Included</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildDigitalDownloadIncludedImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Digital Download Included prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Digital Download Included prompt"
                          title="Copy Digital Download Included prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Digital Download Included prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Digital Download Included prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-how-to-print-included')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>How to Print Included</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildHowToPrintIncludedImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'How to Print Included prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy How to Print Included prompt"
                          title="Copy How to Print Included prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for How to Print Included prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('How to Print Included prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-personal-use-included')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Personal Use Included</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildPersonalUseIncludedImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Personal Use Included prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Personal Use Included prompt"
                          title="Copy Personal Use Included prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Personal Use Included prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Personal Use Included prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  {renderPersonalisationPromptRow('top', 'Top text')}
                  {renderPersonalisationPromptRow('bottom', 'Bottom text')}
                  {renderPersonalisationPromptRow('both', 'Both text')}
                  <TableRow {...promptRowProps('images-bedroom-door')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Bedroom door</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildBedroomDoorImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Bedroom door prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Bedroom door prompt"
                          title="Copy Bedroom door prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Bedroom door prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Bedroom door prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-beside-bed')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Beside bed</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildBesideBedImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Beside bed prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Beside bed prompt"
                          title="Copy Beside bed prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Beside bed prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Beside bed prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-customised-playroom')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Customised playroom</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildCustomisedPlayroomImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Customised playroom prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Customised playroom prompt"
                          title="Copy Customised playroom prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Customised playroom prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Customised playroom prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('images-customised-shelve-image')}>
                    <TableCell className="font-medium">Images</TableCell>
                    <TableCell>Customised Shelve Image</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildCustomisedShelveImagePrompt(data.listing.roomTheme, data.listing.listingItem),
                            'Customised Shelve Image prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Customised Shelve Image prompt"
                          title="Copy Customised Shelve Image prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Customised Shelve Image prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Customised Shelve Image prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('details-generate')}>
                    <TableCell className="font-medium">Details</TableCell>
                    <TableCell>Print info</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(getDetailsGeneratePrompt(), 'Print info prompt')}
                          disabled={promptCopying !== null}
                          aria-label="Copy Print info prompt"
                          title="Copy Print info prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('details-download-info')}>
                    <TableCell className="font-medium">Details</TableCell>
                    <TableCell>
                      Download info
                      {missingDownloadDetailsFields.length > 0 ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Fill in {missingDownloadDetailsFields.join(', ')} first.
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(buildDownloadDetailsPrompt(downloadDetailsPromptValues), 'Download info prompt')}
                          disabled={promptCopying !== null || missingDownloadDetailsFields.length > 0}
                          aria-label="Copy Download info prompt"
                          title={missingDownloadDetailsFields.length > 0
                            ? `Fill in ${missingDownloadDetailsFields.join(', ')} first`
                            : 'Copy Download info prompt'}
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow {...promptRowProps('digital-downloads-generate')}>
                    <TableCell className="font-medium">Digital Downloads</TableCell>
                    <TableCell>Generate</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildDigitalDownloadGeneratePrompt(data.listing.listingItem),
                            'Digital Downloads Generate prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Digital Downloads Generate prompt"
                          title="Copy Digital Downloads Generate prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Digital Downloads Generate prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Digital Downloads Generate prompt')}
                      </div>
                    </TableCell>
                  </TableRow>
                    </>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          {promptClipboardStatus ? (
            <p className="text-sm text-muted-foreground" role="status">{promptClipboardStatus}</p>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={createDownloadSectionOpen} onOpenChange={(open) => {
        if (busyKey !== 'create-download-section') {
          setCreateDownloadSectionOpen(open);
          if (!open) setCreateDownloadSectionError(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Download Section</DialogTitle>
            <DialogDescription>Create a new section in your Etsy shop. It will be selected here; click Save to apply it to this listing.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createDownloadSection} className="grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              Section name
              <Input value={newDownloadSectionName} onChange={(event) => setNewDownloadSectionName(event.target.value)} disabled={busyKey === 'create-download-section'} autoFocus />
            </label>
            {createDownloadSectionError ? <p className="text-sm text-destructive" role="alert">{createDownloadSectionError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateDownloadSectionOpen(false)} disabled={busyKey === 'create-download-section'}>Cancel</Button>
              <Button type="submit" disabled={busyKey === 'create-download-section'}>{busyKey === 'create-download-section' ? 'Creating...' : 'Create'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
