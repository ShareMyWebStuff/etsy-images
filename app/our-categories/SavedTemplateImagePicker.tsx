'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { OurCategoryFormValues, OurCategoryImageTemplateView } from '@/lib/our-categories';
import type { SceneImage } from '@/app/our-template-images/OurTemplateImagesClient';
import { TemplateImageTagInput } from '@/app/our-template-images/TemplateImageTagInput';
import type { TemplateImageTag } from '@/lib/our-template-image-tag-types';

type PickerSceneImage = SceneImage & { tags?: TemplateImageTag[] };

export function SavedTemplateImagePicker({ categoryId, values, onClose, onAttached }: {
  categoryId: string;
  values: OurCategoryFormValues;
  onClose(): void;
  onAttached(template: OurCategoryImageTemplateView): void;
}) {
  const [images, setImages] = useState<PickerSceneImage[]>([]);
  const [tags, setTags] = useState<TemplateImageTag[]>([]);
  const [selectedTags, setSelectedTags] = useState<TemplateImageTag[]>([]);
  const [mode, setMode] = useState<'all' | 'tags'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [uses, setUses] = useState({ useOnPrints: values.printsFrames, useOnCustomised: values.customisePrints, useOnDigital: values.digitalDownload });
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const visibleImages = useMemo(() => {
    const nameQuery = query.trim().toLocaleLowerCase();
    return images.filter((image) => (!nameQuery || image.name.toLocaleLowerCase().includes(nameQuery))
      && (mode !== 'tags' || selectedTags.every((tag) => image.tags?.some((saved) => saved.id === tag.id))));
  }, [images, query, mode, selectedTags]);
  const scene = visibleImages.find((image) => image.id === selected);
  const maxItem = scene ? Math.max(0, ...scene.openings.map((opening) => opening.imageItemNumber)) : 0;
  useEffect(() => {
    let mounted = true;
    const loadImages = fetch('/api/our-template-images').then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load saved scenes.'); return payload.images as PickerSceneImage[]; })
      .then((data) => { if (mounted) setImages(data); }).catch((caught) => { if (mounted) setLoadError(caught.message); }).finally(() => { if (mounted) setLoading(false); });
    const loadTags = fetch('/api/our-template-image-tags').then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Unable to load saved tags.'); return payload.tags as TemplateImageTag[]; })
      .then((data) => { if (mounted) setTags(data); }).catch((caught) => { if (mounted) setTagsError(caught.message); }).finally(() => { if (mounted) setTagsLoading(false); });
    void Promise.allSettled([loadImages, loadTags]);
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (selected && !scene) { setSelected(''); setName(''); setError(null); }
  }, [selected, scene]);

  function chooseMode(next: 'all' | 'tags') {
    if (mode === next) return;
    setMode(next); setSelectedTags([]); setSelected(''); setName(''); setError(null);
  }

  function clearFilters() { setQuery(''); setSelectedTags([]); setSelected(''); setName(''); setError(null); }
  async function attach() {
    if (!scene || maxItem > values.itemCount || !Object.values(uses).some(Boolean)) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData(); form.set('ourTemplateImageId', scene.id); form.set('name', name.trim() || scene.name); form.set('description', `Room scene: ${scene.name}`);
      for (const [key, enabled] of Object.entries(uses)) form.set(key, String(enabled));
      const response = await fetch(`/api/our-categories/${encodeURIComponent(categoryId)}/templates`, { method: 'POST', body: form });
      const payload = await response.json(); if (!response.ok || !payload.template) throw new Error(payload.error ?? 'Unable to add this scene.');
      onAttached(payload.template);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to add the scene.'); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add Our Template Image</DialogTitle>
        <DialogDescription>Choose a saved room scene. Listing generation uses its openings, artwork assignments, paper placements and lighting. Scene edits apply to every template that uses it.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Template image browse mode">
        <Button type="button" variant={mode === 'all' ? 'default' : 'outline'} aria-pressed={mode === 'all'} disabled={busy} onClick={() => chooseMode('all')}>Browse all</Button>
        <Button type="button" variant={mode === 'tags' ? 'default' : 'outline'} aria-pressed={mode === 'tags'} disabled={busy} onClick={() => chooseMode('tags')}>Search by tags</Button>
      </div>

      <label className="grid gap-2 text-sm font-medium">
        Search template images by name
        <Input type="search" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} placeholder="Search room names" />
      </label>
      {mode === 'tags' ? <div className="grid gap-2">
        <TemplateImageTagInput label="Filter template images by tags" tags={tags} selected={selectedTags} onChange={setSelectedTags} disabled={busy || tagsLoading || !!tagsError} allowCreate={false} />
        <p className="text-xs text-muted-foreground">Matches all selected tags. Name search also applies.</p>
        {tagsLoading ? <p className="text-sm text-muted-foreground">Loading tags…</p> : null}
        {tagsError ? <p role="alert" className="text-sm text-red-700">{tagsError} You can still browse all scenes.</p> : null}
      </div> : null}

      {loadError ? <p role="alert" className="text-sm text-red-700">{loadError}</p> : null}
      <div className="grid gap-2">
        <p role="status" className="text-sm text-muted-foreground">{loading ? 'Loading saved scenes…' : `${visibleImages.length} of ${images.length} template images shown`}</p>
        <div role="region" aria-label="Saved room scene results" tabIndex={0} className="max-h-[min(42vh,420px)] min-h-40 overflow-y-auto rounded-md border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {!loading && !loadError && images.length === 0 ? <p className="p-5 text-center text-sm text-muted-foreground">No saved scenes yet. <a className="underline" href="/our-template-images">Create a template image</a> first.</p> : null}
          {!loading && images.length > 0 && visibleImages.length === 0 ? <div className="grid justify-items-center gap-3 p-5 text-center text-sm text-muted-foreground"><p>No template images match these filters.</p><Button type="button" variant="outline" disabled={busy} onClick={clearFilters}>Clear filters</Button></div> : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {visibleImages.map((image) => <button key={image.id} type="button" aria-label={`Select ${image.name}`} aria-pressed={selected === image.id} disabled={busy}
              onClick={() => { setSelected(image.id); setName(''); setError(null); }}
              className={`relative grid content-start gap-2 rounded-md border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${selected === image.id ? 'border-primary bg-accent ring-2 ring-primary' : 'bg-background hover:bg-accent/50'}`}>
              <img alt={image.name} width={image.width} height={image.height} loading="lazy" decoding="async" className="h-28 w-full rounded bg-muted object-contain sm:h-36"
                src={`/api/our-template-images/${encodeURIComponent(image.id)}/image?preview=1&v=${encodeURIComponent(image.updatedAt)}`} />
              <span className="break-words text-sm font-semibold">{image.name}</span>
              <span className="text-xs text-muted-foreground">{image.openings.length} opening{image.openings.length === 1 ? '' : 's'}</span>
              {image.tags?.length ? <span className="flex flex-wrap gap-1">{image.tags.map((tag) => <span key={tag.id} className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">{tag.name}</span>)}</span> : null}
              {selected === image.id ? <span className="absolute right-3 top-3 rounded-full bg-primary p-1 text-primary-foreground" aria-hidden="true"><Check className="h-4 w-4" /></span> : null}
            </button>)}
          </div>
        </div>
      </div>

      {scene ? <div className="grid gap-4 rounded-md border p-4">
        <p className="text-sm font-semibold">Selected: {scene.name}</p>
        <label className="grid gap-2 text-sm font-medium">Image template name<Input value={name} placeholder={scene.name} maxLength={100} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        <p className="text-sm text-muted-foreground">{scene.openings.map((opening) => `${opening.name}: artwork ${opening.imageItemNumber}`).join(' · ')}</p>
        {maxItem > values.itemCount ? <p role="alert" className="text-sm text-red-700">This scene uses artwork item {maxItem}, but this template has {values.itemCount} item(s). Change the scene assignments or choose a template with enough artwork items.</p> : null}
        <div className="flex flex-wrap gap-4">
          {([['useOnPrints', 'Prints', values.printsFrames], ['useOnCustomised', 'Customised prints', values.customisePrints], ['useOnDigital', 'Digital downloads', values.digitalDownload]] as const).filter(([, , enabled]) => enabled).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={uses[key]} disabled={busy} onChange={(event) => setUses({ ...uses, [key]: event.target.checked })} />{label}</label>)}
        </div>
      </div> : <p className="text-sm text-muted-foreground">Choose a thumbnail to select the room scene.</p>}

      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={busy || !scene || maxItem > values.itemCount || !Object.values(uses).some(Boolean)} onClick={() => { void attach(); }}>{busy ? 'Adding…' : 'Add scene to template'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
