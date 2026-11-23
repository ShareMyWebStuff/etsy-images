'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SubSectionListingsPageData } from '@/lib/listing-table';
import type { ListingZipReviewState, ListingZipReviewSummary } from '@/lib/listing-zip-review-types';

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
  onInserted(data: SubSectionListingsPageData): void;
  onFinished(summary: ListingZipReviewSummary): void;
  onImportingChange?(importing: boolean): void;
};

const endpoint = '/api/shops/listings/import';
const MAX_ZIP_BYTES = 500 * 1024 * 1024;

type ImportContext = { shopId: string; sectionId: string; subSectionId: string };
type ReviewSession = { review: ListingZipReviewState; context: ImportContext };

function readReview(value: unknown): ListingZipReviewState {
  const review = value as ListingZipReviewState | undefined;
  if (!review || typeof review.sessionId !== 'string' || !review.sessionId || typeof review.templateName !== 'string'
    || !Number.isSafeInteger(review.total) || review.total < 1 || review.total > 100
    || !Number.isSafeInteger(review.cursor) || review.cursor < 0 || review.cursor > review.total
    || !Number.isSafeInteger(review.insertedCount) || review.insertedCount < 0
    || !Number.isSafeInteger(review.skippedCount) || review.skippedCount < 0
    || review.insertedCount + review.skippedCount !== review.cursor || typeof review.expiresAt !== 'string'
    || (review.cursor === review.total ? review.current !== null : !review.current
      || review.current.index !== review.cursor || !Number.isSafeInteger(review.current.rowNumber)
      || typeof review.current.title !== 'string' || typeof review.current.description !== 'string'
      || typeof review.current.relativeFilename !== 'string' || typeof review.current.originalFileName !== 'string'
      || review.current.error !== null && typeof review.current.error !== 'string')) {
    throw new Error('The ZIP review could not be read. Try again.');
  }
  return review;
}

function discardSession(session: ReviewSession) {
  // Review sessions contain temporary memory only. The server TTL also removes
  // abandoned sessions when a browser cannot deliver this best-effort cleanup.
  try {
    void Promise.resolve(fetch(endpoint, { method: 'DELETE', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...session.context, sessionId: session.review.sessionId }) })).catch(() => undefined);
  } catch { /* The review expires without affecting inserted listings. */ }
}

export function ListingZipImportDialog({ open, onOpenChange, shopId, sectionId, subSectionId, destinationName, onInserted, onFinished, onImportingChange }: Props) {
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
  const [review, setReview] = useState<ListingZipReviewState | null>(null);
  const [warning, setWarning] = useState('');
  const [busyAction, setBusyAction] = useState<'start' | 'insert' | 'skip' | 'refresh' | 'finish' | null>(null);
  const [imageState, setImageState] = useState<{ source: string; status: 'loaded' | 'error' } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  const busyNotified = useRef(false);
  const query = new URLSearchParams({ shopId, sectionId, subSectionId }).toString();
  const currentIdentity = useRef(query); currentIdentity.current = query;
  const isOpen = useRef(open); isOpen.current = open;
  const insertedCallback = useRef(onInserted); insertedCallback.current = onInserted;
  const finishedCallback = useRef(onFinished); finishedCallback.current = onFinished;
  const busyCallback = useRef(onImportingChange); busyCallback.current = onImportingChange;
  const pickerRequest = useRef(0);
  const operationVersion = useRef(0);
  const session = useRef<ReviewSession | null>(null);
  const uncertainAction = useRef(false);

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
    setReview(null); setWarning(''); setImageState(null); setBusyAction(null); setImporting(false);
    locked.current = false; uncertainAction.current = false; operationVersion.current++; notifyImporting(false);
    return () => {
      operationVersion.current++;
      if (session.current) { discardSession(session.current); session.current = null; }
      locked.current = false; notifyImporting(false);
    };
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
    if (next.size > MAX_ZIP_BYTES) { setError('The ZIP archive must be 500 MB or smaller.'); return; }
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

  const canImport = !review && !loading && !loadError && !importing && !choosing && file !== null && templates.some((template) => template.id === templateId);

  function updateReview(next: ListingZipReviewState, context: ImportContext) {
    session.current = { review: next, context };
    uncertainAction.current = false;
    setReview(next);
  }

  function closeReview(current: ReviewSession | null, unconfirmed = false) {
    if (current) {
      session.current = null;
      discardSession(current);
      finishedCallback.current({ insertedCount: current.review.insertedCount, skippedCount: current.review.skippedCount,
        totalCount: current.review.total, ...(unconfirmed ? { unconfirmed: true } : {}) });
    }
    onOpenChange(false);
  }

  async function finishReview() {
    if (locked.current) return;
    const active = session.current;
    if (!active || !uncertainAction.current) { closeReview(active); return; }
    // A failed response can follow a committed Insert. Confirm the server's
    // cursor before reporting counts or discarding that authoritative session.
    locked.current = true; setImporting(true); setBusyAction('finish'); notifyImporting(true);
    const identity = query, operation = ++operationVersion.current;
    const current = () => mounted.current && isOpen.current && currentIdentity.current === identity && operationVersion.current === operation;
    let confirmed = active, unconfirmed = false;
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ ...active.context, action: 'review', sessionId: active.review.sessionId })}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error('The latest review progress could not be confirmed.');
      const next = readReview(payload?.review);
      if (next.sessionId !== active.review.sessionId || next.total !== active.review.total || next.cursor < active.review.cursor) {
        throw new Error('The latest review progress could not be confirmed.');
      }
      confirmed = { ...active, review: next };
    } catch { unconfirmed = true; }
    if (!current()) return;
    locked.current = false; setImporting(false); setBusyAction(null); notifyImporting(false);
    uncertainAction.current = false;
    closeReview(confirmed, unconfirmed);
  }

  async function importListings(event: FormEvent) {
    event.preventDefault();
    if (!canImport || locked.current || !file) return;
    locked.current = true; setImporting(true); setBusyAction('start'); notifyImporting(true); setError('');
    const identity = query, operation = ++operationVersion.current;
    const context = { shopId, sectionId, subSectionId };
    const current = () => mounted.current && isOpen.current && currentIdentity.current === identity && operationVersion.current === operation;
    try {
      const form = new FormData();
      form.set('shopId', shopId); form.set('sectionId', sectionId); form.set('subSectionId', subSectionId);
      form.set('templateId', templateId); form.set('file', file);
      const response = await fetch(endpoint, { method: 'POST', body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to prepare the ZIP review. Try again.');
      const next = readReview(payload?.review);
      if (!current()) { discardSession({ review: next, context }); return; }
      updateReview(next, context);
    } catch (caught) {
      if (current()) setError(caught instanceof Error ? caught.message : 'Unable to prepare the ZIP review. Try again.');
    } finally {
      if (operationVersion.current === operation) {
        locked.current = false; notifyImporting(false);
        if (mounted.current) { setImporting(false); setBusyAction(null); }
      }
    }
  }

  async function reviewAction(action: 'insert' | 'skip' | 'refresh') {
    const active = session.current;
    if (!active || locked.current || action !== 'refresh' && !active.review.current || action === 'insert' && active.review.current?.error) return;
    locked.current = true; setImporting(true); setBusyAction(action); notifyImporting(true); setError('');
    if (action !== 'refresh') uncertainAction.current = true;
    const identity = query, operation = ++operationVersion.current;
    const current = () => mounted.current && isOpen.current && currentIdentity.current === identity && operationVersion.current === operation;
    try {
      const url = action === 'refresh' ? `${endpoint}?${new URLSearchParams({ ...active.context, action: 'review', sessionId: active.review.sessionId })}` : endpoint;
      const response = await fetch(url, action === 'refresh' ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...active.context, sessionId: active.review.sessionId, rowIndex: active.review.cursor, action }) });
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'The review could not be updated. Retry your choice or refresh the review.');
      const next = readReview(payload?.review);
      if (next.sessionId !== active.review.sessionId || next.total !== active.review.total || next.cursor < active.review.cursor
        || action !== 'refresh' && next.cursor <= active.review.cursor) throw new Error('The updated review could not be confirmed. Refresh the review before continuing.');
      updateReview(next, active.context);
      if (next.insertedCount > active.review.insertedCount) {
        const updated = payload?.data as SubSectionListingsPageData | undefined;
        if (updated?.shop?.id === shopId && updated.section?.id === sectionId && updated.subSection?.id === subSectionId && Array.isArray(updated.listings)) {
          insertedCallback.current(updated);
        } else {
          setWarning(typeof payload?.refreshError === 'string' ? payload.refreshError : 'A listing was inserted, but the table could not be refreshed. The table will be reloaded when you finish.');
        }
      } else if (typeof payload?.refreshError === 'string') setWarning(payload.refreshError);
    } catch (caught) {
      if (current()) setError(caught instanceof Error ? caught.message : 'The review could not be updated. Try again.');
    } finally {
      if (operationVersion.current === operation) {
        locked.current = false; notifyImporting(false);
        if (mounted.current) { setImporting(false); setBusyAction(null); }
      }
    }
  }

  const imageSource = review?.current ? `${endpoint}?${new URLSearchParams({ shopId, sectionId, subSectionId,
    action: 'image', sessionId: review.sessionId, rowIndex: String(review.current.index) })}` : '';
  const imageStatus = imageState?.source === imageSource ? imageState.status : 'loading';

  return <Dialog open={open} onOpenChange={(next) => { if (!next) finishReview(); else if (!locked.current) onOpenChange(next); }}>
    <DialogContent className={`max-h-[90vh] overflow-y-auto${review ? ' max-w-5xl' : ''}`}>
      <div className="grid gap-4" aria-busy={importing}>
        <DialogHeader>
          <DialogTitle>Import listings from ZIP</DialogTitle>
          <DialogDescription>Review one listing at a time for {destinationName}. A listing is created only when you choose Insert.</DialogDescription>
        </DialogHeader>
        {!review ? <form onSubmit={importListings} className="grid gap-4">
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p>Include <code>overview.csv</code> and its artwork images in the ZIP. The first row is skipped as the header.</p>
          <p className="mt-2">CSV columns, in order: <strong>Title, Description, Image filename</strong>. Image paths are relative to the folder containing <code>overview.csv</code>, such as <code>images/fox.png</code>.</p>
          <p className="mt-2 text-xs text-muted-foreground">ZIP limit: 500 MB. Artwork: JPG, PNG or WebP, up to 60 MB per image. Each row creates a single-artwork listing; set templates are not supported.</p>
          <p className="mt-2 text-xs text-muted-foreground">Images larger than 60 MB are displayed for review with a warning. They cannot be inserted; choose Skip to continue.</p>
          <p className="mt-2 text-xs text-muted-foreground">Titles already present in this section, including its subsections, or repeated in the ZIP are shown with an error and Insert disabled. Choose Skip to continue.</p>
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
        {importing ? <p role="status" className="text-sm font-medium">Reading ZIP… Preparing the review. No listings are being created.</p> : null}
        {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={importing} onClick={finishReview}>Cancel</Button>
          <Button type="submit" disabled={!canImport}>{importing ? 'Reading ZIP…' : 'Import listings'}</Button>
        </DialogFooter>
      </form> : <>
        <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{review.current ? `Item ${review.cursor + 1} of ${review.total}` : 'Review complete'}</p>
            <p>Template: {review.templateName}</p>
          </div>
          <progress aria-label="Import progress" className="h-2 w-full" value={review.cursor} max={review.total} />
          <p role="status">{review.cursor} of {review.total} reviewed · {review.insertedCount} inserted · {review.skippedCount} skipped</p>
        </div>
        {review.current ? <div className="grid min-w-0 gap-5 md:grid-cols-2">
          <div className="relative flex min-h-64 items-center justify-center rounded-md border bg-muted/20">
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={imageSource} src={imageSource} alt={`${review.current.title} import artwork`} className={`max-h-[52vh] w-full object-contain${imageStatus === 'error' ? ' invisible' : ''}`}
                onLoad={() => setImageState({ source: imageSource, status: 'loaded' })} onError={() => setImageState({ source: imageSource, status: 'error' })} />
              {imageStatus === 'loading' ? <p className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">Loading artwork…</p> : null}
              {imageStatus === 'error' ? <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">{review.current.error ? 'Artwork preview unavailable for this item.' : 'The preview could not be loaded. You can still choose Insert; the original artwork will be validated.'}</p> : null}
            </>
          </div>
          <div className="min-w-0 space-y-4">
            <div><h3 className="text-xs font-medium text-muted-foreground">Title</h3><p className="break-words text-xl font-semibold">{review.current.title}</p></div>
            <div><h3 className="text-xs font-medium text-muted-foreground">Description</h3><p className="whitespace-pre-wrap break-words text-sm">{review.current.description || 'No description.'}</p></div>
            <p className="break-all text-xs text-muted-foreground">CSV row {review.current.rowNumber} · {review.current.relativeFilename}</p>
            {review.current.width && review.current.height ? <p className="text-xs text-muted-foreground">{review.current.width} × {review.current.height} pixels · {review.current.orientation === 'landscape' ? 'Landscape' : 'Portrait'}</p> : null}
            {review.current.error ? <p role="alert" className="text-sm font-medium text-destructive">{review.current.error}</p> : null}
          </div>
        </div> : <p className="py-4 text-center text-lg font-medium">{review.insertedCount} {review.insertedCount === 1 ? 'listing' : 'listings'} inserted. {review.skippedCount} skipped.</p>}
        {warning ? <p role="alert" className="text-sm text-amber-700">{warning}</p> : null}
        {busyAction === 'finish' ? <p role="status" className="text-sm text-muted-foreground">Checking the latest review progress…</p> : null}
        {error ? <div className="grid justify-items-start gap-2"><p role="alert" className="text-sm font-medium text-destructive">{error}</p><Button type="button" variant="outline" disabled={importing} onClick={() => { void reviewAction('refresh'); }}>Refresh review</Button></div> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={importing} onClick={finishReview}>{busyAction === 'finish' ? 'Finishing…' : review.current ? 'Finish' : 'Done'}</Button>
          {review.current ? <>
            <Button type="button" variant="outline" disabled={importing} onClick={() => { void reviewAction('skip'); }}>{busyAction === 'skip' ? 'Skipping…' : 'Skip'}</Button>
            <Button type="button" disabled={importing || !!review.current.error} onClick={() => { void reviewAction('insert'); }}>{busyAction === 'insert' ? 'Inserting…' : 'Insert'}</Button>
          </> : null}
        </DialogFooter>
      </>}
      </div>
    </DialogContent>
  </Dialog>;
}
