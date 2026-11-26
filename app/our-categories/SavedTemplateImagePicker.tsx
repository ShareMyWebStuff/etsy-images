'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { OurCategoryFormValues, OurCategoryImageTemplateView } from '@/lib/our-categories';
import type { OurTemplateImageDefinitionView } from '@/lib/our-template-image-definition-types';
import { TemplateImageTagInput } from '@/app/our-template-images/TemplateImageTagInput';
import type { TemplateImageTag } from '@/lib/our-template-image-tag-types';

type Definition = OurTemplateImageDefinitionView;
const modeLabels = { 'no-areas': 'No areas', both: 'Both', combined: 'Combined' };
const allTags = (definition: Definition) => [...new Map(definition.images.flatMap(image => image.tags ?? []).map(tag => [tag.id, tag])).values()];
const previewImage = (definition: Definition) => definition.images.find(image => image.variantSlot === 'portrait')
  ?? definition.images.find(image => image.openings.length && image.openings.every(area => area.orientation === 'portrait')) ?? definition.images[0];

export function SavedTemplateImagePicker({ categoryId, values, onClose, onAttached }: {
  categoryId: string; values: OurCategoryFormValues; onClose(): void; onAttached(template: OurCategoryImageTemplateView): void;
}) {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [tags, setTags] = useState<TemplateImageTag[]>([]), [selectedTags, setSelectedTags] = useState<TemplateImageTag[]>([]);
  const [mode, setMode] = useState<'all' | 'tags'>('all'), [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState('');
  const [description, setDescription] = useState('');
  const [uses, setUses] = useState({ useOnPrints: values.printsFrames, useOnCustomised: values.customisePrints, useOnDigital: values.digitalDownload });
  const [error, setError] = useState<string | null>(null), [loadError, setLoadError] = useState<string | null>(null), [tagsError, setTagsError] = useState<string | null>(null);
  const [tagsLoading, setTagsLoading] = useState(true), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const locked = useRef(false), mounted = useRef(false), scope = useRef(categoryId); scope.current = categoryId;
  const visible = useMemo(() => {
    const nameQuery = query.trim().toLocaleLowerCase();
    return definitions.filter(definition => (!nameQuery || definition.name.toLocaleLowerCase().includes(nameQuery))
      && (mode !== 'tags' || selectedTags.every(tag => allTags(definition).some(saved => saved.id === tag.id))));
  }, [definitions, query, mode, selectedTags]);
  const selected = visible.find(definition => definition.id === selectedId);
  const artworkItems = selected ? new Set(selected.images.flatMap(image => image.openings.map(area => area.imageItemNumber))).size : 0;
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const loadDefinitions = fetch('/api/our-template-image-definitions', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load template image definitions.');
      if (!Array.isArray(payload.definitions)) throw new Error('The template image definitions could not be read.');
      if (!controller.signal.aborted) setDefinitions(payload.definitions);
    }).catch(caught => { if (!controller.signal.aborted) setLoadError(caught.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const loadTags = fetch('/api/our-template-image-tags', { signal: controller.signal }).then(async response => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load saved tags.');
      if (!controller.signal.aborted) setTags(payload.tags ?? []);
    }).catch(caught => { if (!controller.signal.aborted) setTagsError(caught.message); }).finally(() => { if (!controller.signal.aborted) setTagsLoading(false); });
    void Promise.allSettled([loadDefinitions, loadTags]);
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  useEffect(() => { if (selectedId && !selected) { setSelectedId(''); setDescription(''); setError(null); } }, [selectedId, selected]);
  function clearSelection() { setSelectedId(''); setDescription(''); setError(null); }
  function chooseMode(next: 'all' | 'tags') { if (next !== mode) { setMode(next); setSelectedTags([]); clearSelection(); } }
  async function attach() {
    if (!selected || !Object.values(uses).some(Boolean) || locked.current) return;
    const requestScope = categoryId;
    locked.current = true; setBusy(true); setError(null);
    try {
      const form = new FormData(); form.set('templateImageDefinitionId', selected.id); form.set('name', selected.name); form.set('description', description);
      for (const [key, enabled] of Object.entries(uses)) form.set(key, String(enabled));
      const response = await fetch(`/api/our-categories/${encodeURIComponent(categoryId)}/templates`, { method: 'POST', body: form });
      const payload = await response.json(); if (!response.ok || !payload.template) throw new Error(payload.error ?? 'Unable to add this template image.');
      if (mounted.current && scope.current === requestScope) onAttached(payload.template);
    } catch (caught) { if (mounted.current && scope.current === requestScope) setError(caught instanceof Error ? caught.message : 'Unable to add the template image.'); }
    finally { locked.current = false; if (mounted.current && scope.current === requestScope) setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !locked.current) onClose(); }}>
    <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Add Our Template Image</DialogTitle><DialogDescription>Choose a saved definition. Its No areas, Both or Combined type determines which images and artwork assignments are used during listing generation.</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Template image browse mode"><Button variant={mode === 'all' ? 'default' : 'outline'} aria-pressed={mode === 'all'} disabled={busy} onClick={() => chooseMode('all')}>Browse all</Button><Button variant={mode === 'tags' ? 'default' : 'outline'} aria-pressed={mode === 'tags'} disabled={busy} onClick={() => chooseMode('tags')}>Search by tags</Button></div>
      <label className="grid gap-2 text-sm font-medium">Search template images by name<Input type="search" value={query} disabled={busy} placeholder="Search definitions" onChange={event => setQuery(event.target.value)} /></label>
      {mode === 'tags' ? <div className="grid gap-2"><TemplateImageTagInput label="Filter template images by tags" tags={tags} selected={selectedTags} onChange={setSelectedTags} disabled={busy || tagsLoading || !!tagsError} allowCreate={false} /><p className="text-xs text-muted-foreground">Matches all selected tags across the definition's images. Name search also applies.</p>{tagsLoading ? <p className="text-sm text-muted-foreground">Loading tags...</p> : null}{tagsError ? <p role="alert" className="text-sm text-destructive">{tagsError} You can still browse all definitions.</p> : null}</div> : null}
      {loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : null}
      <div className="grid gap-2"><p role="status" className="text-sm text-muted-foreground">{loading ? 'Loading saved definitions...' : `${visible.length} of ${definitions.length} template images shown`}</p>
        <div role="region" aria-label="Saved template image definitions" tabIndex={0} className="max-h-[min(42vh,420px)] min-h-40 overflow-y-auto rounded-md border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {!loading && !loadError && !definitions.length ? <p className="p-5 text-center text-sm text-muted-foreground">No saved definitions yet. <a className="underline" href="/our-template-images">Create a template image</a> first.</p> : null}
          {!loading && definitions.length > 0 && !visible.length ? <div className="grid justify-items-center gap-3 p-5 text-center text-sm text-muted-foreground"><p>No template images match these filters.</p><Button variant="outline" disabled={busy} onClick={() => { setQuery(''); setSelectedTags([]); clearSelection(); }}>Clear filters</Button></div> : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{visible.map(definition => { const preview = previewImage(definition); return <button key={definition.id} type="button" aria-label={`Select ${definition.name}`} aria-pressed={selectedId === definition.id} disabled={busy}
            onClick={() => { setSelectedId(definition.id); setDescription(`Template image: ${definition.name}`); setError(null); }}
            className={`relative grid content-start gap-2 rounded-md border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${selectedId === definition.id ? 'border-primary bg-accent ring-2 ring-primary' : 'bg-background hover:bg-accent/50'}`}>
            <span className="break-words pr-6 text-sm font-semibold">{definition.name}</span>
            {preview ? <img alt={definition.name} width={preview.width} height={preview.height} loading="lazy" decoding="async" className="h-28 w-full rounded bg-muted object-contain sm:h-36" src={`/api/our-template-images/${encodeURIComponent(preview.id)}/image?preview=1&v=${encodeURIComponent(preview.updatedAt)}`} /> : <span className="grid h-28 place-items-center rounded border border-dashed text-xs text-muted-foreground sm:h-36">No images uploaded</span>}
            <span className="text-xs text-muted-foreground">{modeLabels[definition.mode]} - {definition.images.length} image{definition.images.length === 1 ? '' : 's'}</span>
            {allTags(definition).length ? <span className="flex flex-wrap gap-1">{allTags(definition).map(tag => <span key={tag.id} className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">{tag.name}</span>)}</span> : null}
            {selectedId === definition.id ? <span className="absolute right-3 top-3 rounded-full bg-primary p-1 text-primary-foreground" aria-hidden="true"><Check className="h-4 w-4" /></span> : null}
          </button>; })}</div>
        </div>
      </div>
      {selected ? <div className="grid gap-4 rounded-md border p-4"><p className="text-sm font-semibold">Selected: {selected.name}</p>
        <label className="grid gap-2 text-sm font-medium">Description<textarea aria-label="Description" maxLength={500} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
        {!selected.images.length ? <p className="text-sm text-amber-700">This definition has no images yet. It can be added now; complete it before generating listing images.</p> : artworkItems > 1 ? <p className="text-sm text-muted-foreground">This definition uses {artworkItems} distinct artwork items. Choose their listings in each listing editor before generation.</p> : <p className="text-sm text-muted-foreground">{selected.mode === 'no-areas' ? 'Uses the uploaded image without artwork areas.' : 'The current listing supplies its artwork automatically.'}</p>}
        <div className="flex flex-wrap gap-4">{([['useOnPrints', 'Prints', values.printsFrames], ['useOnCustomised', 'Customised prints', values.customisePrints], ['useOnDigital', 'Digital downloads', values.digitalDownload]] as const).filter(([, , enabled]) => enabled).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={uses[key]} disabled={busy} onChange={event => setUses(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</div>
      </div> : <p className="text-sm text-muted-foreground">Choose a thumbnail to select the template image definition.</p>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !selected || !Object.values(uses).some(Boolean)} onClick={() => { void attach(); }}>{busy ? 'Adding...' : 'Add template image'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
