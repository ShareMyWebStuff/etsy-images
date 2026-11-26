'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ListingEditorData } from '@/lib/listing-editor';
import type { ListingTemplateArtworkAssignments as Assignments, ListingTemplateArtworkPlan as Plan, ListingTemplateArtworkRole as Role } from '@/lib/listing-template-artwork-policy';

type Props = {
  data: ListingEditorData;
  disabled?: boolean;
  onSaved(data: ListingEditorData): void;
  onSavingChange?(saving: boolean): void;
  onDirtyChange?(dirty: boolean): void;
};
const endpoint = '/api/shops/listings/editor/artwork-assignments';
const reloadMessage = 'Artwork selections were saved, but the listing could not be refreshed. Reload this listing.';
function initialAssignments(plan: Plan | null): Assignments {
  const result = structuredClone(plan?.assignments ?? {});
  for (const role of plan?.roles ?? []) if (role.requiresSelection && role.assignmentKey) {
    result[role.assignmentKey] ??= {};
    for (const item of role.items) if (item.sourceListingId && !result[role.assignmentKey][String(item.itemNumber)]) result[role.assignmentKey][String(item.itemNumber)] = item.sourceListingId;
  }
  return result;
}
function signature(value: Assignments) {
  return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => [key, Object.entries(items).filter(([, id]) => !!id).sort(([a], [b]) => Number(a) - Number(b))]));
}
function sameListing(next: ListingEditorData | null | undefined, previous: ListingEditorData) {
  return !!next?.context && ['shopId', 'sectionId', 'subSectionId', 'listingId'].every(key => next.context[key as keyof typeof next.context] === previous.context[key as keyof typeof previous.context])
    && next.listing?.id === previous.context.listingId && String(next.template?.id ?? '') === String(previous.template?.id ?? '');
}
function isSelectionError(error: string) {
  return /^(Choose a listing from this section for artwork item |Use the current listing for at least one artwork item|Upload artwork for |Complete Set Size for |Artwork item \d+ (needs |must come from this section))/.test(error);
}

export function ListingTemplateArtworkAssignments({ data, disabled = false, onSaved, onSavingChange, onDirtyChange }: Props) {
  const incoming = data.templateArtwork ?? null;
  const [plan, setPlan] = useState<Plan | null>(incoming);
  const [draft, setDraft] = useState<Assignments>(() => initialAssignments(incoming));
  const [baseline, setBaseline] = useState(() => signature(initialAssignments(incoming)));
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [requiresReload, setRequiresReload] = useState(false);
  const scope = JSON.stringify([data.context, data.template?.id ?? null, incoming?.categoryId ?? null, incoming?.orientation ?? null,
    incoming?.roles.map(role => [role.id, role.sceneId, role.assignmentKey, role.items.map(item => [item.itemNumber, item.orientation])])]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const mounted = useRef(false), locked = useRef(false), requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null), busyNotified = useRef(false), dirtyNotified = useRef<boolean | null>(null);
  const callbacks = useRef({ onSaved, onSavingChange, onDirtyChange }); callbacks.current = { onSaved, onSavingChange, onDirtyChange };
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  function notifySaving(next: boolean) { if (busyNotified.current !== next) { busyNotified.current = next; callbacks.current.onSavingChange?.(next); } }
  function notifyDirty(next: boolean) { if (dirtyNotified.current !== next) { dirtyNotified.current = next; callbacks.current.onDirtyChange?.(next); } }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestVersion.current++; controller.current?.abort(); notifySaving(false); notifyDirty(false); };
  }, []);
  useEffect(() => {
    requestVersion.current++; controller.current?.abort(); controller.current = null; locked.current = false;
    notifySaving(false); setSaving(false); setPlan(incoming);
    const next = initialAssignments(incoming); setDraft(next); setBaseline(signature(next)); setError(''); setMessage(''); setRequiresReload(false);
  }, [scope, incoming]);
  const dirty = requiresReload || signature(draft) !== baseline;
  useEffect(() => { notifyDirty(dirty); }, [dirty]);
  const visibleRoles = plan?.roles.filter(role => role.sceneId || role.mode !== 'legacy' || role.errors.length) ?? [];
  const errors = useMemo(() => {
    const result = new Map<number, string[]>();
    for (const role of plan?.roles ?? []) {
      const next = role.requiresSelection ? role.errors.filter(error => !isSelectionError(error)) : [...role.errors];
      if (role.requiresSelection) {
        for (const item of role.items) {
          const id = role.assignmentKey ? draft[role.assignmentKey]?.[String(item.itemNumber)] : null;
          const source = plan?.candidates.find(candidate => candidate.id === id);
          if (!source || source.sectionId !== data.context.sectionId) next.push(`Choose a listing from this section for artwork item ${item.itemNumber}.`);
          else if (!source.hasThumbnail) next.push(`Upload artwork for ${source.name} before using it as item ${item.itemNumber}.`);
          else if (!source.hasCurrentSizes) next.push(`Complete Set Size for ${source.name} before using it as item ${item.itemNumber}.`);
          else if (source.orientation !== item.orientation) next.push(`Artwork item ${item.itemNumber} needs ${item.orientation} artwork.`);
        }
        if (!role.items.some(item => role.assignmentKey && draft[role.assignmentKey]?.[String(item.itemNumber)] === data.context.listingId)) next.push('Use the current listing for at least one artwork item.');
      }
      result.set(role.id, [...new Set(next)]);
    }
    return result;
  }, [plan, draft, data.context.sectionId, data.context.listingId]);
  const selectionRoles = plan?.roles.filter(role => role.requiresSelection) ?? [];
  const canSave = !disabled && !saving && !requiresReload && dirty && selectionRoles.length > 0 && ![...errors.values()].some(values => values.length);
  function choose(role: Role, itemNumber: number, sourceId: string) {
    if (!role.assignmentKey || disabledRef.current || locked.current || requiresReload) return;
    setDraft(current => {
      const items = { ...current[role.assignmentKey!] };
      if (sourceId) items[String(itemNumber)] = sourceId; else delete items[String(itemNumber)];
      return { ...current, [role.assignmentKey!]: items };
    });
    setError(''); setMessage('');
  }
  async function save() {
    if (!canSave || disabledRef.current || locked.current) return;
    locked.current = true; const request = ++requestVersion.current, identity = scope;
    const abort = new AbortController(); controller.current = abort;
    const current = () => mounted.current && !abort.signal.aborted && currentScope.current === identity && requestVersion.current === request;
    notifySaving(true); setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ ...data.context, assignments: draft }) });
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to save artwork selections.');
      const nextPlan = payload?.plan as Plan | undefined;
      if (!nextPlan || nextPlan.categoryId !== plan?.categoryId || !Array.isArray(nextPlan.roles) || !nextPlan.assignments) {
        setRequiresReload(true); setError(reloadMessage); return;
      }
      const nextAssignments = initialAssignments(nextPlan);
      setPlan(nextPlan); setDraft(nextAssignments); setBaseline(signature(nextAssignments));
      if (!sameListing(payload?.data, data) || payload?.data?.templateArtwork?.categoryId !== nextPlan.categoryId) {
        setRequiresReload(true); setError(typeof payload?.refreshError === 'string' ? payload.refreshError : reloadMessage); return;
      }
      setMessage('Artwork selections saved. Generate images to use them.');
      callbacks.current.onSaved(payload.data);
    } catch (caught) { if (current()) setError(caught instanceof Error ? caught.message : 'Unable to save artwork selections.'); }
    finally { if (requestVersion.current === request) { locked.current = false; controller.current = null; notifySaving(false); if (mounted.current) setSaving(false); } }
  }
  if (!plan || !visibleRoles.length) return null;
  return <Card aria-label="Template artwork" aria-busy={saving}><CardHeader><CardTitle>Template artwork</CardTitle><CardDescription>Choose artwork for each distinct item number. Repeated areas with the same number share one selection. A listing can be used more than once.</CardDescription></CardHeader><CardContent className="grid gap-4">
    {visibleRoles.map(role => <fieldset key={`${role.id}:${role.sceneId}`} className="grid gap-3 rounded-md border p-4"><legend className="px-1 text-sm font-semibold">{role.name}</legend>
      {role.mode === 'no-areas' ? <p className="text-sm text-muted-foreground">No areas: uses the saved image without inserting listing artwork.</p> : role.requiresSelection ? <><p className="text-xs text-muted-foreground">Use the current listing for at least one artwork item. Other selections must come from this section and match the required orientation.</p><div className="grid gap-3 md:grid-cols-2">{role.items.map(item => {
        const candidates = plan.candidates.filter(candidate => candidate.sectionId === data.context.sectionId && candidate.orientation === item.orientation);
        const value = role.assignmentKey ? draft[role.assignmentKey]?.[String(item.itemNumber)] ?? '' : '';
        return <label key={item.itemNumber} className="grid gap-2 text-sm font-medium">{role.name} — Artwork item {item.itemNumber} ({item.orientation})
          <select value={value} disabled={disabled || saving || requiresReload || !role.assignmentKey} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" onChange={event => choose(role, item.itemNumber, event.target.value)}>
            <option value="">Choose listing artwork</option>{value && !candidates.some(candidate => candidate.id === value) ? <option value={value} disabled>Saved selection unavailable ({value})</option> : null}
            {candidates.map(candidate => <option key={candidate.id} value={candidate.id} disabled={!candidate.hasThumbnail || !candidate.hasCurrentSizes}>{candidate.name}{candidate.id === data.context.listingId ? ' (current listing)' : ''}{!candidate.hasThumbnail ? ' — artwork required' : !candidate.hasCurrentSizes ? ' — Set Size required' : ''}</option>)}
          </select></label>;
      })}</div></> : role.items.length ? <p className="text-sm text-muted-foreground">{role.items.length === 1 && role.items[0].sourceListingId === data.context.listingId ? 'Uses the current listing automatically for its one distinct artwork item.' : 'Uses the saved grouped artwork selection automatically.'}</p> : null}
      {(errors.get(role.id) ?? []).length ? <ul className="grid gap-1 text-sm text-destructive">{errors.get(role.id)!.map(text => <li key={text}>{text}</li>)}</ul> : null}
    </fieldset>)}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {requiresReload ? <Button type="button" variant="outline" className="justify-self-start" onClick={() => window.location.reload()}>Reload listing</Button> : null}
    {message ? <p role="status" className="text-sm text-green-700">{message}</p> : null}
    {selectionRoles.length ? <div className="flex flex-wrap items-center gap-3"><Button type="button" disabled={!canSave} onClick={() => { void save(); }}>{saving ? 'Saving artwork selections…' : 'Save artwork selections'}</Button>{dirty && !requiresReload ? <p className="text-xs text-muted-foreground">Save these selections before generating images.</p> : null}</div> : null}
  </CardContent></Card>;
}
