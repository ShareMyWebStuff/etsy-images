'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Download, FlaskConical, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { OurTemplateImageDefinitionView, TemplateImageDefinitionMode, TemplateImageVariantSlot } from '@/lib/our-template-image-definition-types';
import type { TemplateImageTag } from '@/lib/our-template-image-tag-types';
import { SceneEditor, SceneTest, sceneUrl, type SceneImage } from './SceneImageEditor';
import { TemplateImageTagInput } from './TemplateImageTagInput';

type Definition = OurTemplateImageDefinitionView;
type Child = Definition['images'][number] & { variantSlot?: TemplateImageVariantSlot };
type Impact = { affectedTemplateCount: number; affectedImageTemplateCount: number; affectedListingCount: number };
const endpoint = '/api/our-template-image-definitions';
const modeLabels: Record<TemplateImageDefinitionMode, string> = { 'no-areas': 'No areas', both: 'Both', combined: 'Combined' };
const childSlot = (image: Child): TemplateImageVariantSlot => image.variantSlot ?? (image.openings.length && image.openings.every(area => area.orientation === 'portrait') ? 'portrait'
  : image.openings.length && image.openings.every(area => area.orientation === 'landscape') ? 'landscape' : 'single');
const slotImage = (definition: Definition, slot: TemplateImageVariantSlot) => definition.images.find(image => childSlot(image) === slot) ?? null;
const defaultImage = (definition: Definition) => slotImage(definition, 'portrait') ?? slotImage(definition, 'landscape') ?? definition.images[0] ?? null;
const newest = (definitions: Definition[]) => [...definitions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
const isDefinition = (value: unknown, id: string): value is Definition => !!value && typeof value === 'object'
  && (value as Definition).id === id && Array.isArray((value as Definition).images);
async function json<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'The request could not be completed.');
  return payload as T;
}
function setEditorQuery(id: string | null, returnPath?: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete('edit');
  if (id) url.searchParams.set('definition', id); else url.searchParams.delete('definition');
  if (id && returnPath) url.searchParams.set('returnTo', returnPath);
  if (!id) url.searchParams.delete('returnTo');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function templateReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  const target = new URL(value, window.location.origin);
  if (target.origin !== window.location.origin || !/^\/our-templates\/[1-9]\d*\/edit$/.test(target.pathname)) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}

function editorReturnPath(query: URLSearchParams): string | null {
  if (query.has('returnTo')) return templateReturnPath(query.get('returnTo'));
  if (!document.referrer) return null;
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin !== window.location.origin) return null;
    const target = templateReturnPath(`${referrer.pathname}${referrer.search}${referrer.hash}`);
    if (!target) return null;
    referrer.searchParams.set('tab', 'image-templates');
    return `${referrer.pathname}${referrer.search}${referrer.hash}`;
  } catch { return null; }
}

export function TemplateImageDefinitionsClient() {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [editing, setEditing] = useState<Definition | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tagOptions, setTagOptions] = useState<TemplateImageTag[]>([]);
  const [filterTags, setFilterTags] = useState<TemplateImageTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createMode, setCreateMode] = useState<TemplateImageDefinitionMode>('both');
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Definition | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const lock = useRef(false), mounted = useRef(false), deleteRequest = useRef(0);
  const upsert = (definition: Definition) => setDefinitions(current => newest([...current.filter(item => item.id !== definition.id), definition]));

  async function loadTags() {
    setTagsLoading(true); setTagsError(null);
    try { const data = await json<{ tags: TemplateImageTag[] }>(await fetch('/api/our-template-image-tags')); if (mounted.current) setTagOptions(data.tags ?? []); }
    catch (caught) { if (mounted.current) setTagsError(caught instanceof Error ? caught.message : 'Unable to load tags.'); }
    finally { if (mounted.current) setTagsLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await json<{ definitions: Definition[] }>(await fetch(endpoint, { cache: 'no-store', signal: controller.signal }));
        if (!Array.isArray(data.definitions)) throw new Error('The template image definitions could not be read.');
        if (controller.signal.aborted) return;
        setDefinitions(newest(data.definitions));
        const query = new URLSearchParams(window.location.search), definitionId = query.get('definition'), oldImageId = query.get('edit');
        const selected = data.definitions.find(item => item.id === (definitionId ?? oldImageId))
          ?? (!definitionId && oldImageId ? data.definitions.find(item => item.images.some(image => image.id === oldImageId)) : null);
        if (selected) { const destination = editorReturnPath(query); setReturnTo(destination); setEditing(selected); setEditorQuery(selected.id, destination); }
        else if (definitionId || oldImageId) setError('This template image definition could not be found.');
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load template images.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    void loadTags();
    return () => { mounted.current = false; controller.abort(); deleteRequest.current++; };
  }, []);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return definitions.filter(definition => (!query || `${definition.name}\n${definition.images.map(image => `${image.name}\n${image.originalFileName}\n${image.tags.map(tag => tag.name).join('\n')}`).join('\n')}`.toLocaleLowerCase().includes(query))
      && (!filterTags.length || definition.images.some(image => filterTags.every(tag => image.tags.some(saved => saved.id === tag.id)))));
  }, [definitions, search, filterTags]);

  async function create() {
    if (lock.current || !createName.trim()) return;
    lock.current = true; setBusy(true); setCreateError(null);
    try {
      const data = await json<{ definition: Definition }>(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: createName.trim(), mode: createMode }) }));
      if (!data.definition) throw new Error('The definition could not be created.');
      if (mounted.current) { upsert(data.definition); setCreating(false); setEditing(data.definition); setEditorQuery(data.definition.id); }
    } catch (caught) { if (mounted.current) setCreateError(caught instanceof Error ? caught.message : 'Unable to create the definition.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function checkDelete(definition: Definition) {
    const request = ++deleteRequest.current;
    setDeleting(definition); setImpact(null); setDeleteError(null);
    try { const data = await json<{ impact: Impact }>(await fetch(`${endpoint}/${encodeURIComponent(definition.id)}/impact`)); if (!data.impact) throw new Error('The affected templates could not be checked.'); if (mounted.current && request === deleteRequest.current) setImpact(data.impact); }
    catch (caught) { if (mounted.current && request === deleteRequest.current) setDeleteError(caught instanceof Error ? caught.message : 'Unable to check dependencies.'); }
  }
  function closeDelete() { if (!lock.current) { deleteRequest.current++; setDeleting(null); } }
  async function removeDefinition() {
    if (!deleting || !impact || lock.current) return;
    lock.current = true; setBusy(true); setDeleteError(null);
    try {
      await json(await fetch(`${endpoint}/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' }));
      if (mounted.current) { setDefinitions(current => current.filter(item => item.id !== deleting.id)); setDeleting(null); }
    } catch (caught) { if (mounted.current) setDeleteError(caught instanceof Error ? caught.message : 'Unable to delete the definition.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  if (editing) return <DefinitionEditor key={editing.id} initial={editing} tagOptions={tagOptions} tagsLoading={tagsLoading} tagsError={tagsError}
    onReloadTags={() => { void loadTags(); }} onTagCreated={tag => setTagOptions(current => current.some(item => item.id === tag.id) ? current : [...current, tag])}
    onChanged={upsert} onCancel={() => { if (returnTo) { router.push(returnTo as Route); return; } setEditing(null); setReturnTo(null); setEditorQuery(null); }}
    onSaved={definition => { upsert(definition); setEditing(null); setReturnTo(null); setEditorQuery(null); }} />;
  return <div className="grid gap-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Our Template Images</h1><p className="mt-1 text-sm text-muted-foreground">Create named definitions, then upload their images and artwork areas.</p></div><Button onClick={() => { setCreateName(''); setCreateMode('both'); setCreateError(null); setCreating(true); }}><Plus className="h-4 w-4" aria-hidden="true" />Create template image</Button></div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {tagsError ? <p role="alert" className="text-sm text-destructive">{tagsError} <button className="underline" onClick={() => { void loadTags(); }}>Retry loading tags</button></p> : null}
    {!loading && definitions.length > 0 ? <><div className="flex flex-wrap items-end justify-between gap-3"><label className="grid w-full max-w-md gap-2 text-sm font-medium">Search template images<Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name or PNG filename" /></label><p role="status" className="text-sm text-muted-foreground">Showing {filtered.length} of {definitions.length} template images</p></div><div className="grid max-w-xl gap-1"><TemplateImageTagInput label="Filter by tags" tags={tagOptions} selected={filterTags} onChange={setFilterTags} disabled={tagsLoading} /><p className="text-xs text-muted-foreground">Definitions with an image matching all selected tags.</p></div></> : null}
    {loading ? <p role="status">Loading template images…</p> : definitions.length === 0 ? <p className="rounded-md border p-8 text-center text-muted-foreground">No template images yet. Create a definition to get started.</p> : filtered.length === 0 ? <div className="grid justify-items-center gap-3 rounded-md border p-8 text-center"><p>No template images match your search.</p><Button variant="outline" onClick={() => { setSearch(''); setFilterTags([]); }}>Clear search</Button></div> : <div role="list" aria-label="Template images" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map(definition => <DefinitionCard key={definition.id} definition={definition} onEdit={() => { setEditing(definition); setEditorQuery(definition.id); }} onDelete={() => { void checkDelete(definition); }} />)}</div>}
    <Dialog open={creating} onOpenChange={open => { if (!lock.current) setCreating(open); }}><DialogContent><form className="grid gap-5" onSubmit={event => { event.preventDefault(); void create(); }}><DialogHeader><DialogTitle>Create template image</DialogTitle><DialogDescription>Create the definition first, then upload its images.</DialogDescription></DialogHeader><label className="grid gap-2 text-sm font-medium">Template image name<Input required maxLength={100} value={createName} disabled={busy} onChange={event => setCreateName(event.target.value)} /></label><fieldset className="grid gap-3"><legend className="mb-2 text-sm font-medium">Image type</legend>{(['no-areas', 'both', 'combined'] as const).map(mode => <label key={mode} className="flex items-center gap-2 text-sm"><input type="radio" name="definition-mode" value={mode} checked={createMode === mode} disabled={busy} onChange={() => setCreateMode(mode)} />{modeLabels[mode]}</label>)}</fieldset>{createError ? <p role="alert" className="text-sm text-destructive">{createError}</p> : null}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" disabled={busy || !createName.trim()}>{busy ? 'Creating…' : 'Create'}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={open => { if (!open) closeDelete(); }}><DialogContent><DialogHeader><DialogTitle>Delete {deleting?.name}?</DialogTitle><DialogDescription>{impact ? `This definition is used by ${impact.affectedTemplateCount} template(s), including ${impact.affectedImageTemplateCount} image reference(s), and ${impact.affectedListingCount} listing(s). Deleting removes its references and marks affected listings for image regeneration. Images shared with other definitions are kept.` : 'Checking affected templates and listings…'}</DialogDescription></DialogHeader>{deleteError ? <p role="alert" className="text-sm text-destructive">{deleteError}</p> : null}<DialogFooter><Button variant="outline" disabled={busy} onClick={closeDelete}>Cancel</Button><Button variant="destructive" disabled={busy || !impact} onClick={() => { void removeDefinition(); }}>{busy ? 'Deleting…' : 'Delete template image'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function DefinitionCard({ definition, onEdit, onDelete }: { definition: Definition; onEdit(): void; onDelete(): void }) {
  const [activeId, setActiveId] = useState(defaultImage(definition)?.id ?? '');
  const active = definition.images.find(image => image.id === activeId) ?? defaultImage(definition);
  return <Card role="listitem"><CardContent className="grid gap-3 pt-5"><div><h2 className="font-semibold">{definition.name}</h2><span className="text-xs text-muted-foreground">{modeLabels[definition.mode]}</span></div>{active ? <img src={sceneUrl(active, true)} alt={definition.name} width={active.width} height={active.height} loading="lazy" decoding="async" className="h-48 w-full rounded-md bg-muted object-contain" /> : <p className="grid h-48 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">No images uploaded</p>}{slotImage(definition, 'portrait') && slotImage(definition, 'landscape') ? <div className="flex gap-2" role="group" aria-label={`Preview orientation for ${definition.name}`}>{(['portrait', 'landscape'] as const).map(slot => <Button key={slot} size="sm" variant={childSlot(active!) === slot ? 'default' : 'outline'} aria-pressed={childSlot(active!) === slot} onClick={() => setActiveId(slotImage(definition, slot)!.id)}>{slot === 'portrait' ? 'Portrait' : 'Landscape'}</Button>)}</div> : null}{active ? <><p className="text-xs text-muted-foreground">{active.openings.length} area{active.openings.length === 1 ? '' : 's'}</p>{active.tags?.length ? <div className="flex flex-wrap gap-1">{active.tags.map(tag => <span key={tag.id} className="rounded-full bg-muted px-2 py-1 text-xs">{tag.name}</span>)}</div> : null}</> : null}<div className="flex flex-wrap gap-2"><Button variant="outline" aria-label={`Edit ${definition.name}`} onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>{active ? <Button asChild variant="outline" size="icon"><a href={`${sceneUrl(active)}&download=1`} download={active.originalFileName || `${active.name}.png`} aria-label={`Download ${definition.name}`}><Download className="h-4 w-4" aria-hidden="true" /></a></Button> : <Button variant="outline" size="icon" disabled aria-label={`Download ${definition.name}`}><Download className="h-4 w-4" aria-hidden="true" /></Button>}<Button variant="outline" size="icon" aria-label={`Delete ${definition.name}`} onClick={onDelete}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></div></CardContent></Card>;
}

function DefinitionEditor({ initial, tagOptions, tagsLoading, tagsError, onReloadTags, onTagCreated, onChanged, onCancel, onSaved }: {
  initial: Definition; tagOptions: TemplateImageTag[]; tagsLoading: boolean; tagsError: string | null;
  onReloadTags(): void; onTagCreated(tag: TemplateImageTag): void; onChanged(definition: Definition): void; onCancel(): void; onSaved(definition: Definition): void;
}) {
  const [definition, setDefinition] = useState(initial), [name, setName] = useState(initial.name);
  const [editing, setEditing] = useState<{ slot: TemplateImageVariantSlot; image: Child | null } | null>(null);
  const [testing, setTesting] = useState<Child | null>(null), [deleting, setDeleting] = useState<Child | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const lock = useRef(false), mounted = useRef(true), reloadRequest = useRef(0), latestDefinition = useRef(initial);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; reloadRequest.current++; }; }, []);
  function update(next: Definition) { reloadRequest.current++; latestDefinition.current = next; setDefinition(next); onChanged(next); }
  async function reload() {
    const request = ++reloadRequest.current, id = latestDefinition.current.id;
    try {
      const data = await json<{ definition: Definition }>(await fetch(`${endpoint}/${encodeURIComponent(id)}`, { cache: 'no-store' }));
      if (!mounted.current || request !== reloadRequest.current) return;
      if (!isDefinition(data.definition, id)) throw new Error('The template image definition could not be reloaded.');
      update(data.definition); setError(null);
    }
    catch (caught) { if (mounted.current && request === reloadRequest.current) setError(caught instanceof Error ? caught.message : 'The image was saved, but the definition could not be refreshed.'); }
  }
  async function saveName() {
    if (!name.trim() || lock.current) return;
    lock.current = true; reloadRequest.current++; setBusy(true); setError(null);
    try { const data = await json<{ definition: Definition }>(await fetch(`${endpoint}/${encodeURIComponent(definition.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })); if (mounted.current) onSaved(data.definition); }
    catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : 'Unable to save the template image definition.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function deleteImage() {
    if (!deleting || lock.current) return;
    const imageId = deleting.id, definitionId = definition.id;
    lock.current = true; reloadRequest.current++; setBusy(true); setError(null);
    try {
      const data = await json<{ definition?: Definition | null; deletedId?: string; definitionId?: string; refreshError?: string }>(await fetch(`${endpoint}/${encodeURIComponent(definitionId)}/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' }));
      if (!mounted.current) return;
      const refreshed = isDefinition(data.definition, definitionId);
      if (!refreshed && (data.deletedId !== imageId || data.definitionId !== definitionId)) throw new Error('The image removal could not be confirmed. Reload uploaded images to check its status.');
      update(refreshed ? data.definition! : { ...latestDefinition.current, images: latestDefinition.current.images.filter(image => image.id !== imageId) });
      setDeleting(null); setError(data.refreshError ?? null);
      if (!refreshed) void reload();
    }
    catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : 'Unable to remove the image.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  if (editing) return <SceneEditor key={`${definition.id}:${editing.slot}:${editing.image?.id ?? 'new'}`} initial={editing.image}
    childContext={{ parentDefinitionId: definition.id, mode: definition.mode, variantSlot: editing.slot }}
    defaultName={`${definition.name}${editing.slot === 'single' ? '' : editing.slot === 'portrait' ? ' — Portrait' : ' — Landscape'}`}
    tagOptions={tagOptions} tagsLoading={tagsLoading} tagsError={tagsError} onReloadTags={onReloadTags} onTagCreated={onTagCreated}
    onCancel={() => setEditing(null)} onSaved={image => { const next = { ...definition, images: [...definition.images.filter(saved => childSlot(saved) !== editing.slot), { ...image, variantSlot: editing.slot } as Child] }; update(next); setEditing(null); void reload(); }} />;
  return <div className="grid gap-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="mb-2 inline-block rounded-full border px-3 py-1 text-sm font-medium">{modeLabels[definition.mode]}</span><h1 className="text-2xl font-semibold">{definition.name}</h1></div><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={onCancel}>Back</Button><Button disabled={busy || !name.trim()} onClick={() => { void saveName(); }}><Save className="h-4 w-4" aria-hidden="true" />{busy ? 'Saving…' : 'Save Image Template'}</Button></div></div>
    {error ? <p role="alert" className="text-sm text-destructive">{error} <button className="underline" onClick={() => { void reload(); }}>Reload uploaded images</button></p> : null}
    <label className="grid max-w-xl gap-2 text-sm font-medium">Template Image Name<Input value={name} maxLength={100} disabled={busy} onChange={event => setName(event.target.value)} /></label>
    <p className="text-sm text-muted-foreground">Image uploads and edits are saved when you save each image. Going back discards an unsaved name change; uploaded images and this definition are kept. Editing a shared image updates every definition that uses it.</p>
    <div className="flex flex-wrap gap-3">{(definition.mode === 'both' ? ['portrait', 'landscape'] as const : ['single'] as const).map(slot => <Button key={slot} disabled={busy || (slot !== 'single' && Boolean(slotImage(definition, slot)))} onClick={() => setEditing({ slot, image: slotImage(definition, slot) })}><Plus className="h-4 w-4" aria-hidden="true" />{slot === 'single' ? 'Select Image' : slot === 'portrait' ? 'Load Portrait' : 'Load Landscape'}</Button>)}</div>
    {definition.images.length ? <div className="grid gap-4 md:grid-cols-2">{definition.images.map(image => <Card key={`${childSlot(image)}:${image.id}`}><CardContent className="grid gap-3 pt-5"><div><h2 className="font-semibold">{image.name}</h2><p className="text-sm text-muted-foreground">{definition.mode === 'both' ? childSlot(image) === 'landscape' ? 'Landscape' : 'Portrait' : modeLabels[definition.mode]}</p></div><img src={sceneUrl(image, true)} alt={image.name} width={image.width} height={image.height} loading="lazy" decoding="async" className="h-48 w-full rounded bg-muted object-contain" /><p className="text-sm text-muted-foreground">{image.openings.length} area{image.openings.length === 1 ? '' : 's'} · {new Set(image.openings.map(area => area.imageItemNumber)).size} artwork item{new Set(image.openings.map(area => area.imageItemNumber)).size === 1 ? '' : 's'}</p>{image.tags?.length ? <div className="flex flex-wrap gap-1">{image.tags.map(tag => <span key={tag.id} className="rounded-full bg-muted px-2 py-1 text-xs">{tag.name}</span>)}</div> : null}<div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="icon"><a href={`${sceneUrl(image)}&download=1`} download={image.originalFileName} aria-label={`Download image ${image.name}`}><Download className="h-4 w-4" aria-hidden="true" /></a></Button><Button variant="outline" aria-label={`Test image ${image.name}`} disabled={busy} onClick={() => setTesting(image)}><FlaskConical className="h-4 w-4" aria-hidden="true" />Test</Button><Button variant="outline" size="icon" aria-label={`Delete image ${image.name}`} disabled={busy} onClick={() => { setError(null); setDeleting(image); }}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button><Button variant="outline" aria-label={`Edit image ${image.name}`} disabled={busy} onClick={() => setEditing({ slot: childSlot(image), image })}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button></div></CardContent></Card>)}</div> : <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">No images uploaded yet. This empty definition is saved.</p>}
    {testing ? <SceneTest scene={testing} childContext={{ parentDefinitionId: definition.id, mode: definition.mode, variantSlot: childSlot(testing) }} onClose={() => setTesting(null)} onFitted={image => { update({ ...definition, images: definition.images.map(saved => saved.id === image.id ? { ...saved, ...image } : saved) }); setTesting(current => current ? { ...current, ...image } : null); }} /> : null}
    <Dialog open={!!deleting} onOpenChange={open => { if (!open && !lock.current) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Delete image {deleting?.name}?</DialogTitle><DialogDescription>Remove this image from {definition.name}? The definition and its other images are kept. Images shared with other definitions are kept, and affected listings will need image regeneration.</DialogDescription></DialogHeader>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => { void deleteImage(); }}>{busy ? 'Deleting…' : 'Delete image'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
