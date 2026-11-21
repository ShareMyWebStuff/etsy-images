'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SubSectionListingsPageData } from '@/lib/listing-table';

type ImportTemplate = { id: string; name: string; templateType: 'single' | 'multiple'; itemCount: number };
type ZipPickerOptions = {
  startIn: 'downloads'; multiple: false;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
};
type ZipPickerWindow = Window & {
  showOpenFilePicker?: (options: ZipPickerOptions) => Promise<Array<{ getFile(): Promise<File> }>>;
};
type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  shopId: string;
  sectionId: string;
  subSectionId: string;
  destinationName: string;
  onImported(data: SubSectionListingsPageData, importedCount: number): void;
  onImportingChange?(importing: boolean): void;
};

const endpoint = '/api/shops/listings/import';
const MAX_ZIP_BYTES = 400 * 1024 * 1024;

export function ListingZipImportDialog({ open, onOpenChange, shopId, sectionId, subSectionId, destinationName, onImported, onImportingChange }: Props) {
  const templateSelectId = useId();
  const fileInputId = useId();
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [importing, setImporting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [showFileInput, setShowFileInput] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  const busyNotified = useRef(false);
  const query = new URLSearchParams({ shopId, sectionId, subSectionId }).toString();
  const currentIdentity = useRef(query); currentIdentity.current = query;
  const isOpen = useRef(open); isOpen.current = open;
  const importedCallback = useRef(onImported); importedCallback.current = onImported;
  const busyCallback = useRef(onImportingChange); busyCallback.current = onImportingChange;
  const pickerRequest = useRef(0);

  function notifyImporting(next: boolean) {
    if (busyNotified.current === next) return;
    busyNotified.current = next;
    busyCallback.current?.(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pickerRequest.current++; notifyImporting(false); };
  }, []);

  useEffect(() => {
    pickerRequest.current++;
    setFile(null); setTemplateId(''); setError(''); setShowFileInput(false); setChoosing(false);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setLoadError(''); setTemplates([]);
    void (async () => {
      try {
        const response = await fetch(`${endpoint}?${query}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to load import templates.');
        if (!Array.isArray(payload?.templates) || !payload.templates.every((entry: ImportTemplate) => entry && typeof entry.id === 'string'
          && entry.id && typeof entry.name === 'string' && (entry.templateType === 'single' || entry.templateType === 'multiple') && Number.isInteger(entry.itemCount))) {
          throw new Error('The import templates could not be read. Try again.');
        }
        if (!controller.signal.aborted) setTemplates(payload.templates.filter((entry: ImportTemplate) => entry.templateType === 'single' && entry.itemCount === 1));
      } catch (caught) {
        if (!controller.signal.aborted) setLoadError(caught instanceof Error ? caught.message : 'Unable to load import templates.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, query, retry]);

  function acceptFile(next: File | undefined) {
    if (!next) return;
    setError(''); setFile(null);
    if (!/\.zip$/i.test(next.name)) { setError('Choose a ZIP archive (.zip).'); return; }
    if (next.size === 0) { setError('The ZIP archive is empty. Choose another ZIP.'); return; }
    if (next.size > MAX_ZIP_BYTES) { setError('The ZIP archive must be 400 MB or smaller.'); return; }
    setFile(next);
  }

  async function chooseZip() {
    if (locked.current || choosing) return;
    setError('');
    const picker = (window as ZipPickerWindow).showOpenFilePicker;
    if (!picker) { fileInput.current?.click(); return; }
    const request = ++pickerRequest.current, identity = query;
    const current = () => mounted.current && isOpen.current && currentIdentity.current === identity && pickerRequest.current === request;
    setChoosing(true);
    try {
      const handles = await picker.call(window, { startIn: 'downloads', multiple: false,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] });
      const selected = handles[0] ? await handles[0].getFile() : undefined;
      if (current()) acceptFile(selected);
    } catch (caught) {
      if (current() && !(caught && typeof caught === 'object' && 'name' in caught && caught.name === 'AbortError')) {
        setShowFileInput(true);
        setError('The ZIP picker could not be opened. Choose your ZIP using the file field below.');
      }
    } finally {
      if (current()) setChoosing(false);
    }
  }

  const canImport = !loading && !loadError && !importing && !choosing && file !== null && templates.some((template) => template.id === templateId);

  async function importListings(event: FormEvent) {
    event.preventDefault();
    if (!canImport || locked.current || !file) return;
    locked.current = true; setImporting(true); notifyImporting(true); setError('');
    const identity = query;
    const current = () => mounted.current && isOpen.current && currentIdentity.current === identity;
    try {
      const form = new FormData();
      form.set('shopId', shopId); form.set('sectionId', sectionId); form.set('subSectionId', subSectionId);
      form.set('templateId', templateId); form.set('file', file);
      const response = await fetch(endpoint, { method: 'POST', body: form });
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to import listings. Try again.');
      const next = payload?.data as SubSectionListingsPageData | undefined;
      if (!next || next.shop?.id !== shopId || next.section?.id !== sectionId || next.subSection?.id !== subSectionId
        || !Array.isArray(next.listings) || !Number.isSafeInteger(payload.importedCount) || payload.importedCount < 1) {
        throw new Error('The import completed, but the refreshed listings could not be read. Reload this section before importing again.');
      }
      importedCallback.current(next, payload.importedCount);
    } catch (caught) {
      if (current()) setError(caught instanceof Error ? caught.message : 'Unable to import listings. Try again.');
    } finally {
      locked.current = false; notifyImporting(false);
      if (mounted.current) setImporting(false);
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!locked.current) onOpenChange(next); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <form onSubmit={importListings} className="grid gap-4" aria-busy={importing}>
        <DialogHeader>
          <DialogTitle>Import listings from ZIP</DialogTitle>
          <DialogDescription>Import one listing per CSV row into {destinationName}.</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p>Include <code>overview.csv</code> and its artwork images in the ZIP. The first row is skipped as the header.</p>
          <p className="mt-2">CSV columns, in order: <strong>Title, Description, Image filename</strong>. Image paths are relative to the folder containing <code>overview.csv</code>, such as <code>images/fox.png</code>.</p>
          <p className="mt-2 text-xs text-muted-foreground">ZIP limit: 400 MB. Artwork: JPG, PNG or WebP. Each row creates a single-artwork listing; set templates are not supported.</p>
        </div>
        <div className="grid gap-2">
          <label htmlFor={templateSelectId} className="text-sm font-medium">Import template</label>
          <select id={templateSelectId} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={templateId} disabled={loading || importing || !!loadError || templates.length === 0}
            onChange={(event) => { setTemplateId(event.target.value); setError(''); }}>
            <option value="">Choose a template</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          {loading ? <p role="status" className="text-sm text-muted-foreground">Loading import templates…</p> : null}
          {!loading && !loadError && templates.length === 0 ? <p role="status" className="text-sm text-amber-700">No single-artwork templates are available for this shop. Create a Single template with 1 item before importing.</p> : null}
          {loadError ? <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{loadError}</p><Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry templates</Button></div> : null}
        </div>
        <div className="grid gap-2">
          <Button type="button" variant="outline" className="justify-self-start" onClick={() => { void chooseZip(); }} disabled={importing || choosing}>
            {choosing ? 'Choosing ZIP…' : 'Choose ZIP'}
          </Button>
          <input id={fileInputId} ref={fileInput} type="file" accept=".zip,application/zip" aria-label="ZIP archive"
            className={showFileInput ? 'block w-full text-sm' : 'hidden'} disabled={importing || choosing}
            onChange={(event) => { acceptFile(event.target.files?.[0]); event.target.value = ''; }} />
          <p className="break-all text-sm" aria-live="polite">{file ? `Selected ZIP: ${file.name}` : 'No ZIP selected.'}</p>
        </div>
        {importing ? <p role="status" className="text-sm font-medium">Importing listings… Validating the ZIP and saving the listings.</p> : null}
        {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={importing} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={!canImport}>{importing ? 'Importing…' : 'Import listings'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
