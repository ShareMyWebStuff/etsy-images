'use client';

import { ListingTemplateProductSettings } from './ListingTemplateProductSettings';

import { ChangeEvent, FormEvent, MouseEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { closestCenter, DndContext, DragEndEvent, DragOverlay, DragStartEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, FileText, GripVertical, ImageIcon, PackageCheck, Plus, RefreshCw, RotateCcw, RotateCw, Sparkles, Trash2, Upload, X, XCircle } from 'lucide-react';
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
import { listingPrintCropDraftForSave, type ListingPrintCropDraft } from '@/lib/listing-print-crops';
import { analyseListingThumbnailDimensions, type ListingThumbnailRatio } from '@/lib/listing-thumbnail-ratio';
import { smallestPaperSizePerAspectRatio } from '@/lib/listing-paper-size-groups';
import { buildAspectRatiosImagePrompt, buildBedroomDoorImagePrompt, buildBedroomImagePrompt, buildBesideBedImagePrompt, buildCustomisedPlayroomImagePrompt, buildCustomisedShelveImagePrompt, buildDigitalDownloadIncludedImagePrompt, buildFramesImagePrompt, buildHowToPrintIncludedImagePrompt, buildListingImagePrompt, buildNoFrameIncludedImagePrompt, buildPerfectGiftImagePrompt, buildPersonalUseIncludedImagePrompt, buildPlayroomImagePrompt, buildSizesImagePrompt, buildThreeFramesImagePrompt } from '@/lib/listing-prompts';
import { buildDigitalDownloadGeneratePrompt } from '@/lib/digital-download-generate-prompt';
import { buildDigitalDownloadGenerateSixPrompt } from '@/lib/digital-download-generate-six-prompt';
import {
  buildCombinedListingDetailsPrompt,
  buildSetDetailsClipboardPrompt,
  missingCombinedListingDetailsPromptFields,
} from '@/lib/combined-listing-details-prompt';
import { buildThumbnailGeneratePrompt, buildThumbnailIllustrationPrompt, buildThumbnailPrintMasterPrompt, missingThumbnailGeneratePromptFields, missingThumbnailIllustrationPromptFields } from '@/lib/thumbnail-generate-prompt';
import { loadBundledPersonalisationFont, prepareClipboardImage, type PreparedClipboardImage } from '@/lib/browser-personalisation';
import { buildCameronsImagePrompt, buildGuysImagePrompt, buildIslasImagePrompt, buildVickiesImagePrompt, PERSONALISATION_SOURCE_HEIGHT_PX, PERSONALISATION_SOURCE_WIDTH_PX, prepareImagePersonalisationPrompt, type PersonalisationPromptMode } from '@/lib/image-personalisation-prompt';
import { DEFAULT_PERSONALISATION_FONT_ID, getPersonalisationFont, PERSONALISATION_FONTS } from '@/lib/personalisation-fonts';
import { getPrintableDownloadRole, getPrintableDownloadStatus, PRINTABLE_DOWNLOAD_SPECS, type PrintableDownloadRatio, type PrintableDownloadRole } from '@/lib/printable-download-specs';
import type { MockupRatio } from '@/lib/listing-mockup-tester';
import { ListingPersonalisationPreviewDialog } from './ListingPersonalisationPreviewDialog';
import { ListingMockupTesterDialog, type ListingMockupArtworkOption } from './ListingMockupTesterDialog';
import { ListingPrintCropDialog } from './ListingPrintCropDialog';
import { ListingTextAreasDialog } from './ListingTextAreasDialog';

type ListingEditorClientProps = {
  initialData: ListingEditorData | null;
  showAdminEditSection?: boolean;
  initialTab?: 'overview' | 'images' | 'details' | 'tags' | 'downloads' | 'dropbox' | 'todo';
};

type WorkflowTab = NonNullable<ListingEditorClientProps['initialTab']>;

type EditorResponse = {
  data?: ListingEditorData | null;
  error?: string;
};

type OverviewGenerationStageKey = 'images' | 'details' | 'downloads' | 'dropbox';
type OverviewGenerationStageStatus = 'pending' | 'running' | 'complete' | 'failed';
type OverviewGenerationStage = {
  key: OverviewGenerationStageKey;
  label: string;
  status: OverviewGenerationStageStatus;
  message: string;
};

const OVERVIEW_GENERATION_STAGES: Array<Pick<OverviewGenerationStage, 'key' | 'label'>> = [
  { key: 'images', label: 'Create Images' },
  { key: 'details', label: 'Create Details and Tags' },
  { key: 'downloads', label: 'Create Digital Downloads' },
  { key: 'dropbox', label: 'Dropbox' },
];

function initialOverviewGenerationStages(includeDropbox: boolean): OverviewGenerationStage[] {
  return OVERVIEW_GENERATION_STAGES
    .filter((stage) => includeDropbox || stage.key !== 'dropbox')
    .map((stage) => ({ ...stage, status: 'pending', message: 'Waiting' }));
}

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

function SortableGroupedListing({ id, name, position, imageUrl, disabled }: {
  id: string;
  name: string;
  position: number;
  imageUrl: string | null;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-md border bg-card p-3 ${isDragging ? 'opacity-40' : ''} ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{position}</span>
      {imageUrl ? <img src={imageUrl} alt="" className="h-16 w-16 shrink-0 rounded border object-cover" /> : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">No image</span>
      )}
      <span className="min-w-0 font-medium">{name}</span>
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

function soldDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value))
    : null;
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

function formatProductPrice(amountPence: number, currencyCode: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currencyCode || 'GBP',
  }).format(amountPence / 100);
}

function testerRatioFromDownloadRole(role: PrintableDownloadRole | null): MockupRatio | undefined {
  if (!role || role === 'guide') return undefined;
  if (role === 'iso-a1') return 'iso-a';
  return role;
}

export function ListingEditorClient({ initialData, showAdminEditSection = false, initialTab = 'overview' }: ListingEditorClientProps) {
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<WorkflowTab>(initialTab);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
    type?: 'image' | 'document';
    galleryImageId?: string;
  } | null>(null);
  const [deleteThumbnailOpen, setDeleteThumbnailOpen] = useState(false);
  const [textAreasOpen, setTextAreasOpen] = useState(false);
  const [printCropsOpen, setPrintCropsOpen] = useState(false);
  const [personalisationPreviewOpen, setPersonalisationPreviewOpen] = useState(false);
  const [mockupTesterOpen, setMockupTesterOpen] = useState(false);
  const [pendingThumbnail, setPendingThumbnail] = useState<{
    file: File;
    url: string;
    rotation: 0 | 90 | 180 | 270;
    ratio: ListingThumbnailRatio;
    width: number;
    height: number;
  } | null>(null);
  const [deleteAllDownloadsOpen, setDeleteAllDownloadsOpen] = useState(false);
  const [downloadToDelete, setDownloadToDelete] = useState<{ id: string; name: string } | null>(null);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [selectedPromptRow, setSelectedPromptRow] = useState<string | null>(null);
  const [promptClipboardStatus, setPromptClipboardStatus] = useState<string | null>(null);
  const [setDetailsImportOpen, setSetDetailsImportOpen] = useState(false);
  const [setDetailsImportOutput, setSetDetailsImportOutput] = useState('');
  const [setDetailsImportError, setSetDetailsImportError] = useState<string | null>(null);
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
  const [etsyResyncMessage, setEtsyResyncMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // React state does not update synchronously, so two quick clicks can enter
  // separate generation workflows before the buttons become disabled.
  const overviewActionRunning = useRef(false);
  const [overviewGenerationStages, setOverviewGenerationStages] = useState<OverviewGenerationStage[] | null>(null);
  const [overviewGenerationItem, setOverviewGenerationItem] = useState<string | null>(null);
  const [overviewGenerationError, setOverviewGenerationError] = useState<{ stage: string; message: string } | null>(null);
  const [simpleInputs, setSimpleInputs] = useState({ tag: '', material: '', style: '' });
  const [tagDraft, setTagDraft] = useState<string[]>(() => initialData?.tags.map((tag) => tag.value) ?? []);
  const [zipAssignments, setZipAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialData?.files.map((file) => [file.id, file.zipNumber?.toString() ?? '']) ?? [])
  );
  const [translation, setTranslation] = useState({ language: 'en-US', title: '', description: '' });
  const [inventory, setInventory] = useState({ name: '', value: '', sku: '', price: '', quantity: '' });
  const [personalization, setPersonalization] = useState({ instructions: '', isRequired: false, charCountMax: '' });
  const [buyerPrice, setBuyerPrice] = useState({ amount: '', divisor: '100', currencyCode: 'GBP', note: '' });
  const [listingDescription, setListingDescription] = useState(initialData?.listing.listingDescription ?? '');
  const [listingOrientation, setListingOrientation] = useState<'portrait' | 'landscape'>(initialData?.listing.artworkOrientation ?? 'portrait');
  const [listingItem, setListingItem] = useState(initialData?.listing.listingItem ?? '');
  const [groupSelection, setGroupSelection] = useState<string[]>(() => initialData?.groupItems.map((item) => item.id) ?? []);
  const [roomTheme, setRoomTheme] = useState(initialData?.listing.roomTheme ?? '');
  const [backgroundColour, setBackgroundColour] = useState<string>(initialData?.listing.backgroundColour ?? '#F5F0E8');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [form, setForm] = useState(() => createDetailsForm(initialData?.listing));
  const [activeDetailsVariant, setActiveDetailsVariant] = useState<'print' | 'digital'>(
    initialData?.listing.listingType === 'digital' ? 'digital' : 'print'
  );

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
  const previewGalleryIndex = previewImage?.galleryImageId
    ? data.images.findIndex((image) => image.id === previewImage.galleryImageId)
    : -1;
  const personalisationPreviewSizes = smallestPaperSizePerAspectRatio(
    data.etsyProducts.sizes
      .filter((size) => size.enabled)
      .map(({ key, label }) => ({ key, label })),
  );
  const mockupTesterArtworkOptions: ListingMockupArtworkOption[] = [
    ...(data.thumbnail ? [{
      id: 'primary-artwork',
      label: `Primary artwork — ${data.thumbnail.originalFileName ?? data.thumbnail.fileName}`,
      url: getThumbnailUrl(),
      primary: true,
    }] : []),
    ...data.files.flatMap((file) => {
      const displayName = file.originalFileName ?? file.fileName;
      const role = getPrintableDownloadRole(file);
      const testerRatio = testerRatioFromDownloadRole(role);
      if (!testerRatio || !/\.(?:jpe?g|png|webp)$/i.test(displayName)) return [];
      const ratioLabel = PRINTABLE_DOWNLOAD_SPECS.find((spec) => spec.key === role)?.label ?? displayName;
      return [{
        id: `print-variant-${file.id}`,
        label: `Print variant — ${ratioLabel}`,
        url: getFileUrl(file.id),
        ratio: testerRatio,
      }];
    }),
    ...data.groupItems.flatMap((item) => item.thumbnailFileName ? [{
      id: `group-artwork-${item.id}`,
      label: `Grouped artwork ${item.position} — ${item.name}`,
      url: groupedThumbnailUrl(item.id, false),
    }] : []),
  ];
  const usesDropboxPdfDownload = data.listing.includeAllItems
    || data.listing.numberOfItems === 3
    || data.listing.numberOfItems === 6
    || data.listing.numberOfItems === 12;
  const detailsChanged = JSON.stringify(form) !== JSON.stringify(createDetailsForm(data.listing));
  const desiredTags = uniqueTags([...tagDraft, ...parseTags(simpleInputs.tag)]);
  const tagsChanged = !haveSameTags(desiredTags, data.tags.map((tag) => tag.value));
  const listingDescriptionChanged = listingDescription.trim() !== data.listing.listingDescription;
  const listingItemChanged = listingItem.trim() !== data.listing.listingItem;
  const roomThemeChanged = roomTheme.trim() !== data.listing.roomTheme;
  const normalizedBackgroundColour = backgroundColour.trim().toUpperCase();
  const backgroundColourIsValid = /^#[0-9A-F]{6}$/.test(normalizedBackgroundColour);
  const backgroundColourChanged = normalizedBackgroundColour !== data.listing.backgroundColour;
  const savedPersonalisationPromptSettings = {
    headerText: data.listing.personalisationHeaderText,
    footerText: data.listing.personalisationFooterText,
    fontId: data.listing.personalisationFontId,
  };
  const personalisationPromptSettingsChanged = JSON.stringify(personalisationPromptSettings)
    !== JSON.stringify(savedPersonalisationPromptSettings);
  const canResyncToEtsy = data.todoItems.length === 0
    && data.etsyProducts.config.listOnEtsy
    && (data.etsyProducts.config.printsFrames || data.etsyProducts.config.digitalDownload)
    && (!data.etsyProducts.config.printsFrames || data.section.hasEtsySection);
  const listingCustomisationEnabled = Boolean(
    data.template?.customisePrints && data.etsyProducts.config.customisePrints,
  );
  const thumbnailSizesSet = data.listing.printCropSettings !== null;
  const textAreasSet = !listingCustomisationEnabled || data.listing.personalisationTextAreas !== null;
  const thumbnailWorkflowReady = Boolean(data.thumbnail && thumbnailSizesSet && textAreasSet);
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
    .filter((frame) => frame.key !== 'no_frame' && frame.enabled)
    .map((frame) => frame.key === 'oak' ? 'Natural Oak' : frame.label);
  const detailsPrintSizes = data.etsyProducts.sizes
    .filter((size) => size.enabled)
    .map((size) => size.label);
  const downloadDetailsPromptValues = {
    animalName: data.listing.listingItem,
    animalDescription: data.listing.listingDescription,
    roomTheme: data.listing.roomTheme,
    frameColour: downloadDetailsFrameColours.includes('Natural Oak')
      ? 'Natural Oak'
      : downloadDetailsFrameColours[0] ?? 'Natural Oak',
    orientation: data.listing.artworkOrientation,
    fileType: 'jpeg',
    frameColours: downloadDetailsFrameColours.join(', ') || 'Natural Oak',
    filesIncluded: data.files.map((file) => file.originalFileName ?? file.fileName).join(', '),
    recommendedPaper: data.materials.map((material) => material.value).join(', ')
      || 'Heavyweight matte photo paper, approximately 200–250 gsm',
    licenceType: 'Personal use only',
  };
  const expectedDigitalFiles = PRINTABLE_DOWNLOAD_SPECS.map((spec) => (
    `${spec.label} (${spec.portraitWidth} × ${spec.portraitHeight}px)`
  ));
  const detailsPersonalisationAreas = data.etsyProducts.config.customisePrints
    ? [
      data.etsyProducts.config.customTop ? 'top' : null,
      data.etsyProducts.config.customBottom ? 'bottom' : null,
    ].filter((area): area is string => area !== null)
    : [];
  const combinedListingDetailsPromptValues = {
    sectionName: data.section.sectionName,
    listingName: data.listing.localDirectoryName ?? data.listing.title,
    animalName: data.listing.listingItem,
    animalDescription: data.listing.listingDescription,
    roomTheme: data.listing.roomTheme,
    digitalDownload: data.etsyProducts.config.digitalDownload,
    paperDetails: data.materials.map((material) => material.value).join(', ')
      || 'Heavyweight matte art paper, at least 200gsm',
    printSizes: detailsPrintSizes.join(', '),
    frameColours: downloadDetailsFrameColours.join(', '),
    personalisationDetails: detailsPersonalisationAreas.length > 0
      ? `Optional ${detailsPersonalisationAreas.join(' and ')} text personalisation is available.`
      : '',
    giftMessageEnabled: data.etsyProducts.config.giftMessageEnabled,
    digitalFilesIncluded: expectedDigitalFiles.join(', '),
    orientation: downloadDetailsPromptValues.orientation,
    fileType: downloadDetailsPromptValues.fileType,
    recommendedPaper: downloadDetailsPromptValues.recommendedPaper,
    licenceType: downloadDetailsPromptValues.licenceType,
  };
  const missingCombinedDetailsFields = missingCombinedListingDetailsPromptFields(combinedListingDetailsPromptValues);
  const combinedListingDetailsPrompt = buildCombinedListingDetailsPrompt(combinedListingDetailsPromptValues);
  const setDetailsClipboardPrompt = buildSetDetailsClipboardPrompt({
    ...combinedListingDetailsPromptValues,
    digitalFilesIncluded: expectedDigitalFiles.join(', '),
  });
  const digitalDownloadGenerateSixPromptValues = {
    animalName: data.listing.listingItem,
    animalDescription: data.listing.listingDescription,
    roomTheme: data.listing.roomTheme,
    frameColour: downloadDetailsPromptValues.frameColour,
    orientation: downloadDetailsPromptValues.orientation === 'landscape' ? 'Landscape' : 'Portrait',
    fileType: 'jpeg',
    referenceImage: 'the thumbnail image attached to this prompt',
  };

  function getImageUrl(assetId: string, preview = false, version?: string) {
    return `/api/shops/listings/editor/assets?${new URLSearchParams({
      ...context,
      kind: 'image',
      assetId,
      ...(preview ? { preview: '1' } : {}),
      ...(version ? { v: version } : {}),
    })}`;
  }

  function getImageVersion(assetId: string) {
    return data?.images.find((image) => image.id === assetId)?.updatedAt;
  }

  function previewListingImage(item: Pick<ListingEditorData['images'][number], 'id' | 'fileName' | 'originalFileName'>) {
    setPreviewImage({
      src: getImageUrl(item.id, true, getImageVersion(item.id)),
      alt: item.originalFileName ?? item.fileName,
      type: 'image',
      galleryImageId: item.id,
    });
  }

  function previewListingImageAt(index: number) {
    const item = data?.images[index];
    if (item) previewListingImage(item);
  }

  function getFileUrl(assetId: string, preview = false) {
    return `/api/shops/listings/editor/assets?${new URLSearchParams({
      ...context,
      kind: 'file',
      assetId,
      ...(preview ? { preview: '1' } : {}),
    })}`;
  }

  function previewFile(item: { id: string; fileName: string; originalFileName: string | null }) {
    const displayName = item.originalFileName ?? item.fileName;
    const isImage = /\.(?:jpe?g|png|webp)$/i.test(displayName);
    setPreviewImage({
      src: getFileUrl(item.id, isImage),
      alt: displayName,
      type: isImage ? 'image' : 'document',
    });
  }

  function getThumbnailUrl(preview = false) {
    return `/api/shops/listings/editor/assets?${new URLSearchParams({
      ...context,
      kind: 'thumbnail',
      assetId: 'thumbnail',
      ...(preview ? { preview: '1' } : {}),
      ...(data?.listing.thumbnailUpdatedAt ? { v: data.listing.thumbnailUpdatedAt } : {}),
    })}`;
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
    setListingOrientation(nextData.listing.artworkOrientation);
    setListingItem(nextData.listing.listingItem);
    setGroupSelection(nextData.groupItems.map((item) => item.id));
    setRoomTheme(nextData.listing.roomTheme);
    setBackgroundColour(nextData.listing.backgroundColour);
    setPersonalisationPromptSettings({
      headerText: nextData.listing.personalisationHeaderText,
      footerText: nextData.listing.personalisationFooterText,
      fontId: nextData.listing.personalisationFontId,
    });
    setPreparedPersonalisationPrompt(null);
    personalisationSourceImage.current = null;
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
      throw new Error(payload.error?.trim() || fallbackMessage);
    }

    applyFreshData(payload.data);
    return payload.data;
  }

  async function saveTextAreas(value: NonNullable<ListingEditorData['listing']['personalisationTextAreas']>) {
    setBusyKey('save-text-areas');
    setError(null);
    try {
      const response = await fetch('/api/shops/listings/editor/text-areas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, textAreas: value }),
      });
      await parseResponse(response, 'Unable to save the personalisation text areas.');
      setTextAreasOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save the personalisation text areas.');
    } finally {
      setBusyKey(null);
    }
  }

  async function savePrintCrops(value: ListingPrintCropDraft) {
    setBusyKey('save-print-crops');
    setError(null);
    try {
      const response = await fetch('/api/shops/listings/editor/print-crops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...context,
          cropSettings: listingPrintCropDraftForSave(value),
        }),
      });
      await parseResponse(response, 'Unable to save the print crop settings.');
      setPrintCropsOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save the print crop settings.');
    } finally {
      setBusyKey(null);
    }
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

  async function importSetDetailsOutput() {
    setSetDetailsImportError(null);
    setError(null);
    setBusyKey('import-set-details');

    try {
      const response = await fetch('/api/shops/listings/editor/details/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, output: setDetailsImportOutput }),
      });
      const nextData = await parseResponse(response, 'Unable to import the Set Details output.');
      if (nextData) {
        setForm(createDetailsForm(nextData.listing));
        setTagDraft(nextData.tags.map((tag) => tag.value));
        setSimpleInputs((current) => ({ ...current, tag: '' }));
      }
      setSetDetailsImportOpen(false);
      setSetDetailsImportOutput('');
      setPromptClipboardStatus('Print and Digital Download details were saved and all Etsy tags were replaced.');
    } catch (caughtError) {
      setSetDetailsImportError(caughtError instanceof Error
        ? caughtError.message
        : 'Unable to import the Set Details output.');
    } finally {
      setBusyKey(null);
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

  async function saveBackgroundColour() {
    setError(null);
    setBusyKey('background-colour');
    try {
      const response = await fetch('/api/shops/listings/editor/background-colour', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, backgroundColour }),
      });
      await parseResponse(response, 'Unable to save the background colour.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save the background colour.');
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

  function groupedThumbnailUrl(sourceListingId: string, preview = true) {
    return `/api/shops/listings/editor/overview?${new URLSearchParams({
      ...context,
      sourceListingId,
      ...(preview ? { preview: '1' } : {}),
    }).toString()}`;
  }

  function toggleGroupedListing(sourceListingId: string, checked: boolean) {
    const limit = data?.template?.itemCount ?? 0;
    setGroupSelection((current) => {
      if (!checked) return current.filter((id) => id !== sourceListingId);
      if (current.includes(sourceListingId) || current.length >= limit) return current;
      return [...current, sourceListingId];
    });
  }

  function reorderGroupedListings(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    setGroupSelection((current) => {
      const from = current.indexOf(String(event.active.id));
      const to = current.indexOf(String(event.over!.id));
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
  }

  async function saveGroupedListings() {
    setError(null);
    setBusyKey('save-groups');
    try {
      const response = await fetch('/api/shops/listings/editor/overview', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, sourceListingIds: groupSelection }),
      });
      await parseResponse(response, 'Unable to save grouped listings.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save grouped listings.');
    } finally {
      setBusyKey(null);
    }
  }

  async function generateOverviewImages() {
    if (overviewActionRunning.current) return;
    overviewActionRunning.current = true;
    setError(null);
    setBusyKey('generate-overview-images');
    try {
      const clearResponse = await fetch('/api/shops/listings/editor/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, action: 'clear-images' }),
      });
      await parseResponse(clearResponse, 'Unable to remove the existing listing images.');
      const response = await fetch('/api/shops/listings/editor/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, action: 'images' }),
      });
      await parseResponse(response, 'Unable to generate the template images.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to generate the template images.');
    } finally {
      overviewActionRunning.current = false;
      setBusyKey(null);
    }
  }

  async function generateOverviewImage(imageTemplateId: string, imageTemplateName: string) {
    if (overviewActionRunning.current) return;
    overviewActionRunning.current = true;
    setError(null);
    setOverviewGenerationItem(`image-${imageTemplateId}`);
    setBusyKey(`generate-overview-image-${imageTemplateId}`);
    try {
      const response = await fetch('/api/shops/listings/editor/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...context,
          action: 'images',
          imageTemplateId: Number(imageTemplateId),
        }),
      });
      await parseResponse(response, `Unable to regenerate ${imageTemplateName}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : `Unable to regenerate ${imageTemplateName}.`);
    } finally {
      overviewActionRunning.current = false;
      setOverviewGenerationItem(null);
      setBusyKey(null);
    }
  }

  async function generateOverviewDetails() {
    if (overviewActionRunning.current) return;
    overviewActionRunning.current = true;
    setError(null);
    setBusyKey('generate-overview-details');
    try {
      const response = await fetch('/api/shops/listings/editor/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, action: 'details' }),
      });
      const nextData = await parseResponse(response, 'Unable to generate listing details with AWS Bedrock.');
      if (nextData) {
        setForm(createDetailsForm(nextData.listing));
        setTagDraft(nextData.tags.map((tag) => tag.value));
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to generate listing details with AWS Bedrock.');
    } finally {
      overviewActionRunning.current = false;
      setBusyKey(null);
    }
  }

  async function generateGroupedInstructions() {
    if (overviewActionRunning.current) return;
    overviewActionRunning.current = true;
    setError(null);
    setBusyKey('generate-grouped-instructions');
    try {
      const response = await fetch('/api/shops/listings/editor/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, action: 'grouped-pdf' }),
      });
      await parseResponse(response, 'Unable to create the grouped download instructions PDF.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create the grouped download instructions PDF.');
    } finally {
      overviewActionRunning.current = false;
      setBusyKey(null);
    }
  }

  async function generateSingleDownloadInstructions() {
    if (!data || data.template?.templateType === 'multiple') return;
    if (overviewActionRunning.current) return;
    overviewActionRunning.current = true;
    setError(null);
    setBusyKey('generate-download-instructions');
    try {
      if (!data.dropbox.current) {
        const dropboxResponse = await fetch('/api/shops/listings/dropbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...context, action: 'dropbox' }),
        });
        await parseResponse(dropboxResponse, 'Unable to create or update Dropbox before generating the instructions.');
      }
      const response = await fetch('/api/shops/listings/dropbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, action: 'pdf' }),
      });
      await parseResponse(response, 'Unable to create the download instructions PDF.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create the download instructions PDF.');
    } finally {
      overviewActionRunning.current = false;
      setBusyKey(null);
    }
  }

  async function generateEntireOverview() {
    if (!data?.template || overviewActionRunning.current) return;
    overviewActionRunning.current = true;
    setError(null);
    setOverviewGenerationError(null);
    const isMultipleTemplate = data.template.templateType === 'multiple';
    setOverviewGenerationStages(initialOverviewGenerationStages(!isMultipleTemplate));
    setOverviewGenerationItem(null);
    setBusyKey('generate-overview-all');
    let activeStage: OverviewGenerationStageKey = 'images';

    const updateStage = (
      key: OverviewGenerationStageKey,
      status: OverviewGenerationStageStatus,
      message: string,
    ) => {
      setOverviewGenerationStages((current) => current?.map((stage) => (
        stage.key === key ? { ...stage, status, message } : stage
      )) ?? current);
    };

    const postOverview = async (
      body: Record<string, unknown>,
      fallbackMessage: string,
    ) => {
      const response = await fetch('/api/shops/listings/editor/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, ...body }),
      });
      return parseResponse(response, fallbackMessage);
    };

    try {
      if (data.template.imageTemplates.length === 0) {
        throw new Error('The selected template has no image templates.');
      }
      updateStage('images', 'running', 'Removing existing listing images');
      await postOverview(
        { action: 'clear-images' },
        'Unable to remove the existing listing images.',
      );
      for (const [index, imageTemplate] of data.template.imageTemplates.entries()) {
        setOverviewGenerationItem(`image-${imageTemplate.id}`);
        updateStage('images', 'running', `Creating ${imageTemplate.name} (${index + 1} of ${data.template.imageTemplates.length})`);
        await postOverview(
          { action: 'images', imageTemplateId: Number(imageTemplate.id) },
          `Unable to generate ${imageTemplate.name}.`,
        );
      }
      setOverviewGenerationItem(null);
      updateStage('images', 'complete', `${data.template.imageTemplates.length} ${data.template.imageTemplates.length === 1 ? 'image' : 'images'} created`);

      activeStage = 'details';
      setOverviewGenerationItem('details');
      updateStage('details', 'running', 'Creating listing details and tags with AWS Bedrock');
      const detailsData = await postOverview(
        { action: 'details' },
        'Unable to generate listing details and tags with AWS Bedrock.',
      );
      if (detailsData) {
        setForm(createDetailsForm(detailsData.listing));
        setTagDraft(detailsData.tags.map((tag) => tag.value));
      }
      setOverviewGenerationItem(null);
      updateStage('details', 'complete', 'Listing details and tags created');

      activeStage = 'downloads';
      updateStage('downloads', 'running', data.template.templateType === 'multiple'
        ? 'Preparing source Dropbox links and the grouped instruction PDF'
        : 'Preparing digital downloads');
      if (data.template.templateType === 'multiple') {
        setOverviewGenerationItem('download-grouped-pdf');
        await postOverview(
          { action: 'grouped-pdf' },
          'Unable to create the grouped download instructions PDF.',
        );
        updateStage('downloads', 'complete', 'Grouped instruction PDF created with all source Dropbox links');
      } else {
        for (const [index, spec] of PRINTABLE_DOWNLOAD_SPECS.entries()) {
          setOverviewGenerationItem(`download-${spec.key}`);
          updateStage('downloads', 'running', `Creating ${spec.label} (${index + 1} of ${PRINTABLE_DOWNLOAD_SPECS.length + 1})`);
          const response = await fetch('/api/shops/listings/editor/downloads/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...context, ratio: spec.key }),
          });
          await parseResponse(response, `Unable to generate ${spec.label}.`);
        }
        setOverviewGenerationItem('download-guide');
        updateStage('downloads', 'running', `Creating the How to Print guide (${PRINTABLE_DOWNLOAD_SPECS.length + 1} of ${PRINTABLE_DOWNLOAD_SPECS.length + 1})`);
        const guideResponse = await fetch('/api/shops/listings/editor/downloads/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...context, ratio: 'guide' }),
        });
        await parseResponse(guideResponse, 'Unable to generate the How to Print guide.');
        updateStage('downloads', 'complete', `${PRINTABLE_DOWNLOAD_SPECS.length} artwork files and the How to Print guide created`);
      }
      setOverviewGenerationItem(null);

      if (!isMultipleTemplate) {
        activeStage = 'dropbox';
        updateStage('dropbox', 'running', 'Uploading files and creating the download instructions');
        setOverviewGenerationItem('dropbox');
        const response = await fetch('/api/shops/listings/dropbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...context, action: 'dropbox' }),
        });
        await parseResponse(response, 'Unable to update Dropbox.');
        setOverviewGenerationItem('download-instructions');
        updateStage('dropbox', 'running', 'Creating the Download Instructions PDF');
        const instructionsResponse = await fetch('/api/shops/listings/dropbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...context, action: 'pdf' }),
        });
        await parseResponse(instructionsResponse, 'Unable to create the Download Instructions PDF.');
        updateStage('dropbox', 'complete', 'Dropbox and the Download Instructions PDF created');
      }
      await postOverview(
        { action: 'mark-current' },
        'The listing was generated, but its change-tracking state could not be saved.',
      );
      setOverviewGenerationItem(null);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Unable to generate the complete listing.';
      const stageLabel = OVERVIEW_GENERATION_STAGES.find((stage) => stage.key === activeStage)?.label ?? 'Generate Listing';
      setOverviewGenerationItem(null);
      updateStage(activeStage, 'failed', 'Stopped because an error occurred');
      setOverviewGenerationError({ stage: stageLabel, message });
    } finally {
      overviewActionRunning.current = false;
      setBusyKey(null);
    }
  }

  async function resyncWithEtsy() {
    setError(null);
    setEtsyResyncMessage(null);
    setBusyKey('etsy-resync');

    try {
      const response = await fetch('/api/shops/listings/editor/etsy-resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });
      const nextData = await parseResponse(response, 'Unable to resync the listing with Etsy.');
      if (nextData) setForm(createDetailsForm(nextData.listing));
      setEtsyResyncMessage('The listing has been resynced with Etsy.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to resync the listing with Etsy.');
    } finally {
      setBusyKey(null);
    }
  }

  async function generatePrintableDownload(ratio: PrintableDownloadRatio | 'guide') {
    if (overviewActionRunning.current) return;
    overviewActionRunning.current = true;
    setError(null);
    setBusyKey(`generate-download-${ratio}`);
    try {
      const response = await fetch('/api/shops/listings/editor/downloads/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, ratio }),
      });
      await parseResponse(response, ratio === 'guide'
        ? 'Unable to generate the How to Print guide.'
        : 'Unable to generate the printable download.');
    } catch (caughtError) {
      setError(caughtError instanceof Error
        ? caughtError.message
        : ratio === 'guide'
          ? 'Unable to generate the How to Print guide.'
          : 'Unable to generate the printable download.');
    } finally {
      overviewActionRunning.current = false;
      setBusyKey(null);
    }
  }

  async function runDropboxAction() {
    if (!data?.dropbox.action || overviewActionRunning.current) return;
    overviewActionRunning.current = true;
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
      overviewActionRunning.current = false;
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

  async function chooseThumbnail(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('The selected thumbnail could not be read.'));
        image.src = url;
      });
      const analysis = analyseListingThumbnailDimensions(dimensions.width, dimensions.height);
      setError(null);
      setPendingThumbnail({
        file,
        url,
        rotation: 0,
        ratio: analysis.ratio,
        width: dimensions.width,
        height: dimensions.height,
      });
    } catch (caughtError) {
      URL.revokeObjectURL(url);
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to use that thumbnail.');
    }
  }

  function closePendingThumbnail() {
    if (pendingThumbnail) URL.revokeObjectURL(pendingThumbnail.url);
    setPendingThumbnail(null);
  }

  async function savePendingThumbnail() {
    if (!pendingThumbnail) return;
    setError(null);
    setBusyKey('upload-thumbnail');
    try {
      const formData = new FormData();
      formData.set('shopId', context.shopId);
      formData.set('sectionId', context.sectionId);
      formData.set('subSectionId', context.subSectionId);
      formData.set('listingId', context.listingId);
      formData.set('kind', 'thumbnail');
      formData.set('file', pendingThumbnail.file);
      formData.set('thumbnailRotation', String(pendingThumbnail.rotation));
      const response = await fetch('/api/shops/listings/editor/assets', { method: 'POST', body: formData });
      await parseResponse(response, 'Unable to upload the thumbnail.');
      closePendingThumbnail();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to upload the thumbnail.');
    } finally {
      setBusyKey(null);
    }
  }

  async function saveListingTemplateSettings(next: {
    customisePrints: boolean;
    customTop: boolean;
    customBottom: boolean;
    printsFrames?: boolean;
    digitalDownload?: boolean;
  }) {
    setBusyKey('listing-template-settings');
    setError(null);
    try {
      const response = await fetch('/api/shops/listings/editor/customisation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, ...next }),
      });
      await parseResponse(response, 'Unable to save the listing template settings.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save the listing template settings.');
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadAsset(kind: UploadKind, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await uploadFiles(kind, files);
  }

  async function uploadDownloadRole(role: PrintableDownloadRole, file: File) {
    setError(null);
    setBusyKey(`upload-download-${role}`);
    try {
      const formData = new FormData();
      formData.set('shopId', context.shopId);
      formData.set('sectionId', context.sectionId);
      formData.set('subSectionId', context.subSectionId);
      formData.set('listingId', context.listingId);
      formData.set('kind', 'file');
      formData.set('downloadRole', role);
      formData.set('file', file);
      const response = await fetch('/api/shops/listings/editor/assets', { method: 'POST', body: formData });
      await parseResponse(response, 'Unable to upload the digital download.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to upload the digital download.');
    } finally {
      setBusyKey(null);
    }
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
                      <div className="inline-flex flex-nowrap items-center justify-end gap-2">
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
                        {kind === 'file' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={`View ${item.originalFileName ?? item.fileName}`}
                            title={`View ${item.originalFileName ?? item.fileName}`}
                            onClick={() => previewFile(item)}
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
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
                        imageUrl={getImageUrl(item.id, true, getImageVersion(item.id))}
                        onPreview={() => previewListingImage(item)}
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
                        <img src={getImageUrl(activeImage.id, true, getImageVersion(activeImage.id))} alt={activeImage.originalFileName ?? activeImage.fileName} draggable={false} className="h-full w-full select-none object-cover" />
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

    if (kind === 'file') {
      if (data?.template?.templateType === 'multiple') {
        const pdfFiles = items.filter((item) => /\.pdf$/i.test(item.originalFileName ?? item.fileName));
        return (
          <div className="grid gap-4">
            <div>
              <h2 className="text-lg font-semibold">Digital Downloads</h2>
              <p className="text-sm text-muted-foreground">The grouped Dropbox links are supplied in the generated instruction PDF.</p>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>File</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{pdfFiles.length > 0 ? pdfFiles.map((item) => <TableRow key={item.id}>
                <TableCell className="font-medium">{item.originalFileName ?? item.fileName}</TableCell>
                <TableCell className="text-right"><div className="inline-flex gap-2">
                  <Button type="button" size="icon" variant="outline" onClick={() => previewFile(item)} aria-label={`View ${item.originalFileName ?? item.fileName}`}><Eye className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button asChild size="icon" variant="outline"><a href={getFileUrl(item.id)} download={item.originalFileName ?? item.fileName} aria-label={`Download ${item.originalFileName ?? item.fileName}`}><Download className="h-4 w-4" aria-hidden="true" /></a></Button>
                </div></TableCell>
              </TableRow>) : <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No instruction PDF has been created.</TableCell></TableRow>}</TableBody>
            </Table>
          </div>
        );
      }

      const printableStatus = getPrintableDownloadStatus(items);
      const instructionFile = items.find((item) => /instruction/i.test(item.originalFileName ?? item.fileName)) ?? null;
      const rows: Array<{ role: PrintableDownloadRole | 'instructions'; label: string; file: typeof items[number] | null; expectedName: string; accept: string }> = [
        ...printableStatus.items.map((item) => ({
          role: item.key,
          label: item.label,
          file: item.file as typeof items[number] | null,
          expectedName: `${(data?.listing.localDirectoryName ?? data?.listing.title ?? 'Listing').replace(/\s+/g, '')}_${PRINTABLE_DOWNLOAD_SPECS.find((spec) => spec.key === item.key)?.fileToken ?? item.key}.jpg`,
          accept: 'image/jpeg,image/png,image/webp',
        })),
        {
          role: 'guide',
          label: 'How to print guide',
          file: items.find((item) => /how[_ -]?to[_ -]?print/i.test(item.originalFileName ?? item.fileName)) ?? null,
          expectedName: `${(data?.listing.localDirectoryName ?? data?.listing.title ?? 'Listing').replace(/\s+/g, '')}_HowToPrintGuide.pdf`,
          accept: 'application/pdf',
        },
        {
          role: 'instructions',
          label: 'Download Instructions',
          file: instructionFile,
          expectedName: `${(data?.listing.localDirectoryName ?? data?.listing.title ?? 'Listing').replace(/\s+/g, '')}_DownloadInstructions.pdf`,
          accept: 'application/pdf',
        },
      ];
      return (
        <div className="grid gap-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">Upload the original files without resizing, recompressing, or ZIP creation.</p>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Saved Name</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((row) => <TableRow key={row.role}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className="text-muted-foreground">{row.file?.fileName ?? row.expectedName}</TableCell>
              <TableCell className="text-right"><div className="inline-flex gap-2">
                <Button type="button" size="icon" variant="outline" onClick={() => row.file && previewFile(row.file)} disabled={!row.file} aria-label={`View ${row.label}`}><Eye className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" size="icon" variant="outline" onClick={() => row.file && setDownloadToDelete({ id: row.file.id, name: row.file.originalFileName ?? row.file.fileName })} disabled={!row.file || busyKey !== null} aria-label={`Delete ${row.label}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                {row.role !== 'instructions' ? <label className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-input ${row.file || busyKey !== null ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'}`} title={`Upload ${row.label}`}>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <input type="file" className="sr-only" accept={row.accept} disabled={Boolean(row.file) || busyKey !== null} onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file && row.role !== 'instructions') void uploadDownloadRole(row.role, file);
                  }} />
                </label> : <Button type="button" size="icon" variant="outline" disabled aria-label="Created by Dropbox"><Upload className="h-4 w-4" aria-hidden="true" /></Button>}
              </div></TableCell>
            </TableRow>)}</TableBody>
          </Table>
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
              <p className="text-sm text-muted-foreground">The source animal files are uploaded individually in separate Dropbox folders.</p>
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
    const printableDownloadStatus = getPrintableDownloadStatus(items);

    return (
      <div className="grid gap-4">
        <div className="rounded-md border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Required printable downloads</h2>
              <p className="text-sm text-muted-foreground">Six exact-size 300 DPI JPEG files and How_To_Print_Guide.pdf are required.</p>
            </div>
            <span className={printableDownloadStatus.complete ? 'text-sm font-semibold text-green-700' : 'text-sm font-semibold text-amber-700'}>
              {printableDownloadStatus.completedCount} of {PRINTABLE_DOWNLOAD_SPECS.length + 1} complete
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {printableDownloadStatus.items.map((item) => (
              <span key={item.key} className="inline-flex items-center gap-1.5">
                {item.created
                  ? <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden="true" />
                  : <XCircle className="h-4 w-4 text-red-700" aria-hidden="true" />}
                {item.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              {printableDownloadStatus.guideCreated
                ? <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden="true" />
                : <XCircle className="h-4 w-4 text-red-700" aria-hidden="true" />}
              How to Print guide
            </span>
          </div>
        </div>
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
                <TableCell className="whitespace-nowrap text-right">
                  <div className="inline-flex flex-nowrap items-center justify-end gap-2">
                    <select
                      aria-label={`Zip number for ${item.fileName}`}
                      className="h-9 w-16 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
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
                        <Button type="button" variant="outline" className="w-40 shrink-0" onClick={() => reduceDownload(item.id)} disabled={busyKey !== null}>
                          {busyKey === `reduce-${item.id}` ? 'Resizing...' : `${target.width} x ${target.height} px`}
                        </Button>
                      ) : <span className="w-40 shrink-0" aria-hidden="true" />;
                    })()}
                    {/\.jpe?g$/i.test(item.originalFileName ?? item.fileName) ? (
                      <Button type="button" variant="outline" className="w-20 shrink-0" onClick={() => recompressDownload(item.id)} disabled={busyKey !== null || (item.jpegQuality ?? 100) <= 10}>
                        {busyKey === `reduce-quality-${item.id}` ? 'Saving...' : (item.jpegQuality ?? 100) <= 10 ? '10%' : `${(item.jpegQuality ?? 100) - 10}%`}
                      </Button>
                    ) : <span className="w-20 shrink-0" aria-hidden="true" />}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      aria-label={`Delete ${item.fileName}`}
                      onClick={() => deleteAsset(kind, item.id)}
                      disabled={busyKey !== null}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      aria-label={`View ${item.originalFileName ?? item.fileName}`}
                      title={`View ${item.originalFileName ?? item.fileName}`}
                      onClick={() => previewFile(item)}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
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

  function renderOverview() {
    if (!data) return null;
    const multiple = data.template?.templateType === 'multiple';
    const requiredItems = data.template?.itemCount ?? 1;
    const selectedCandidates = groupSelection.flatMap((id) => {
      const candidate = data.groupCandidates.find((item) => item.id === id)
        ?? data.groupItems.find((item) => item.id === id);
      return candidate ? [candidate] : [];
    });
    const groupedChanged = JSON.stringify(groupSelection) !== JSON.stringify(data.groupItems.map((item) => item.id));
    const printableStatus = getPrintableDownloadStatus(data.files);
    const detailsRows = [
      ['Create details', Boolean(data.listing.title.trim() && data.listing.description.trim())],
      ['Print Title', Boolean(data.listing.title.trim())],
      ['Print Description', Boolean(data.listing.description.trim())],
      ['Print Quantity', (data.listing.quantity ?? 0) > 0],
      ['Digital Download Title', Boolean(data.listing.digitalTitle.trim())],
      ['Digital Download Description', Boolean(data.listing.digitalDescription.trim())],
      ['Digital Download Quantity', (data.listing.digitalQuantity ?? 0) > 0],
      ['Etsy SKU', Boolean(data.listing.etsySku.trim())],
      ['Primary Colour', Boolean(data.listing.primaryColour.trim())],
      ['Secondary Colour', Boolean(data.listing.secondaryColour.trim())],
    ] as const;
    const stageStatus = (key: OverviewGenerationStageKey) => overviewGenerationStages?.find((stage) => stage.key === key)?.status;
    const status = (created: boolean, working = false) => working
      ? <RefreshCw className="h-5 w-5 animate-spin text-blue-700" aria-label="Working" />
      : created
        ? <CheckCircle2 className="h-5 w-5 text-green-700" aria-label="Created" />
        : <XCircle className="h-5 w-5 text-red-700" aria-label="Not created" />;
    const sourceReady = multiple
      ? data.groupItems.length === requiredItems && data.groupItems.every((item) => item.thumbnailFileName)
      : Boolean(data.thumbnail);

    return (
      <div className="grid gap-6">
        <section className="grid gap-4 rounded-lg border bg-card p-5" aria-labelledby="template-settings-heading">
          <div>
            <h2 id="template-settings-heading" className="text-lg font-semibold">Template Settings</h2>
            <p className="text-sm text-muted-foreground">Template: {data.template?.name ?? 'No template selected'}</p>
          </div>
          <ListingTemplateProductSettings
            template={data.template}
            listing={data.etsyProducts.config}
            saving={busyKey !== null}
            onChange={(key, checked) => void saveListingTemplateSettings({
              customisePrints: data.etsyProducts.config.customisePrints,
              customTop: key === 'customisePrints' ? checked && Boolean(data.template?.customTop) : data.etsyProducts.config.customTop,
              customBottom: key === 'customisePrints' ? checked && Boolean(data.template?.customBottom) : data.etsyProducts.config.customBottom,
              [key]: checked,
            })}
          />
          {busyKey === 'listing-template-settings' ? <p className="text-xs text-muted-foreground">Saving template settings...</p> : null}
          <div className="grid max-w-sm gap-2 border-t pt-4">
            <label className="text-sm font-medium" htmlFor="listing-background-colour">Background Colour</label>
            <div className="flex items-center gap-2">
              <Input
                type="color"
                aria-label="Choose Background Colour"
                className="h-10 w-14 cursor-pointer p-1"
                value={backgroundColourIsValid ? normalizedBackgroundColour : data.listing.backgroundColour}
                onChange={(event) => setBackgroundColour(event.target.value.toUpperCase())}
                disabled={busyKey !== null}
              />
              <Input
                id="listing-background-colour"
                value={backgroundColour}
                maxLength={7}
                placeholder="#F5F0E8"
                spellCheck={false}
                onChange={(event) => setBackgroundColour(event.target.value.toUpperCase())}
                disabled={busyKey !== null}
                aria-invalid={!backgroundColourIsValid}
              />
            </div>
            {!backgroundColourIsValid ? <p className="text-xs text-destructive">Enter a six-digit hex colour in the format #RRGGBB.</p> : null}
            <p className="text-xs text-muted-foreground">
              {data.listing.backgroundColourInherited
                ? `Inherited from ${data.template?.name ?? 'the assigned template'}.`
                : 'Overridden for this listing.'}
            </p>
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={() => void saveBackgroundColour()} disabled={busyKey !== null || !backgroundColourIsValid || !backgroundColourChanged}>
                {busyKey === 'background-colour' ? 'Saving...' : 'Save Background Colour'}
              </Button>
            </div>
          </div>
          {data.template?.customisePrints ? <div className="grid gap-3 border-t pt-4">
            <div className="ml-6 flex flex-wrap gap-x-8 gap-y-3 border-l pl-4">
              {data.template.customTop ? <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={data.etsyProducts.config.customisePrints && data.etsyProducts.config.customTop}
                  disabled={busyKey !== null || !data.etsyProducts.config.customisePrints}
                  onChange={(event) => void saveListingTemplateSettings({
                    customisePrints: event.target.checked || data.etsyProducts.config.customBottom,
                    customTop: event.target.checked,
                    customBottom: data.etsyProducts.config.customBottom,
                  })}
                />
                Top Text
              </label> : null}
              {data.template.customBottom ? <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={data.etsyProducts.config.customisePrints && data.etsyProducts.config.customBottom}
                  disabled={busyKey !== null || !data.etsyProducts.config.customisePrints}
                  onChange={(event) => void saveListingTemplateSettings({
                    customisePrints: event.target.checked || data.etsyProducts.config.customTop,
                    customTop: data.etsyProducts.config.customTop,
                    customBottom: event.target.checked,
                  })}
                />
                Bottom Text
              </label> : null}
            </div>
          </div> : null}
        </section>

        <section className="grid gap-4 rounded-lg border bg-card p-5">
          <h2 className="text-lg font-semibold">General Listing</h2>
          <div className="grid gap-2">
            <div className="flex items-end justify-between gap-4">
              <label className="text-sm font-medium" htmlFor="overview-listing-name">Listing Name</label>
              <span className="text-xs tabular-nums text-muted-foreground">{listingItem.length} / 100</span>
            </div>
            <Input id="overview-listing-name" value={listingItem} maxLength={100} onChange={(event) => setListingItem(event.target.value)} />
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={saveListingItem} disabled={busyKey !== null || !listingItemChanged}>
                {busyKey === 'listing-item' ? 'Saving...' : 'Save Name'}
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-end justify-between gap-4">
              <label className="text-sm font-medium" htmlFor="overview-listing-description">Listing description</label>
              <span className="text-xs tabular-nums text-muted-foreground">{listingDescription.length} / 1000</span>
            </div>
            <textarea id="overview-listing-description" value={listingDescription} maxLength={1000} onChange={(event) => setListingDescription(event.target.value)} className={textAreaClassName} />
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={saveListingDescription} disabled={busyKey !== null || !listingDescriptionChanged}>
                {busyKey === 'listing-description' ? 'Saving...' : 'Save Description'}
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="overview-listing-orientation">Listing orientation</label>
            <Input
              id="overview-listing-orientation"
              className="max-w-xs capitalize"
              value={listingOrientation}
              readOnly
              aria-readonly="true"
            />
            <p className="text-xs text-muted-foreground">
              Orientation is detected from the saved thumbnail.
            </p>
          </div>

          {!multiple ? <div className="grid gap-3 border-t pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Thumbnail</h3>
                <div className="grid gap-1 text-sm text-muted-foreground">
                  <p>Upload the source artwork used by this template.</p>
                  <p>A ratio of 4:5 or 5:4 will have a transparent background.</p>
                  <p>A ratio of 2:3 or 3:2 will be clipped down to the sizes.</p>
                </div>
              </div>
              <div className="grid w-40 gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setPrintCropsOpen(true)} disabled={busyKey !== null || !data.thumbnail}>
                  Set Size
                </Button>
                {listingCustomisationEnabled ? <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setTextAreasOpen(true)}
                  disabled={busyKey !== null || !data.thumbnail || !thumbnailSizesSet}
                  title={!data.thumbnail
                    ? 'Upload a thumbnail first.'
                    : !thumbnailSizesSet ? 'Run Set Size before setting text areas.' : undefined}
                >
                  Set Text Areas
                </Button> : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPersonalisationPreviewOpen(true)}
                  disabled={busyKey !== null || !thumbnailWorkflowReady || personalisationPreviewSizes.length === 0}
                  title={!data.thumbnail
                    ? 'Upload a thumbnail before viewing paper-size images.'
                    : !thumbnailSizesSet ? 'Run Set Size first.'
                    : !textAreasSet ? 'Run Set Text Areas first.'
                    : personalisationPreviewSizes.length === 0 ? 'The assigned template has no enabled paper sizes.' : undefined}
                >
                  View Images
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMockupTesterOpen(true)}
                  disabled={busyKey !== null}
                >
                  Tester
                </Button>
              </div>
            </div>
            {data.thumbnail ? <div className="flex flex-wrap items-start gap-4">
              <div className="group relative h-48 w-48 overflow-hidden rounded-lg border bg-muted">
                <img src={getThumbnailUrl(true)} alt={data.thumbnail.originalFileName ?? 'Thumbnail'} className="h-full w-full object-contain" />
                <Button type="button" variant="destructive" size="icon" className="absolute bottom-2 right-2 h-8 w-8" onClick={() => setDeleteThumbnailOpen(true)} disabled={busyKey !== null} aria-label="Delete thumbnail">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              <dl className="grid min-w-48 gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
                <div className="grid gap-1">
                  <dt className="font-medium text-muted-foreground">Width</dt>
                  <dd className="tabular-nums">{data.thumbnail.widthPixels ? `${data.thumbnail.widthPixels.toLocaleString()} px` : 'Unavailable'}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="font-medium text-muted-foreground">Height</dt>
                  <dd className="tabular-nums">{data.thumbnail.heightPixels ? `${data.thumbnail.heightPixels.toLocaleString()} px` : 'Unavailable'}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="font-medium text-muted-foreground">Ratio</dt>
                  <dd>{data.thumbnail.ratio === '2x3' ? '2:3' : data.thumbnail.ratio === '4x5' ? '4:5' : 'Other'}</dd>
                </div>
              </dl>
            </div> : <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
              <Upload className="h-5 w-5" aria-hidden="true" />
              Choose thumbnail image
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void chooseThumbnail(file);
              }} />
            </label>}
          </div> : <div className="grid gap-4 border-t pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Select listings to group</h3>
                <p className="text-sm text-muted-foreground">Select exactly {requiredItems} listings that use the followed template, then drag the thumbnails into image order.</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setMockupTesterOpen(true)} disabled={busyKey !== null}>
                Tester
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.groupCandidates.length > 0 ? data.groupCandidates.map((candidate) => {
                const checked = groupSelection.includes(candidate.id);
                return <label key={candidate.id} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                  <input type="checkbox" checked={checked} disabled={!checked && groupSelection.length >= requiredItems} onChange={(event) => toggleGroupedListing(candidate.id, event.target.checked)} />
                  <span>{candidate.name}</span>
                </label>;
              }) : <p className="text-sm text-muted-foreground">No listings use the followed single template yet.</p>}
            </div>
            {selectedCandidates.length > 0 ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderGroupedListings}>
              <SortableContext items={groupSelection} strategy={rectSortingStrategy}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {selectedCandidates.map((item, index) => <SortableGroupedListing
                    key={item.id}
                    id={item.id}
                    name={item.name}
                    position={index + 1}
                    imageUrl={item.thumbnailFileName ? groupedThumbnailUrl(item.id) : null}
                    disabled={busyKey !== null}
                  />)}
                </div>
              </SortableContext>
            </DndContext> : null}
            <div className="flex items-center justify-between gap-3">
              <span className={`text-sm ${groupSelection.length === requiredItems ? 'text-green-700' : 'text-amber-700'}`}>{groupSelection.length} / {requiredItems} selected</span>
              <Button type="button" size="sm" onClick={saveGroupedListings} disabled={busyKey !== null || groupSelection.length !== requiredItems || !groupedChanged}>
                {busyKey === 'save-groups' ? 'Saving...' : 'Save Selection'}
              </Button>
            </div>
          </div>}
        </section>

        <section className="rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Generate Listing</h2>
              <p className="text-sm text-muted-foreground">Template: {data.template?.name ?? 'No template selected'}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={generateOverviewImages} disabled={busyKey !== null || !sourceReady || !data.template || (!multiple && !thumbnailWorkflowReady)}>
                {busyKey === 'generate-overview-images'
                  ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <ImageIcon className="h-4 w-4" aria-hidden="true" />}
                {busyKey === 'generate-overview-images' ? 'Generating Images...' : 'Generate Images'}
              </Button>
              <Button type="button" onClick={generateEntireOverview} disabled={busyKey !== null || !sourceReady || !data.template || (!multiple && !thumbnailWorkflowReady)}>
                {busyKey === 'generate-overview-all'
                  ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                {busyKey === 'generate-overview-all' ? 'Generating...' : 'Generate'}
              </Button>
            </div>
          </div>
          {overviewGenerationStages ? (
            <ol className="mt-5 grid gap-2 rounded-md border bg-muted/30 p-4 sm:grid-cols-2" aria-label="Listing generation progress" aria-live="polite">
              {overviewGenerationStages.map((stage) => (
                <li key={stage.key} className="flex min-w-0 items-start gap-3 rounded-md bg-background p-3">
                  {stage.status === 'running' ? <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-700" aria-hidden="true" /> : null}
                  {stage.status === 'complete' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" /> : null}
                  {stage.status === 'failed' ? <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" /> : null}
                  {stage.status === 'pending' ? <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/40" aria-hidden="true" /> : null}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{stage.label}</span>
                    <span className="block text-xs text-muted-foreground">{stage.message}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="mt-5 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Details</TableHead><TableHead className="w-24">Status</TableHead><TableHead className="w-28 text-right">Run</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow className="bg-muted/50"><TableCell colSpan={3} className="font-semibold">Create Images</TableCell></TableRow>
                {(data.template?.imageTemplates ?? []).map((imageTemplate) => <TableRow key={imageTemplate.id}>
                  <TableCell>{imageTemplate.name}</TableCell><TableCell>{status(imageTemplate.generated, overviewGenerationItem === `image-${imageTemplate.id}`)}</TableCell>
                  <TableCell className="text-right"><Button type="button" size="sm" variant="outline" onClick={() => void generateOverviewImage(imageTemplate.id, imageTemplate.name)} disabled={busyKey !== null || !sourceReady || (!multiple && !thumbnailWorkflowReady)}>{busyKey === `generate-overview-image-${imageTemplate.id}` ? 'Running...' : 'Run'}</Button></TableCell>
                </TableRow>)}
                {(data.template?.imageTemplates.length ?? 0) === 0 ? <TableRow><TableCell colSpan={3} className="text-muted-foreground">No image templates configured.</TableCell></TableRow> : null}

                <TableRow className="bg-muted/50"><TableCell colSpan={3} className="font-semibold">Create Details</TableCell></TableRow>
                {detailsRows.map(([label, created], index) => <TableRow key={label}><TableCell>{label}</TableCell><TableCell>{status(created, stageStatus('details') === 'running')}</TableCell><TableCell className="text-right">{index === 0 ? <Button type="button" size="sm" variant="outline" onClick={generateOverviewDetails} disabled={busyKey !== null || (multiple ? data.groupItems.length !== requiredItems : !data.thumbnail)}>{busyKey === 'generate-overview-details' ? 'Running...' : 'Run'}</Button> : null}</TableCell></TableRow>)}

                <TableRow className="bg-muted/50"><TableCell colSpan={3} className="font-semibold">Create Tags</TableCell></TableRow>
                <TableRow><TableCell>Add tags</TableCell><TableCell>{status(data.tags.length > 0, stageStatus('details') === 'running')}</TableCell><TableCell /></TableRow>

                <TableRow className="bg-muted/50"><TableCell colSpan={3} className="font-semibold">Create Digital Downloads</TableCell></TableRow>
                {!multiple ? <>{printableStatus.items.map((item) => <TableRow key={item.key}><TableCell>{item.label}</TableCell><TableCell>{status(item.created, overviewGenerationItem === `download-${item.key}`)}</TableCell><TableCell className="text-right"><Button type="button" size="sm" variant="outline" onClick={() => void generatePrintableDownload(item.key)} disabled={busyKey !== null || !data.thumbnail}>Run</Button></TableCell></TableRow>)}
                  <TableRow><TableCell>How to print guide</TableCell><TableCell>{status(printableStatus.guideCreated, overviewGenerationItem === 'download-guide')}</TableCell><TableCell className="text-right"><Button type="button" size="sm" variant="outline" onClick={() => void generatePrintableDownload('guide')} disabled={busyKey !== null}>Run</Button></TableCell></TableRow></> : null}
                <TableRow>
                  <TableCell>Download Instructions</TableCell>
                  <TableCell>{status(
                    data.files.some((file) => /instruction/i.test(file.originalFileName ?? file.fileName)),
                    overviewGenerationItem === 'download-grouped-pdf' || overviewGenerationItem === 'download-instructions',
                  )}</TableCell>
                  <TableCell className="text-right">
                    {multiple ? (
                      <Button type="button" size="sm" variant="outline" onClick={generateGroupedInstructions} disabled={busyKey !== null || data.groupItems.length !== requiredItems}>
                        {busyKey === 'generate-grouped-instructions' ? 'Running...' : 'Run'}
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="outline" onClick={generateSingleDownloadInstructions} disabled={busyKey !== null}>
                        {busyKey === 'generate-download-instructions' ? 'Running...' : 'Run'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>

                {!multiple ? <><TableRow className="bg-muted/50"><TableCell colSpan={3} className="font-semibold">Dropbox</TableCell></TableRow>
                  <TableRow><TableCell>Create Dropbox / Upload files / Create download instructions PDF</TableCell><TableCell>{status(data.dropbox.current, overviewGenerationItem === 'dropbox')}</TableCell><TableCell className="text-right"><Button type="button" size="sm" variant="outline" onClick={runDropboxAction} disabled={busyKey !== null || !data.dropbox.action}>Run</Button></TableCell></TableRow></> : null}
              </TableBody>
            </Table>
          </div>
        </section>
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
          <p className="text-sm text-muted-foreground">Create or refresh the individual Dropbox files for this listing.</p>
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
                Open {item.tab === 'downloads' ? 'Digital Downloads' : item.tab.charAt(0).toUpperCase() + item.tab.slice(1)}
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
      {etsyResyncMessage ? (
        <p className="flex items-center gap-2 text-sm font-medium text-green-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {etsyResyncMessage}
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-0">
          <div className="mb-4 flex items-center justify-between gap-4">
            <CardTitle>{data.listing.localDirectoryName ?? data.listing.title}</CardTitle>
            <div className="flex shrink-0 items-center gap-2">
              {canResyncToEtsy ? (
                <Button type="button" onClick={resyncWithEtsy} disabled={busyKey !== null}>
                  <RefreshCw className={`h-4 w-4 ${busyKey === 'etsy-resync' ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {busyKey === 'etsy-resync' ? 'Resyncing...' : 'Etsy Resync'}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPromptClipboardStatus(null);
                  setPromptsOpen(true);
                }}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Prompts
              </Button>
            </div>
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
          <div className={`mb-3 flex flex-wrap items-center gap-2 text-sm ${data.sales.itemsSold > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            {data.sales.itemsSold > 0 ? <>
              <span className="font-medium">Sold {data.sales.itemsSold} {data.sales.itemsSold === 1 ? 'item' : 'items'} across {data.sales.orderCount} {data.sales.orderCount === 1 ? 'order' : 'orders'}.</span>
              {soldDate(data.sales.lastSoldAt) ? <span>Last sold {soldDate(data.sales.lastSoldAt)}.</span> : null}
              <Link href="/etsy/orders" className="font-medium underline underline-offset-2">View Etsy orders</Link>
            </> : <span>No Etsy sales recorded for this listing.</span>}
          </div>
          <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Listing editor sections">
            {([
              ['overview', 'Overview'],
              ['images', 'Images'],
              ['details', 'Details'],
              ['tags', 'Tags'],
              ['downloads', 'Digital Downloads'],
              ...(data.template?.templateType === 'multiple' ? [] : [['dropbox', 'Dropbox'] as const]),
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
                {label !== 'Todo' && data.pendingChanges.includes(label as never) ? (
                  <span className="ml-1 text-amber-600" aria-label="Changed">●</span>
                ) : null}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {activeTab === 'overview' ? renderOverview() : null}
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
                      readOnly
                      placeholder="Assigned automatically"
                    />
                    <span className="text-xs font-normal text-muted-foreground">Assigned automatically as SKU_000001 onwards. The same SKU is sent for every size and frame variation.</span>
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
                          onClick={() => copyPromptText(combinedListingDetailsPrompt, 'Combined Print and Download info prompt')}
                          disabled={promptCopying !== null || missingCombinedDetailsFields.length > 0}
                          aria-label="Copy combined Print and Download info prompt"
                          title={missingCombinedDetailsFields.length > 0
                            ? `Fill in ${missingCombinedDetailsFields.join(', ')} first`
                            : 'Copy combined Print and Download info prompt'}
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
                      {missingCombinedDetailsFields.length > 0 ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Fill in {missingCombinedDetailsFields.join(', ')} first.
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(combinedListingDetailsPrompt, 'Combined Print and Download info prompt')}
                          disabled={promptCopying !== null || missingCombinedDetailsFields.length > 0}
                          aria-label="Copy combined Print and Download info prompt"
                          title={missingCombinedDetailsFields.length > 0
                            ? `Fill in ${missingCombinedDetailsFields.join(', ')} first`
                            : 'Copy combined Print and Download info prompt'}
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
                  <TableRow {...promptRowProps('digital-downloads-generate-6')}>
                    <TableCell className="font-medium">Digital Downloads</TableCell>
                    <TableCell>Generate 6</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => copyPromptText(
                            buildDigitalDownloadGenerateSixPrompt(digitalDownloadGenerateSixPromptValues),
                            'Digital Downloads Generate 6 prompt'
                          )}
                          disabled={promptCopying !== null}
                          aria-label="Copy Digital Downloads Generate 6 prompt"
                          title="Copy Digital Downloads Generate 6 prompt"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={copyPromptThumbnail}
                          disabled={promptCopying !== null}
                          aria-label="Copy thumbnail image for Digital Downloads Generate 6 prompt"
                          title="Copy thumbnail image"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {renderPromptThumbnailDownloadButton('Digital Downloads Generate 6 prompt')}
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

      <Dialog open={setDetailsImportOpen} onOpenChange={(open) => {
        if (busyKey !== 'import-set-details') {
          setSetDetailsImportOpen(open);
          if (!open) setSetDetailsImportError(null);
        }
      }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Set Details output</DialogTitle>
            <DialogDescription>
              Paste the complete response containing Print Title, Print Description, Digital Title, Digital Description and Tags.
              Importing it replaces the current four detail fields and the complete Etsy tag list.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void importSetDetailsOutput();
            }}
          >
            <label className="grid gap-2 text-sm font-medium">
              Prompt output
              <textarea
                className={`${textAreaClassName} min-h-80 font-mono`}
                value={setDetailsImportOutput}
                onChange={(event) => setSetDetailsImportOutput(event.target.value)}
                placeholder={'Print Title\n\nYour print title\n\nPrint Description\n\nYour print description...'}
                disabled={busyKey === 'import-set-details'}
                autoFocus
              />
            </label>
            {setDetailsImportError ? (
              <p className="text-sm text-destructive" role="alert">{setDetailsImportError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSetDetailsImportOpen(false)}
                disabled={busyKey === 'import-set-details'}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!setDetailsImportOutput.trim() || busyKey === 'import-set-details'}>
                {busyKey === 'import-set-details' ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> Uploading...</>
                ) : (
                  <><Upload className="h-4 w-4" aria-hidden="true" /> Upload details and tags</>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={overviewGenerationError !== null} onOpenChange={(open) => { if (!open) setOverviewGenerationError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Listing generation stopped</DialogTitle>
            <DialogDescription>
              {overviewGenerationError?.stage} could not be completed. No later generation stages were started.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <p>{overviewGenerationError?.message}</p>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={() => setOverviewGenerationError(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewImage !== null} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className={previewImage?.galleryImageId
          ? 'max-h-[80vh] w-fit max-w-[calc(100vw-2rem)] overflow-hidden p-4 sm:max-w-[calc(100vw-2rem)]'
          : 'max-h-[80vh] w-[80vw] max-w-[80vw] overflow-hidden p-4'}>
          <DialogHeader>
            <DialogTitle>{previewImage?.alt ?? 'Image preview'}</DialogTitle>
          </DialogHeader>
          {previewImage ? previewImage.type === 'document' ? (
            <iframe
              src={previewImage.src}
              title={previewImage.alt}
              className="h-[calc(80vh-5rem)] w-full rounded-md border bg-white"
            />
          ) : (
            <div className="flex min-h-0 items-center justify-center gap-3">
              {previewGalleryIndex >= 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => previewListingImageAt(previewGalleryIndex - 1)}
                  disabled={previewGalleryIndex === 0}
                  aria-label="Previous image"
                  title="Previous image"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </Button>
              ) : null}
              <div className="flex min-h-0 min-w-0 flex-none flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewImage.src} alt={previewImage.alt} className="h-auto w-auto max-h-[calc(80vh-8rem)] max-w-[calc(100vw-10rem)] object-contain" />
                {previewGalleryIndex >= 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {previewGalleryIndex + 1} of {data.images.length}
                  </p>
                ) : null}
              </div>
              {previewGalleryIndex >= 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => previewListingImageAt(previewGalleryIndex + 1)}
                  disabled={previewGalleryIndex === data.images.length - 1}
                  aria-label="Next image"
                  title="Next image"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={pendingThumbnail !== null} onOpenChange={(open) => { if (!open && busyKey !== 'upload-thumbnail') closePendingThumbnail(); }}>
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
              <img
                src={pendingThumbnail.url}
                alt="Selected thumbnail"
                className="max-h-[55vh] max-w-full object-contain transition-transform"
                style={{ transform: `rotate(${pendingThumbnail.rotation}deg)` }}
              />
            </div>
            <p className="text-center text-sm text-muted-foreground">
              {pendingThumbnail.rotation % 180 === 0
                ? `${pendingThumbnail.width} × ${pendingThumbnail.height}`
                : `${pendingThumbnail.height} × ${pendingThumbnail.width}`}
              {' · '}{pendingThumbnail.rotation % 180 === 0
                ? pendingThumbnail.width > pendingThumbnail.height ? 'Landscape' : 'Portrait'
                : pendingThumbnail.height > pendingThumbnail.width ? 'Landscape' : 'Portrait'}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setPendingThumbnail((current) => current ? ({ ...current, rotation: ((current.rotation + 270) % 360) as 0 | 90 | 180 | 270 }) : null)} disabled={busyKey !== null}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Rotate left
                </Button>
                <Button type="button" variant="outline" onClick={() => setPendingThumbnail((current) => current ? ({ ...current, rotation: ((current.rotation + 90) % 360) as 0 | 90 | 180 | 270 }) : null)} disabled={busyKey !== null}>
                  <RotateCw className="h-4 w-4" aria-hidden="true" /> Rotate right
                </Button>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={closePendingThumbnail} disabled={busyKey !== null}>Cancel</Button>
                <Button type="button" onClick={() => void savePendingThumbnail()} disabled={busyKey !== null}>
                  {busyKey === 'upload-thumbnail' ? 'Saving...' : 'Save thumbnail'}
                </Button>
              </div>
            </div>
          </div> : null}
        </DialogContent>
      </Dialog>

      {data.thumbnail ? (
        <ListingPrintCropDialog
          open={printCropsOpen}
          onOpenChange={setPrintCropsOpen}
          imageUrl={getThumbnailUrl(true)}
          context={context}
          orientation={data.listing.artworkOrientation}
          initialSettings={data.listing.printCropSettings}
          saving={busyKey === 'save-print-crops'}
          onSave={(value) => { void savePrintCrops(value); }}
        />
      ) : null}

      {data.thumbnail && data.listing.printCropSettings ? (
        <ListingTextAreasDialog
          open={textAreasOpen}
          onOpenChange={setTextAreasOpen}
          imageUrl={getThumbnailUrl(true)}
          cropSettings={data.listing.printCropSettings}
          initialAreas={data.listing.personalisationTextAreas}
          allowTop={listingCustomisationEnabled && data.etsyProducts.config.customTop}
          allowBottom={listingCustomisationEnabled && data.etsyProducts.config.customBottom}
          saving={busyKey === 'save-text-areas'}
          onSave={(value) => { void saveTextAreas(value); }}
        />
      ) : null}

      {data.thumbnail ? (
        <ListingPersonalisationPreviewDialog
          open={personalisationPreviewOpen}
          onOpenChange={setPersonalisationPreviewOpen}
          context={context}
          sizes={personalisationPreviewSizes}
          allowTop={listingCustomisationEnabled && data.etsyProducts.config.customTop}
          allowBottom={listingCustomisationEnabled && data.etsyProducts.config.customBottom}
        />
      ) : null}

      <ListingMockupTesterDialog
        open={mockupTesterOpen}
        onOpenChange={setMockupTesterOpen}
        context={context}
        listingName={data.listing.listingItem || data.listing.localDirectoryName || data.listing.title}
        artworkOptions={mockupTesterArtworkOptions}
        initialBackgroundColour={data.listing.backgroundColour}
      />

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

      <Dialog open={downloadToDelete !== null} onOpenChange={(open) => { if (!open && busyKey === null) setDownloadToDelete(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete digital download?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete <strong>{downloadToDelete?.name}</strong>?</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDownloadToDelete(null)} disabled={busyKey !== null}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={busyKey !== null} onClick={async () => {
              if (downloadToDelete && await deleteAsset('file', downloadToDelete.id)) setDownloadToDelete(null);
            }}>{busyKey?.startsWith('file-') ? 'Deleting...' : 'Delete'}</Button>
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
