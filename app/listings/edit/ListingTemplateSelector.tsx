'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ListingEditorContext, ListingEditorData } from '@/lib/listing-editor';

type TemplateChoice = { id: string; name: string; templateType: 'single' | 'multiple'; itemCount: number };
type Props = {
  context: ListingEditorContext;
  currentTemplate: { id: number | string; name: string } | null;
  disabled?: boolean;
  onSaved(data: ListingEditorData): void;
  onSavingChange?(saving: boolean): void;
};

const endpoint = '/api/shops/listings/editor/template';

export function ListingTemplateSelector({ context, currentTemplate, disabled = false, onSaved, onSavingChange }: Props) {
  const selectId = useId();
  const currentPropId = currentTemplate ? String(currentTemplate.id) : '';
  const [templates, setTemplates] = useState<TemplateChoice[]>([]);
  const [currentId, setCurrentId] = useState(currentPropId);
  const [selectedId, setSelectedId] = useState(currentPropId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ shopId: context.shopId, sectionId: context.sectionId, subSectionId: context.subSectionId, listingId: context.listingId }).toString();
  const identityRef = useRef(query); identityRef.current = query;
  const mounted = useRef(false);
  const loadRequest = useRef(0), saveRequest = useRef(0);
  const saveController = useRef<AbortController | null>(null);
  const saveLocked = useRef(false), notifiedSaving = useRef(false);
  const savedCallback = useRef(onSaved); savedCallback.current = onSaved;
  const busyCallback = useRef(onSavingChange); busyCallback.current = onSavingChange;
  const disabledRef = useRef(disabled); disabledRef.current = disabled;

  function notifySaving(next: boolean) {
    if (notifiedSaving.current === next) return;
    notifiedSaving.current = next; busyCallback.current?.(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; saveRequest.current++;
      saveController.current?.abort(); notifySaving(false);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++loadRequest.current;
    const identity = query;
    saveRequest.current++; saveController.current?.abort(); saveController.current = null;
    saveLocked.current = false; notifySaving(false);
    setSaving(false); setLoading(true); setTemplates([]); setLoadError(''); setSaveError(''); setMessage('');
    setCurrentId(currentPropId); setSelectedId(currentPropId);
    const current = () => mounted.current && !controller.signal.aborted && loadRequest.current === request && identityRef.current === identity;
    fetch(`${endpoint}?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to load listing templates.');
        if (!Array.isArray(payload?.templates) || !payload.templates.every((value: TemplateChoice) => value && typeof value.id === 'string' && value.id && typeof value.name === 'string'
          && (value.templateType === 'single' || value.templateType === 'multiple') && Number.isInteger(value.itemCount) && value.itemCount > 0)
          || payload.currentTemplateId !== null && typeof payload.currentTemplateId !== 'string') {
          throw new Error('The template choices could not be read. Try again.');
        }
        if (current()) { setTemplates(payload.templates); setCurrentId(payload.currentTemplateId ?? ''); setSelectedId(payload.currentTemplateId ?? ''); }
      })
      .catch((caught) => { if (current()) setLoadError(caught instanceof Error ? caught.message : 'Unable to load listing templates.'); })
      .finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, [query, retry]);

  useEffect(() => {
    if (!saveLocked.current) { setCurrentId(currentPropId); setSelectedId(currentPropId); }
  }, [currentPropId]);

  const canChange = !disabled && !loading && !saving && !loadError && selectedId !== currentId && templates.some((template) => template.id === selectedId);

  async function changeTemplate() {
    if (!canChange || disabledRef.current || saveLocked.current) return;
    saveLocked.current = true; notifySaving(true);
    const controller = new AbortController(); saveController.current = controller;
    const request = ++saveRequest.current, identity = query, templateId = selectedId;
    const current = () => mounted.current && !controller.signal.aborted && saveRequest.current === request && identityRef.current === identity;
    setSaving(true); setSaveError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...context, templateId }) });
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to change the listing template.');
      const next = payload?.data as ListingEditorData | undefined;
      if (!next?.context || next.context.shopId !== context.shopId || next.context.sectionId !== context.sectionId || next.context.subSectionId !== context.subSectionId
        || next.context.listingId !== context.listingId || String(next.template?.id ?? '') !== templateId) {
        throw new Error('The template changed, but the refreshed listing could not be read. Reload this listing.');
      }
      setCurrentId(templateId); setSelectedId(templateId);
      setMessage('Template changed. Regenerate the listing images to use the new template.');
      savedCallback.current(next);
    } catch (caught) {
      if (current()) setSaveError(caught instanceof Error ? caught.message : 'Unable to change the listing template.');
    } finally {
      if (saveRequest.current === request) {
        saveLocked.current = false; saveController.current = null; notifySaving(false);
        if (current()) setSaving(false);
      }
    }
  }

  const currentIsListed = templates.some((template) => template.id === currentId);
  return <div className="grid gap-3 border-t pt-4" aria-busy={loading || saving}>
    <label htmlFor={selectId} className="text-sm font-medium">Listing template</label>
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <select id={selectId} value={selectedId} disabled={disabled || loading || saving || !!loadError || templates.length === 0}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-xl" onChange={(event) => { setSelectedId(event.target.value); setSaveError(''); setMessage(''); }}>
        <option value="" disabled>{currentId ? 'Choose a template' : 'No template selected'}</option>
        {currentId && !currentIsListed ? <option value={currentId}>{currentTemplate && String(currentTemplate.id) === currentId ? currentTemplate.name : 'Current template'}</option> : null}
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name} — {template.templateType === 'multiple' ? `Set of ${template.itemCount}` : 'Single'}</option>)}
      </select>
      <Button type="button" disabled={!canChange} onClick={() => { void changeTemplate(); }}>{saving ? 'Changing template…' : 'Change template'}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Changing template removes the previous generated images. Your uploaded artwork is kept. Generate again to use the new template.</p>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading templates…</p> : null}
    {!loading && !loadError && templates.length === 0 ? <p role="status" className="text-sm text-muted-foreground">No templates are available for this shop.</p> : null}
    {loadError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><p>{loadError}</p><Button type="button" size="sm" variant="outline" disabled={disabled || loading || saving} onClick={() => setRetry((value) => value + 1)}>Retry templates</Button></div> : null}
    {saving ? <p role="status" className="text-sm text-muted-foreground">Changing listing template…</p> : null}
    {saveError ? <p role="alert" className="text-sm text-destructive">{saveError}</p> : null}
    {message ? <p role="status" className="text-sm text-green-700">{message}</p> : null}
  </div>;
}
