'use client';

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Eye, FlaskConical, GripVertical, ImagePlus, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { OurCategoryEditorData, OurCategoryFormValues, OurCategoryImageTemplateView } from '@/lib/our-categories';
import type { TemplateOpeningRegion } from '@/lib/our-category-template-composite';
import {
  DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
  PRINTSHRIMP_CUSTOM_FONTS,
  type PrintShrimpCustomFontId,
} from '@/lib/printshrimp/custom-fonts';
import { TemplateCornerPicker } from './TemplateCornerPicker';

type TabKey = 'details' | 'print-details' | 'image-templates';
type PendingNavigation = { type: 'href'; href: string } | { type: 'back' };
type EtsySectionUsage = 'printFrames' | 'customisedPrints' | 'digitalDownloads';

const ETSY_SECTION_FIELDS = [
  {
    usage: 'printFrames',
    label: 'Etsy Print / Frame Section',
    valueKey: 'printFrameSectionId',
    enabledKey: 'printsFrames',
    flagKey: 'useForPrintFrames',
  },
  {
    usage: 'customisedPrints',
    label: 'Etsy Customised Section',
    valueKey: 'customisedSectionId',
    enabledKey: 'customisePrints',
    flagKey: 'useForCustomisedPrints',
  },
  {
    usage: 'digitalDownloads',
    label: 'Digital Download Section',
    valueKey: 'downloadSectionId',
    enabledKey: 'digitalDownload',
    flagKey: 'useForDigitalDownloads',
  },
] as const;

const DEFAULT_ETSY_SECTION_USES: Record<EtsySectionUsage, boolean> = {
  printFrames: true,
  customisedPrints: true,
  digitalDownloads: true,
};

const checkboxClassName = 'h-4 w-4 rounded border-input accent-primary';
const selectClassName = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

function CheckboxField({ checked, label, onChange, disabled = false }: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm font-medium ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" className={checkboxClassName} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function appliesTo(template: OurCategoryImageTemplateView) {
  return [
    template.useOnPrints ? 'Prints' : null,
    template.useOnCustomised ? 'Customised prints' : null,
    template.useOnDigital ? 'Digital downloads' : null,
  ].filter(Boolean).join(', ') || 'None';
}

function SortableImageTemplateRow({
  template,
  disabled,
  onDelete,
  onTest,
  onView,
  onEdit,
}: {
  template: OurCategoryImageTemplateView;
  disabled: boolean;
  onDelete: () => void;
  onTest: () => void;
  onView: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: template.id,
    disabled,
  });
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`touch-none select-none ${disabled ? 'cursor-wait' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'z-10 bg-muted opacity-60' : ''}`}
      title="Click and drag to reorder"
      {...attributes}
      {...listeners}
      role="row"
      aria-label={`Drag ${template.name} to reorder`}
    >
      <TableCell className="w-10 pr-0 text-muted-foreground">
        <GripVertical className="h-5 w-5" aria-hidden="true" />
      </TableCell>
      <TableCell className="font-medium">
        <div className="flex flex-wrap items-center gap-2">
          <span>{template.name}</span>
          {template.isLinked ? <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">Linked</span> : null}
        </div>
        {template.isLinked ? (
          <p className="mt-1 text-xs font-normal text-muted-foreground">
            {template.linkedSourceTemplateName} / {template.linkedSourceImageTemplateName} / Image {template.linkedImageItemNumber}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="max-w-xl whitespace-normal">{template.description}</TableCell>
      <TableCell>{appliesTo(template)}</TableCell>
      <TableCell>
        <div
          className="flex justify-end gap-2"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Button type="button" variant="outline" size="icon" onClick={onDelete} disabled={disabled} aria-label={`Delete ${template.name}`} title="Delete image template">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={onTest} disabled={disabled} aria-label={`Test ${template.name}`} title="Test image template">
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={onView} disabled={disabled} aria-label={`View ${template.name}`} title="View image">
            <Eye className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={onEdit} disabled={disabled || template.isLinked} aria-label={`Edit ${template.name}`} title={template.isLinked ? 'Linked image templates cannot be edited' : 'Edit image template'}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function OurCategoryEditorClient({ initialData }: { initialData: OurCategoryEditorData }) {
  const [data, setData] = useState(initialData);
  const [values, setValues] = useState<OurCategoryFormValues>(initialData.values);
  const [activeTab, setActiveTab] = useState<TabKey>('details');
  const [saving, setSaving] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [reorderingTemplates, setReorderingTemplates] = useState(false);
  const [editTemplate, setEditTemplate] = useState<OurCategoryImageTemplateView | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateDisplayFonts, setTemplateDisplayFonts] = useState(false);
  const [templateBorderEnabled, setTemplateBorderEnabled] = useState(false);
  const [templateBorderSizePercent, setTemplateBorderSizePercent] = useState('5');
  const [templateTopText, setTemplateTopText] = useState('');
  const [templateBottomText, setTemplateBottomText] = useState('');
  const [templateFontId, setTemplateFontId] = useState<PrintShrimpCustomFontId>(DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templatePreview, setTemplatePreview] = useState<string | null>(null);
  const [templateImageRemoved, setTemplateImageRemoved] = useState(false);
  const [templateFileInputKey, setTemplateFileInputKey] = useState(0);
  const [templateImageSize, setTemplateImageSize] = useState<{ width: number; height: number } | null>(null);
  const [templateRegions, setTemplateRegions] = useState<TemplateOpeningRegion[]>([]);
  const [templateRegionDrafting, setTemplateRegionDrafting] = useState(false);
  const [templateUses, setTemplateUses] = useState({ prints: true, customised: true, digital: true });
  const [viewTemplate, setViewTemplate] = useState<OurCategoryImageTemplateView | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<OurCategoryImageTemplateView | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [testTemplate, setTestTemplate] = useState<OurCategoryImageTemplateView | null>(null);
  const [testFiles, setTestFiles] = useState<Array<File | null>>([]);
  const [testResultUrl, setTestResultUrl] = useState<string | null>(null);
  const [testingTemplate, setTestingTemplate] = useState(false);
  const [createEtsySectionOpen, setCreateEtsySectionOpen] = useState(false);
  const [newEtsySectionUses, setNewEtsySectionUses] = useState(DEFAULT_ETSY_SECTION_USES);
  const [newEtsySectionName, setNewEtsySectionName] = useState('');
  const [createEtsySectionError, setCreateEtsySectionError] = useState<string | null>(null);
  const [creatingEtsySection, setCreatingEtsySection] = useState(false);
  const [copyTemplateOpen, setCopyTemplateOpen] = useState(false);
  const [copySourceCategoryId, setCopySourceCategoryId] = useState('');
  const [copySourceImageTemplateId, setCopySourceImageTemplateId] = useState('');
  const [copyImageItemNumbers, setCopyImageItemNumbers] = useState<string[]>([]);
  const [copyingTemplate, setCopyingTemplate] = useState(false);
  const [linkTemplateOpen, setLinkTemplateOpen] = useState(false);
  const [linkSourceImageTemplateId, setLinkSourceImageTemplateId] = useState('');
  const [linkImageItemNumber, setLinkImageItemNumber] = useState('1');
  const [linkingTemplate, setLinkingTemplate] = useState(false);
  const bypassNavigation = useRef(false);
  const guardPushed = useRef(false);
  const templateSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(data.values), [data.values, values]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const isMultiple = values.templateType === 'multiple';
  const testImageItemNumbers = testTemplate
    ? testTemplate.displayFonts
      ? []
      : data.values.templateType === 'multiple'
      ? [...new Set(testTemplate.openingRegions
        .map((region) => region.imageItemNumber)
        .filter((itemNumber): itemNumber is number => Boolean(itemNumber) && itemNumber! <= data.values.itemCount))]
        .sort((first, second) => first - second)
      : [1]
    : [];
  const testImageCount = testImageItemNumbers.length;
  const followedTemplate = isMultiple
    ? data.singleTemplates.find((template) => template.id === values.followedTemplateId) ?? null
    : null;
  const selectedCopySource = data.copySourceTemplates.find((template) => String(template.id) === copySourceCategoryId) ?? null;
  const copySourceImageCount = selectedCopySource?.templateType === 'multiple' ? selectedCopySource.itemCount : selectedCopySource ? 1 : 0;
  const copyAllImages = selectedCopySource?.templateType === 'multiple' && selectedCopySource.itemCount === data.values.itemCount;
  const copyImageItemNumbersForRequest = copyAllImages
    ? Array.from({ length: data.values.itemCount }, (_, index) => index + 1)
    : copyImageItemNumbers.map(Number);
  const copyMappingValid = copySourceImageCount > 0
    && copyImageItemNumbersForRequest.length === copySourceImageCount
    && copyImageItemNumbersForRequest.every((itemNumber) => Number.isSafeInteger(itemNumber) && itemNumber >= 1 && itemNumber <= data.values.itemCount)
    && new Set(copyImageItemNumbersForRequest).size === copySourceImageCount;

  const validationMessage = useMemo(() => {
    if (!values.name.trim()) return 'Enter a Template Name.';
    if (values.templateType === 'multiple' && values.followedTemplateId === null) return 'Choose a Followed Template.';
    if (!values.roomTheme.trim()) return 'Enter a Room Theme.';
    if (values.printsFrames && values.printFrameSectionId === null) return 'Choose an Etsy Print / Frame Section.';
    if (values.customisePrints && values.customisedSectionId === null) return 'Choose an Etsy Customised Section.';
    if (values.digitalDownload && values.downloadSectionId === null) return 'Choose a Digital Download Section.';
    return null;
  }, [
    values.customisePrints,
    values.customisedSectionId,
    values.digitalDownload,
    values.downloadSectionId,
    values.name,
    values.followedTemplateId,
    values.printFrameSectionId,
    values.printsFrames,
    values.roomTheme,
    values.templateType,
  ]);

  const navigate = useCallback((navigation: PendingNavigation) => {
    bypassNavigation.current = true;
    if (navigation.type === 'back') window.location.assign('/our-templates');
    else window.location.assign(navigation.href);
  }, []);

  useEffect(() => {
    if (dirty && !guardPushed.current) {
      window.history.pushState({ ourCategoryUnsavedGuard: true }, '', window.location.href);
      guardPushed.current = true;
    }
  }, [dirty]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || bypassNavigation.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onDocumentClick = (event: MouseEvent) => {
      if (!dirtyRef.current || bypassNavigation.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.download) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      event.preventDefault();
      setPendingNavigation({ type: 'href', href: destination.href });
      setLeaveOpen(true);
    };
    const onPopState = () => {
      if (bypassNavigation.current || !dirtyRef.current) return;
      window.history.forward();
      setPendingNavigation({ type: 'back' });
      setLeaveOpen(true);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => () => {
    if (templatePreview) URL.revokeObjectURL(templatePreview);
  }, [templatePreview]);

  useEffect(() => () => {
    if (testResultUrl) URL.revokeObjectURL(testResultUrl);
  }, [testResultUrl]);

  function updateValue<TKey extends keyof OurCategoryFormValues>(key: TKey, value: OurCategoryFormValues[TKey]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function selectFollowedTemplate(templateId: number | null) {
    const selected = data.singleTemplates.find((template) => template.id === templateId) ?? null;
    setValues((current) => {
      if (!selected) {
        return {
          ...current,
          followedTemplateId: null,
          roomTheme: '',
          printsFrames: false,
          customisePrints: false,
          digitalDownload: false,
          customTop: false,
          customBottom: false,
          printFrameSectionId: null,
          customisedSectionId: null,
          downloadSectionId: null,
          sizes: Object.fromEntries(Object.keys(current.sizes).map((key) => [key, false])),
          frames: Object.fromEntries(Object.keys(current.frames).map((key) => [key, false])),
        };
      }
      return {
        ...current,
        followedTemplateId: selected.id,
        roomTheme: selected.values.roomTheme,
        printsFrames: selected.values.printsFrames,
        customisePrints: selected.values.customisePrints,
        digitalDownload: selected.values.digitalDownload,
        customTop: selected.values.customTop,
        customBottom: selected.values.customBottom,
        printFrameSectionId: selected.values.printFrameSectionId,
        customisedSectionId: selected.values.customisedSectionId,
        downloadSectionId: selected.values.downloadSectionId,
        sizes: { ...selected.values.sizes },
        frames: { ...selected.values.frames },
      };
    });
  }

  function requestBack() {
    if (!dirty) {
      navigate({ type: 'back' });
      return;
    }
    setPendingNavigation({ type: 'back' });
    setLeaveOpen(true);
  }

  async function saveCategory(navigation?: PendingNavigation) {
    if (validationMessage) {
      toast.error(validationMessage);
      setActiveTab('details');
      return false;
    }
    setSaving(true);
    try {
      const creating = data.categoryId === null;
      const response = await fetch(creating ? '/api/our-categories' : `/api/our-categories/${encodeURIComponent(data.categoryId!)}`, {
        method: creating ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const payload = await response.json() as { data?: OurCategoryEditorData; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Unable to save Our Template.');
      setData(payload.data);
      setValues(payload.data.values);
      toast.success(creating ? 'Our Template created.' : 'Our Template saved.');
      if (navigation) navigate(navigation);
      else if (creating) navigate({ type: 'href', href: `/our-templates/${payload.data.categoryId}/edit` });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save Our Template.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function resetTemplateForm() {
    if (templatePreview) URL.revokeObjectURL(templatePreview);
    setTemplateName('');
    setTemplateDescription('');
    setTemplateDisplayFonts(false);
    setTemplateBorderEnabled(false);
    setTemplateBorderSizePercent('5');
    setTemplateTopText('');
    setTemplateBottomText('');
    setTemplateFontId(DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID);
    setTemplateFile(null);
    setTemplatePreview(null);
    setTemplateImageRemoved(false);
    setTemplateImageSize(null);
    setTemplateRegions([]);
    setTemplateRegionDrafting(false);
    setTemplateUses(isMultiple
      ? { prints: values.printsFrames, customised: values.customisePrints, digital: values.digitalDownload }
      : { prints: true, customised: true, digital: true });
    setEditTemplate(null);
  }

  function openCreateTemplate() {
    resetTemplateForm();
    setTemplateOpen(true);
  }

  function openEditTemplate(template: OurCategoryImageTemplateView) {
    resetTemplateForm();
    setEditTemplate(template);
    setTemplateName(template.name);
    setTemplateDescription(template.description);
    setTemplateDisplayFonts(template.displayFonts);
    setTemplateBorderEnabled(template.borderEnabled);
    setTemplateBorderSizePercent(String(template.borderSizePercent));
    setTemplateTopText(template.topText);
    setTemplateBottomText(template.bottomText);
    setTemplateFontId(template.fontId);
    setTemplateImageSize(template.imageWidth && template.imageHeight ? { width: template.imageWidth, height: template.imageHeight } : null);
    setTemplateRegions(template.openingRegions);
    setTemplateUses({
      prints: template.useOnPrints,
      customised: template.useOnCustomised,
      digital: template.useOnDigital,
    });
    setTemplateOpen(true);
  }

  function closeTemplateDialog(force = false) {
    if (templateSaving && !force) return;
    setTemplateOpen(false);
    resetTemplateForm();
  }

  function chooseTemplateFile(file: File | null) {
    if (templatePreview) URL.revokeObjectURL(templatePreview);
    setTemplateFile(file);
    setTemplatePreview(file ? URL.createObjectURL(file) : null);
    if (file) {
      setTemplateImageRemoved(false);
      setTemplateImageSize(null);
      setTemplateRegions([]);
      setTemplateRegionDrafting(false);
    }
  }

  function removeTemplateImage() {
    if (templatePreview) URL.revokeObjectURL(templatePreview);
    setTemplateFile(null);
    setTemplatePreview(null);
    setTemplateImageRemoved(true);
    setTemplateImageSize(null);
    setTemplateRegions([]);
    setTemplateRegionDrafting(false);
    setTemplateFileInputKey((current) => current + 1);
  }

  async function saveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const templateImageRequired = !templateDisplayFonts
      && (!editTemplate || editTemplate.displayFonts || templateImageRemoved);
    if (!data.categoryId || (templateImageRequired && !templateFile)) {
      toast.error(data.categoryId ? 'Choose a template image.' : 'Create the template before adding image templates.');
      return;
    }
    if (!templateDisplayFonts && !templateImageSize) {
      toast.error('Wait for the template image to finish loading.');
      return;
    }
    if (!templateDisplayFonts && templateRegionDrafting) {
      toast.error('Finish selecting all four corners for the current artwork area, or delete that area.');
      return;
    }
    setTemplateSaving(true);
    try {
      const formData = new FormData();
      formData.set('name', templateName);
      formData.set('description', templateDescription);
      formData.set('displayFonts', String(templateDisplayFonts));
      formData.set('borderEnabled', String(templateBorderEnabled));
      formData.set('borderSizePercent', templateBorderSizePercent);
      formData.set('topText', templateTopText);
      formData.set('bottomText', templateBottomText);
      formData.set('fontId', templateFontId);
      if (templateFile) formData.set('file', templateFile);
      if (!templateDisplayFonts && templateImageSize) {
        formData.set('imageWidth', String(templateImageSize.width));
        formData.set('imageHeight', String(templateImageSize.height));
        formData.set('openingRegions', JSON.stringify(templateRegions));
      }
      formData.set('useOnPrints', String(templateUses.prints));
      formData.set('useOnCustomised', String(templateUses.customised));
      formData.set('useOnDigital', String(templateUses.digital));
      const response = await fetch(
        editTemplate
          ? `/api/our-categories/templates/${encodeURIComponent(editTemplate.id)}`
          : `/api/our-categories/${encodeURIComponent(data.categoryId)}/templates`,
        { method: editTemplate ? 'PUT' : 'POST', body: formData },
      );
      const payload = await response.json() as { template?: OurCategoryImageTemplateView; error?: string };
      if (!response.ok || !payload.template) throw new Error(payload.error ?? `Unable to ${editTemplate ? 'update' : 'create'} the image template.`);
      setData((current) => ({
        ...current,
        imageTemplates: editTemplate
          ? current.imageTemplates.map((template) => template.id === payload.template!.id ? payload.template! : template)
          : [...current.imageTemplates, payload.template!],
      }));
      closeTemplateDialog(true);
      toast.success(editTemplate ? 'Image template saved.' : 'Image template created and uploaded to S3.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to ${editTemplate ? 'update' : 'create'} the image template.`);
    } finally {
      setTemplateSaving(false);
    }
  }

  async function copyImageTemplate() {
    if (!data.categoryId || !copySourceCategoryId || !copySourceImageTemplateId || !copyMappingValid) return;
    setCopyingTemplate(true);
    try {
      const response = await fetch(`/api/our-categories/${encodeURIComponent(data.categoryId)}/templates/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceCategoryId: copySourceCategoryId,
          sourceTemplateId: copySourceImageTemplateId,
          imageItemNumbers: copyImageItemNumbersForRequest,
        }),
      });
      const payload = await response.json() as { template?: OurCategoryImageTemplateView; error?: string };
      if (!response.ok || !payload.template) throw new Error(payload.error ?? 'Unable to copy the image template.');
      setData((current) => ({ ...current, imageTemplates: [...current.imageTemplates, payload.template!] }));
      setCopyTemplateOpen(false);
      setCopySourceCategoryId('');
      setCopySourceImageTemplateId('');
      setCopyImageItemNumbers([]);
      openEditTemplate(payload.template);
      toast.success('Image template copied. Assign an image item to each artwork area.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to copy the image template.');
    } finally {
      setCopyingTemplate(false);
    }
  }

  async function linkImageTemplate() {
    if (!data.categoryId || !linkSourceImageTemplateId) return;
    setLinkingTemplate(true);
    try {
      const response = await fetch(`/api/our-categories/${encodeURIComponent(data.categoryId)}/templates/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTemplateId: linkSourceImageTemplateId,
          imageItemNumber: Number(linkImageItemNumber),
        }),
      });
      const payload = await response.json() as { template?: OurCategoryImageTemplateView; error?: string };
      if (!response.ok || !payload.template) throw new Error(payload.error ?? 'Unable to link the followed image template.');
      setData((current) => ({ ...current, imageTemplates: [...current.imageTemplates, payload.template!] }));
      setLinkTemplateOpen(false);
      setLinkSourceImageTemplateId('');
      setLinkImageItemNumber('1');
      toast.success('Image template linked.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to link the followed image template.');
    } finally {
      setLinkingTemplate(false);
    }
  }

  async function createEtsySection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newEtsySectionName.trim();
    if (!title) {
      setCreateEtsySectionError('Enter a section name.');
      return;
    }
    const usages = (Object.entries(newEtsySectionUses) as Array<[EtsySectionUsage, boolean]>)
      .filter(([, enabled]) => enabled)
      .map(([usage]) => usage);
    if (usages.length === 0) {
      setCreateEtsySectionError('Select at least one product type.');
      return;
    }
    setCreateEtsySectionError(null);
    setCreatingEtsySection(true);
    try {
      const response = await fetch('/api/our-categories/etsy-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: data.shopId, title, usages }),
      });
      const payload = await response.json() as { section?: OurCategoryEditorData['etsySections'][number]; error?: string };
      if (!response.ok || !payload.section) throw new Error(payload.error ?? 'Unable to create the Etsy section.');
      const section = payload.section;
      setData((current) => ({
        ...current,
        etsySections: [...current.etsySections.filter((item) => item.id !== section.id), section]
          .sort((first, second) => first.title.localeCompare(second.title)),
      }));
      if (newEtsySectionUses.printFrames) updateValue('printFrameSectionId', section.id);
      if (newEtsySectionUses.customisedPrints) updateValue('customisedSectionId', section.id);
      if (newEtsySectionUses.digitalDownloads) updateValue('downloadSectionId', section.id);
      setNewEtsySectionName('');
      setNewEtsySectionUses(DEFAULT_ETSY_SECTION_USES);
      setCreateEtsySectionOpen(false);
      toast.success('Etsy section created and selected.');
    } catch (error) {
      setCreateEtsySectionError(error instanceof Error ? error.message : 'Unable to create the Etsy section.');
    } finally {
      setCreatingEtsySection(false);
    }
  }

  async function confirmDeleteTemplate() {
    if (!deleteTemplate) return;
    setDeletingTemplate(true);
    try {
      const response = await fetch(`/api/our-categories/templates/${encodeURIComponent(deleteTemplate.id)}`, { method: 'DELETE' });
      const payload = await response.json() as { deletedId?: string; error?: string };
      if (!response.ok || !payload.deletedId) throw new Error(payload.error ?? 'Unable to delete the image template.');
      setData((current) => ({
        ...current,
        imageTemplates: current.imageTemplates.filter((template) => template.id !== payload.deletedId),
      }));
      setDeleteTemplate(null);
      toast.success('Image template deleted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete the image template.');
    } finally {
      setDeletingTemplate(false);
    }
  }

  function closeTestDialog() {
    if (testingTemplate) return;
    if (testResultUrl) URL.revokeObjectURL(testResultUrl);
    setTestTemplate(null);
    setTestFiles([]);
    setTestResultUrl(null);
  }

  function selectTestFile(index: number, file: File | null) {
    if (testResultUrl) URL.revokeObjectURL(testResultUrl);
    setTestFiles((current) => {
      const next = Array.from({ length: testImageCount }, (_, fileIndex) => current[fileIndex] ?? null);
      next[index] = file;
      return next;
    });
    setTestResultUrl(null);
  }

  async function runTemplateTest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedFiles = Array.from({ length: testImageCount }, (_, index) => testFiles[index] ?? null);
    if (!testTemplate || (!testTemplate.displayFonts && selectedFiles.some((file) => file === null))) {
      toast.error(testImageCount > 1
        ? `Choose all ${testImageCount} images required by this image template.`
        : 'Choose an image to attach.');
      return;
    }
    setTestingTemplate(true);
    try {
      const formData = new FormData();
      if (testTemplate.displayFonts) {
        // The server returns the stored generated showcase without an attached artwork image.
      } else if (testImageCount === 1) {
        formData.set('file', selectedFiles[0] as File);
      } else {
        for (const file of selectedFiles) formData.append('files', file as File);
      }
      const response = await fetch(`/api/our-categories/templates/${encodeURIComponent(testTemplate.id)}/test`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? 'Unable to test the image template.');
      }
      if (testResultUrl) URL.revokeObjectURL(testResultUrl);
      setTestResultUrl(URL.createObjectURL(await response.blob()));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to test the image template.');
    } finally {
      setTestingTemplate(false);
    }
  }

  async function finishTemplateDrag(event: DragEndEvent) {
    if (!data.categoryId || reorderingTemplates || !event.over || event.active.id === event.over.id) return;
    const oldIndex = data.imageTemplates.findIndex((template) => template.id === String(event.active.id));
    const newIndex = data.imageTemplates.findIndex((template) => template.id === String(event.over!.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const previousTemplates = data.imageTemplates;
    const reorderedTemplates = arrayMove(previousTemplates, oldIndex, newIndex);
    setData((current) => ({ ...current, imageTemplates: reorderedTemplates }));
    setReorderingTemplates(true);
    try {
      const response = await fetch(`/api/our-categories/${encodeURIComponent(data.categoryId)}/templates/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateIds: reorderedTemplates.map((template) => template.id) }),
      });
      const payload = await response.json() as { templateIds?: string[]; error?: string };
      if (!response.ok || !payload.templateIds) throw new Error(payload.error ?? 'Unable to save the image-template order.');
      if (payload.templateIds.join(',') !== reorderedTemplates.map((template) => template.id).join(',')) {
        throw new Error('The saved image-template order did not match the requested order.');
      }
      toast.success('Image template order saved.');
    } catch (error) {
      setData((current) => ({ ...current, imageTemplates: previousTemplates }));
      toast.error(error instanceof Error ? error.message : 'Unable to save the image-template order.');
    } finally {
      setReorderingTemplates(false);
    }
  }

  function renderDetails() {
    return (
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid max-w-3xl gap-5">
          <label className="grid gap-2 text-sm font-medium">
            Template Name
            <Input aria-label="Template Name" value={values.name} maxLength={100} onChange={(event) => updateValue('name', event.target.value)} />
            <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{values.name.length} / 100</span>
          </label>
          {isMultiple ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Followed Template
                <select
                  className={selectClassName}
                  aria-label="Followed Template"
                  value={values.followedTemplateId ?? ''}
                  onChange={(event) => selectFollowedTemplate(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">No Template Selected</option>
                  {data.singleTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
                {data.singleTemplates.length === 0 ? <span className="text-xs font-normal text-amber-700">No single templates are available.</span> : null}
              </label>
              <label className="grid gap-2 text-sm font-medium">
                No of Items
                <select className={selectClassName} aria-label="No of Items" value={values.itemCount} onChange={(event) => updateValue('itemCount', Number(event.target.value))}>
                  {[3, 6, 12].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            </div>
          ) : (
            <label className="grid gap-2 text-sm font-medium">
              Room Theme
              <textarea
                value={values.roomTheme}
                aria-label="Room Theme"
                maxLength={200}
                onChange={(event) => updateValue('roomTheme', event.target.value)}
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="For example, Bugs or Dinosaurs"
              />
              <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{values.roomTheme.length} / 200</span>
            </label>
          )}
          {(!isMultiple || followedTemplate?.values.printsFrames) ? <CheckboxField checked={values.printsFrames} label="Print / Frames" onChange={(checked) => updateValue('printsFrames', checked)} /> : null}
          {(!isMultiple || followedTemplate?.values.customisePrints) ? <div className="grid gap-3">
            <CheckboxField checked={values.customisePrints} label="Customised Prints" onChange={(checked) => updateValue('customisePrints', checked)} />
            {values.customisePrints ? (
              <div className="ml-6 grid gap-3 border-l border-border pl-4">
                {(!isMultiple || followedTemplate?.values.customTop) ? <CheckboxField checked={values.customTop} label="Customise the Top text" onChange={(checked) => updateValue('customTop', checked)} /> : null}
                {(!isMultiple || followedTemplate?.values.customBottom) ? <CheckboxField checked={values.customBottom} label="Customise the Bottom text" onChange={(checked) => updateValue('customBottom', checked)} /> : null}
              </div>
            ) : null}
          </div> : null}
          {(!isMultiple || followedTemplate?.values.digitalDownload) ? <CheckboxField checked={values.digitalDownload} label="Digital Downloads" onChange={(checked) => updateValue('digitalDownload', checked)} /> : null}
          <div className="grid gap-4 rounded-md border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium">Etsy Sections</h3>
                <p className="text-sm text-muted-foreground">Choose the Etsy shop section used for each product type.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewEtsySectionUses(DEFAULT_ETSY_SECTION_USES);
                  setCreateEtsySectionError(null);
                  setNewEtsySectionName('');
                  setCreateEtsySectionOpen(true);
                }}
                disabled={creatingEtsySection}
                aria-label="Create Etsy Section"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />Create
              </Button>
            </div>
            {ETSY_SECTION_FIELDS.map((field) => {
              const enabled = values[field.enabledKey];
              const selectedId = values[field.valueKey];
              const sections = data.etsySections.filter((section) => section[field.flagKey]);
              return (
                <label key={field.usage} className={`grid gap-2 text-sm font-medium ${enabled ? '' : 'opacity-50'}`}>
                  {field.label}
                  <select
                    className={selectClassName}
                    aria-label={field.label}
                    value={selectedId ?? ''}
                    onChange={(event) => updateValue(field.valueKey, event.target.value ? Number(event.target.value) : null)}
                    disabled={!enabled || creatingEtsySection}
                  >
                    <option value="">Choose a section</option>
                    {selectedId !== null && !sections.some((section) => section.id === selectedId)
                      ? <option value={selectedId}>Selected section is not available for this type</option>
                      : null}
                    {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
                  </select>
                  {enabled && sections.length === 0
                    ? <span className="text-xs font-normal text-amber-700">No sections are registered for this product type.</span>
                    : null}
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderPrintDetails() {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Print Sizes</CardTitle><CardDescription>Choose the sizes available for listings using this template.</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.sizes
              .filter((size) => !isMultiple || Boolean(followedTemplate?.values.sizes[size.key]))
              .map((size) => <CheckboxField key={size.key} checked={values.sizes[size.key] ?? false} label={size.label} disabled={!values.printsFrames} onChange={(checked) => updateValue('sizes', { ...values.sizes, [size.key]: checked })} />)}
            {isMultiple && !followedTemplate ? <p className="col-span-full text-sm text-muted-foreground">Select a Followed Template to see its print sizes.</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Frames</CardTitle><CardDescription>{isMultiple ? 'Choose from the frames allowed by the Followed Template.' : 'Choose the frames available for listings using this template.'}</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {data.frames
              .filter((frame) => !isMultiple || Boolean(followedTemplate?.values.frames[frame.key]))
              .map((frame) => <CheckboxField key={frame.key} checked={values.frames[frame.key] ?? false} label={frame.label} disabled={!values.printsFrames} onChange={(checked) => updateValue('frames', { ...values.frames, [frame.key]: checked })} />)}
            {isMultiple && !followedTemplate ? <p className="text-sm text-muted-foreground">Select a Followed Template to see its frames.</p> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderImageTemplates() {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Image Templates</CardTitle>
            <CardDescription>Reusable images stored in the EtsyListingTemplates S3 directory. Click and drag a row to change its order.</CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {isMultiple ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCopySourceCategoryId('');
                  setCopySourceImageTemplateId('');
                  setCopyImageItemNumbers([]);
                  setCopyTemplateOpen(true);
                }}
                disabled={!data.categoryId || data.copySourceTemplates.length === 0 || reorderingTemplates}
              >Copy From</Button>
            ) : null}
            {isMultiple ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setLinkSourceImageTemplateId('');
                  setLinkImageItemNumber('1');
                  setLinkTemplateOpen(true);
                }}
                disabled={!data.categoryId || data.followedImageTemplates.length === 0 || reorderingTemplates}
              >Link</Button>
            ) : null}
            <Button type="button" onClick={openCreateTemplate} disabled={!data.categoryId || reorderingTemplates}><ImagePlus className="h-4 w-4" aria-hidden="true" />Create</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!data.categoryId ? <p className="px-6 pb-6 text-sm text-muted-foreground">Create the template first, then add image templates from this tab.</p> : (
            <DndContext sensors={templateSensors} collisionDetection={closestCenter} onDragEnd={(event) => { void finishTemplateDrag(event); }}>
              <Table>
                <TableHeader><TableRow><TableHead className="w-10 pr-0"><span className="sr-only">Order</span></TableHead><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Used On</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.imageTemplates.length > 0 ? (
                    <SortableContext items={data.imageTemplates.map((template) => template.id)} strategy={verticalListSortingStrategy}>
                      {data.imageTemplates.map((template) => (
                        <SortableImageTemplateRow
                          key={template.id}
                          template={template}
                          disabled={reorderingTemplates}
                          onDelete={() => setDeleteTemplate(template)}
                          onTest={() => setTestTemplate(template)}
                          onView={() => setViewTemplate(template)}
                          onEdit={() => openEditTemplate(template)}
                        />
                      ))}
                    </SortableContext>
                  ) : <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No image templates have been created.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </DndContext>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">
        {isMultiple
          ? data.categoryId ? 'Edit Multiple Template' : 'Create Multiple Template'
          : data.categoryId ? 'Edit Our Template' : 'Create Our Template'}
      </h1>
      <div className="flex w-fit flex-wrap gap-1 rounded-md border p-1" role="tablist" aria-label="Our Template sections">
        {([['details', 'Details'], ['print-details', 'Print Details'], ['image-templates', 'Image Templates']] as const).map(([key, label]) => (
          <Button key={key} type="button" variant={activeTab === key ? 'default' : 'ghost'} role="tab" aria-selected={activeTab === key} onClick={() => setActiveTab(key)}>{label}</Button>
        ))}
      </div>
      {activeTab === 'details' ? renderDetails() : null}
      {activeTab === 'print-details' ? renderPrintDetails() : null}
      {activeTab === 'image-templates' ? renderImageTemplates() : null}

      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card/95 p-4 shadow-lg backdrop-blur">
        <Button type="button" variant="outline" onClick={requestBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</Button>
        <Button type="button" onClick={() => void saveCategory()} disabled={saving || (!dirty && data.categoryId !== null)}>
          <Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Saving...' : data.categoryId ? 'Save' : 'Create'}
        </Button>
      </div>

      <Dialog open={leaveOpen} onOpenChange={(open) => { if (!saving) { setLeaveOpen(open); if (!open) setPendingNavigation(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save changes before leaving?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">You have unsaved changes to this template.</p>
          <DialogFooter className="sm:flex-wrap">
            <Button type="button" variant="outline" onClick={() => { setLeaveOpen(false); setPendingNavigation(null); }} disabled={saving}>Stay on page</Button>
            <Button type="button" variant="destructive" onClick={() => { if (pendingNavigation) navigate(pendingNavigation); }} disabled={saving}>Cancel changes</Button>
            <Button type="button" onClick={() => { if (pendingNavigation) void saveCategory(pendingNavigation); }} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createEtsySectionOpen} onOpenChange={(open) => {
        if (!creatingEtsySection && !open) {
          setCreateEtsySectionOpen(false);
          setCreateEtsySectionError(null);
          setNewEtsySectionName('');
          setNewEtsySectionUses(DEFAULT_ETSY_SECTION_USES);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Etsy Section</DialogTitle>
            <DialogDescription>Create a new section in your Etsy shop. It will be selected for this template.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createEtsySection} className="grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              Section name
              <Input aria-label="Section name" value={newEtsySectionName} onChange={(event) => setNewEtsySectionName(event.target.value)} disabled={creatingEtsySection} autoFocus />
            </label>
            <div className="grid gap-3 rounded-md border p-4">
              <CheckboxField
                checked={newEtsySectionUses.printFrames}
                label="Print / Frames"
                onChange={(checked) => setNewEtsySectionUses((current) => ({ ...current, printFrames: checked }))}
                disabled={creatingEtsySection}
              />
              <CheckboxField
                checked={newEtsySectionUses.customisedPrints}
                label="Customised"
                onChange={(checked) => setNewEtsySectionUses((current) => ({ ...current, customisedPrints: checked }))}
                disabled={creatingEtsySection}
              />
              <CheckboxField
                checked={newEtsySectionUses.digitalDownloads}
                label="Digital Downloads"
                onChange={(checked) => setNewEtsySectionUses((current) => ({ ...current, digitalDownloads: checked }))}
                disabled={creatingEtsySection}
              />
            </div>
            {createEtsySectionError ? <p className="text-sm text-destructive" role="alert">{createEtsySectionError}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateEtsySectionOpen(false);
                  setCreateEtsySectionError(null);
                  setNewEtsySectionName('');
                  setNewEtsySectionUses(DEFAULT_ETSY_SECTION_USES);
                }}
                disabled={creatingEtsySection}
              >Cancel</Button>
              <Button type="submit" disabled={creatingEtsySection}>{creatingEtsySection ? 'Creating...' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={copyTemplateOpen} onOpenChange={(open) => { if (!copyingTemplate) setCopyTemplateOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy Image Template</DialogTitle>
            <DialogDescription>Choose a single template or a multiple template with up to {data.values.itemCount} items, then choose where each source image should be used.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            Our Template
            <select
              className={selectClassName}
              aria-label="Copy from template"
              value={copySourceCategoryId}
              onChange={(event) => {
                const sourceId = event.target.value;
                const source = data.copySourceTemplates.find((template) => String(template.id) === sourceId) ?? null;
                const sourceImageCount = source?.templateType === 'multiple' ? source.itemCount : source ? 1 : 0;
                setCopySourceCategoryId(sourceId);
                setCopySourceImageTemplateId('');
                setCopyImageItemNumbers(
                  source?.templateType === 'multiple' && source.itemCount === data.values.itemCount
                    ? []
                    : Array.from({ length: sourceImageCount }, () => ''),
                );
              }}
              disabled={copyingTemplate}
            >
              <option value="">Select a template</option>
              {data.copySourceTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.templateType === 'single' ? 'Single' : `${template.itemCount} items`})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Image Template
            <select className={selectClassName} aria-label="Image template to copy" value={copySourceImageTemplateId} onChange={(event) => setCopySourceImageTemplateId(event.target.value)} disabled={copyingTemplate || !selectedCopySource}>
              <option value="">Select an image template</option>
              {selectedCopySource?.imageTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          {selectedCopySource && copyAllImages ? (
            <label className="grid gap-2 text-sm font-medium">
              Images
              <Input aria-label="Copy image selection" value="All" disabled />
            </label>
          ) : null}
          {selectedCopySource && !copyAllImages ? Array.from({ length: copySourceImageCount }, (_, sourceIndex) => {
            const label = selectedCopySource.templateType === 'single' ? 'Image Number' : `Source Image ${sourceIndex + 1}`;
            const ariaLabel = selectedCopySource.templateType === 'single' ? 'Copy to image number' : `Copy source Image ${sourceIndex + 1} to`;
            return (
              <label key={ariaLabel} className="grid gap-2 text-sm font-medium">
                {label}
                <select
                  className={selectClassName}
                  aria-label={ariaLabel}
                  value={copyImageItemNumbers[sourceIndex] ?? ''}
                  onChange={(event) => setCopyImageItemNumbers((current) => {
                    const next = Array.from({ length: copySourceImageCount }, (_, index) => current[index] ?? '');
                    next[sourceIndex] = event.target.value;
                    return next;
                  })}
                  disabled={copyingTemplate}
                >
                  <option value="">Select an image</option>
                  {Array.from({ length: data.values.itemCount }, (_, targetIndex) => (
                    <option key={targetIndex + 1} value={targetIndex + 1}>Image {targetIndex + 1}</option>
                  ))}
                </select>
              </label>
            );
          }) : null}
          {selectedCopySource?.templateType === 'multiple' && !copyAllImages ? (
            <p className="text-sm text-muted-foreground">Select {copySourceImageCount} different target images before copying.</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCopyTemplateOpen(false)} disabled={copyingTemplate}>Cancel</Button>
            <Button type="button" onClick={() => void copyImageTemplate()} disabled={copyingTemplate || !copySourceCategoryId || !copySourceImageTemplateId || !copyMappingValid}>{copyingTemplate ? 'Copying...' : 'Copy'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkTemplateOpen} onOpenChange={(open) => { if (!linkingTemplate) setLinkTemplateOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Image Template</DialogTitle>
            <DialogDescription>Select an image template from the Followed Template and choose which image item it represents. The source image will remain linked rather than being copied.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            Image Template
            <select className={selectClassName} aria-label="Image template to link" value={linkSourceImageTemplateId} onChange={(event) => setLinkSourceImageTemplateId(event.target.value)} disabled={linkingTemplate}>
              <option value="">Select an image template</option>
              {data.followedImageTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Image Number
            <select className={selectClassName} aria-label="Linked image number" value={linkImageItemNumber} onChange={(event) => setLinkImageItemNumber(event.target.value)} disabled={linkingTemplate}>
              {Array.from({ length: data.values.itemCount }, (_, index) => (
                <option key={index + 1} value={index + 1}>Image {index + 1}</option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkTemplateOpen(false)} disabled={linkingTemplate}>Cancel</Button>
            <Button type="button" onClick={() => void linkImageTemplate()} disabled={linkingTemplate || !linkSourceImageTemplateId}>{linkingTemplate ? 'Selecting...' : 'Select'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateOpen} onOpenChange={(open) => { if (!open) closeTemplateDialog(); }}>
        <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
          <form onSubmit={saveTemplate} className="grid gap-5">
            <DialogHeader><DialogTitle>{editTemplate ? 'Edit Image Template' : 'Create Image Template'}</DialogTitle></DialogHeader>
            <label className="grid gap-2 text-sm font-medium">
              Template Name
              <Input required aria-label="Template Name" maxLength={100} value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
              <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{templateName.length} / 100</span>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Description
              <textarea required aria-label="Description" maxLength={500} value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{templateDescription.length} / 500</span>
            </label>
            <div className="grid gap-2 rounded-md border p-4">
              <CheckboxField checked={templateDisplayFonts} label="Display fonts" onChange={setTemplateDisplayFonts} />
              <p className="text-xs text-muted-foreground">Creates a styled image showing every available font name in its own typeface.</p>
            </div>
            <div className="grid gap-3 rounded-md border p-4">
              <CheckboxField checked={templateBorderEnabled} label="Border" onChange={setTemplateBorderEnabled} />
              {templateBorderEnabled ? <label className="grid max-w-xs gap-2 text-sm font-medium">
                Border Size (%)
                <Input
                  required
                  aria-label="Border Size (%)"
                  type="number"
                  min="2.5"
                  max="10"
                  step="0.5"
                  value={templateBorderSizePercent}
                  onChange={(event) => setTemplateBorderSizePercent(event.target.value)}
                />
                <span className="text-xs font-normal text-muted-foreground">Choose between 2.5% and 10%.</span>
              </label> : null}
            </div>
            {!isMultiple ? <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Top Text
                <Input aria-label="Top Text" maxLength={40} value={templateTopText} onChange={(event) => setTemplateTopText(event.target.value)} disabled={templateDisplayFonts} />
                <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{templateTopText.length} / 40</span>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Bottom Text
                <Input aria-label="Bottom Text" maxLength={40} value={templateBottomText} onChange={(event) => setTemplateBottomText(event.target.value)} disabled={templateDisplayFonts} />
                <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{templateBottomText.length} / 40</span>
              </label>
            </div> : null}
            {!isMultiple ? <label className="grid gap-2 text-sm font-medium">
              Font
              <select
                aria-label="Font"
                className={selectClassName}
                value={templateFontId}
                onChange={(event) => setTemplateFontId(event.target.value as PrintShrimpCustomFontId)}
                disabled={templateDisplayFonts}
              >
                {PRINTSHRIMP_CUSTOM_FONTS.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
              </select>
            </label> : null}
            <label className="grid gap-2 text-sm font-medium">
              {editTemplate && !templateImageRemoved && !editTemplate.displayFonts ? 'Replacement Template Image (optional)' : 'Template Image'}
              <Input
                key={templateFileInputKey}
                required={!templateDisplayFonts && (!editTemplate || editTemplate.displayFonts || templateImageRemoved)}
                disabled={templateDisplayFonts}
                aria-label="Template Image"
                type="file"
                accept="image/png"
                onChange={(event) => chooseTemplateFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {templateDisplayFonts && editTemplate?.displayFonts ? (
              <div className="overflow-hidden rounded-md border bg-muted p-2">
                <img src={`/api/our-categories/templates/${encodeURIComponent(editTemplate.id)}/image?preview=1&fontStyle=plain-white-v2&v=${encodeURIComponent(editTemplate.updatedAt)}`} alt="Generated font showcase" className="max-h-[60vh] w-full object-contain" />
              </div>
            ) : null}
            {!templateDisplayFonts && (templatePreview || (editTemplate && !editTemplate.displayFonts && !templateImageRemoved)) ? (
              <TemplateCornerPicker
                imageUrl={templatePreview ?? `/api/our-categories/templates/${encodeURIComponent(editTemplate!.id)}/image?v=${encodeURIComponent(editTemplate!.updatedAt)}`}
                initialRegions={templateRegions}
                onRegionsChange={setTemplateRegions}
                onDraftingChange={setTemplateRegionDrafting}
                onImageSize={setTemplateImageSize}
                onRemoveImage={removeTemplateImage}
                multipleItemCount={isMultiple ? values.itemCount : undefined}
                disabled={templateSaving}
              />
            ) : null}
            <div className="grid gap-3 rounded-md border p-4">
              {values.printsFrames ? <CheckboxField checked={templateUses.prints} label="Prints – use on prints" onChange={(checked) => setTemplateUses((current) => ({ ...current, prints: checked }))} /> : null}
              {values.customisePrints ? <CheckboxField checked={templateUses.customised} label="Customized prints – use on customised prints" onChange={(checked) => setTemplateUses((current) => ({ ...current, customised: checked }))} /> : null}
              {values.digitalDownload ? <CheckboxField checked={templateUses.digital} label="Digital Downloads – use on digital downloads" onChange={(checked) => setTemplateUses((current) => ({ ...current, digital: checked }))} /> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => closeTemplateDialog()} disabled={templateSaving}>Cancel</Button>
              <Button type="submit" disabled={templateSaving}>{templateSaving ? (editTemplate ? 'Saving...' : 'Creating...') : (editTemplate ? 'Save' : 'Create')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={viewTemplate !== null} onOpenChange={(open) => { if (!open) setViewTemplate(null); }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>{viewTemplate?.name}</DialogTitle></DialogHeader>
          {viewTemplate ? <img src={`/api/our-categories/templates/${encodeURIComponent(viewTemplate.id)}/image?preview=1${viewTemplate.displayFonts ? '&fontStyle=plain-white-v2' : ''}&v=${encodeURIComponent(viewTemplate.updatedAt)}`} alt={viewTemplate.name} className="max-h-[75vh] w-full object-contain" /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTemplate !== null} onOpenChange={(open) => { if (!open && !deletingTemplate) setDeleteTemplate(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Image Template?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTemplate?.isLinked
              ? `Are you sure you want to remove the link to ${deleteTemplate.linkedSourceImageTemplateName}? The source image will not be deleted.`
              : `Are you sure you want to delete ${deleteTemplate?.name}? The database record and uploaded S3 image will be removed.`}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTemplate(null)} disabled={deletingTemplate}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDeleteTemplate()} disabled={deletingTemplate}>{deletingTemplate ? 'Deleting...' : 'Confirm'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testTemplate !== null} onOpenChange={(open) => { if (!open) closeTestDialog(); }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <form onSubmit={runTemplateTest} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Test {testTemplate?.name}</DialogTitle>
              <DialogDescription>
                {data.values.templateType === 'multiple'
                  ? testTemplate?.displayFonts
                    ? 'This generated showcase displays every available font and does not require an attached image.'
                    : testImageCount > 0
                    ? `Add the ${testImageCount} image${testImageCount === 1 ? '' : 's'} required by this image template. Each artwork area will use its saved image number. The stored template will not be changed.`
                    : 'This image template has no configured artwork regions. Edit it and add an artwork region before testing.'
                  : testTemplate?.displayFonts
                    ? 'This generated showcase displays every available font and does not require an attached image.'
                    : 'Attach an image to combine with the S3 template in memory. Saved Top Text and Bottom Text will be applied when present. The stored template will not be changed.'}
              </DialogDescription>
            </DialogHeader>
            {testImageItemNumbers.map((itemNumber, index) => {
              const label = data.values.templateType === 'multiple' ? `Image ${itemNumber}` : 'Image to attach';
              return (
                <label key={label} className="grid gap-2 text-sm font-medium">
                  {label}
                  <Input
                    aria-label={label}
                    required
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => selectTestFile(index, event.target.files?.[0] ?? null)}
                    disabled={testingTemplate}
                  />
                </label>
              );
            })}
            {testResultUrl ? (
              <div className="overflow-hidden rounded-md border bg-muted p-2">
                <img src={testResultUrl} alt={`Test result for ${testTemplate?.name ?? 'image template'}`} className="max-h-[65vh] w-full object-contain" />
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeTestDialog} disabled={testingTemplate}>Cancel</Button>
              <Button type="submit" disabled={testingTemplate || (!testTemplate?.displayFonts && (testImageCount === 0 || testFiles.filter(Boolean).length !== testImageCount))}>{testingTemplate ? 'Testing...' : 'Test'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
