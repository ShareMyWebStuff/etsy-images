'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { MAX_TEMPLATE_IMAGE_TAGS, type TemplateImageTag } from '@/lib/our-template-image-tag-types';

export type TemplateImageTagInputProps = {
  label?: string;
  tags: TemplateImageTag[];
  selected: TemplateImageTag[];
  onChange(selected: TemplateImageTag[]): void;
  disabled?: boolean;
  allowCreate?: boolean;
  onCreated?(tag: TemplateImageTag): void;
  onBusyChange?(busy: boolean): void;
};

type TagOption = { kind: 'tag'; tag: TemplateImageTag } | { kind: 'create'; name: string };
const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function TemplateImageTagInput({ label = 'Tags', tags, selected, onChange, disabled = false, allowCreate = false, onCreated, onBusyChange }: TemplateImageTagInputProps) {
  const id = useId(), inputId = `${id}-input`, listId = `${id}-options`, countId = `${id}-count`, errorId = `${id}-error`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [created, setCreated] = useState<TemplateImageTag[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef(selected), disabledRef = useRef(disabled), createLock = useRef(false), mounted = useRef(true);
  const busyChangeRef = useRef(onBusyChange); busyChangeRef.current = onBusyChange;
  selectedRef.current = selected; disabledRef.current = disabled;
  const atLimit = selected.length >= MAX_TEMPLATE_IMAGE_TAGS;

  const catalogue = useMemo(() => {
    const ids = new Set<string>(), names = new Set<string>();
    return [...tags, ...created].filter((tag) => {
      const key = nameKey(tag.name);
      if (ids.has(tag.id) || names.has(key)) return false;
      ids.add(tag.id); names.add(key); return true;
    });
  }, [tags, created]);
  const options = useMemo<TagOption[]>(() => {
    const key = nameKey(query), selectedIds = new Set(selected.map((tag) => tag.id)), selectedNames = new Set(selected.map((tag) => nameKey(tag.name)));
    const matches: TagOption[] = catalogue.filter((tag) => !selectedIds.has(tag.id) && !selectedNames.has(nameKey(tag.name)) && nameKey(tag.name).includes(key))
      .map((tag) => ({ kind: 'tag', tag }));
    if (allowCreate && key && !catalogue.some((tag) => nameKey(tag.name) === key) && !selectedNames.has(key)) matches.push({ kind: 'create', name: query.trim().replace(/\s+/g, ' ') });
    return matches;
  }, [allowCreate, catalogue, query, selected]);
  const showingOptions = open && !disabled && !atLimit;
  const active = activeIndex < 0 ? -1 : Math.min(activeIndex, options.length - 1);

  useEffect(() => {
    mounted.current = true;
    const outside = (event: globalThis.PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => { mounted.current = false; document.removeEventListener('pointerdown', outside); };
  }, []);
  useEffect(() => {
    if (showingOptions && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id, showingOptions]);

  function addTag(tag: TemplateImageTag) {
    const current = selectedRef.current;
    if (disabledRef.current || current.some((value) => value.id === tag.id || nameKey(value.name) === nameKey(tag.name))) return;
    if (current.length >= MAX_TEMPLATE_IMAGE_TAGS) { setError(`Remove a selected tag before adding another. You can choose up to ${MAX_TEMPLATE_IMAGE_TAGS} tags.`); return; }
    const next = [...current, tag]; selectedRef.current = next; onChange(next);
    setQuery(''); setActiveIndex(-1); setOpen(false); setError('');
  }

  async function createTag(name: string) {
    if (createLock.current || disabledRef.current || selectedRef.current.length >= MAX_TEMPLATE_IMAGE_TAGS) return;
    createLock.current = true; setCreating(true); setError('');
    try {
      busyChangeRef.current?.(true);
      const response = await fetch('/api/our-template-image-tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to create this tag. Try again.');
      const tag = payload?.tag as TemplateImageTag | undefined;
      if (!tag || typeof tag.id !== 'string' || !tag.id || typeof tag.name !== 'string' || !tag.name.trim()) throw new Error('The new tag could not be read. Try again.');
      if (!mounted.current) return;
      setCreated((current) => current.some((value) => value.id === tag.id) ? current : [...current, tag]);
      onCreated?.(tag);
      addTag(tag);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'Unable to create this tag. Try again.');
    } finally {
      createLock.current = false;
      if (mounted.current) setCreating(false);
      busyChangeRef.current?.(false);
    }
  }

  function choose(option: TagOption) {
    if (disabledRef.current || createLock.current) return;
    if (option.kind === 'create') void createTag(option.name);
    else addTag(option.tag);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // This picker is often inside the scene editor's form.
      event.preventDefault();
      if (!creating && showingOptions && options.length) choose(options[active < 0 ? 0 : active]);
      return;
    }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !creating) {
      event.preventDefault(); setOpen(true);
      if (!options.length) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(!showingOptions || active < 0 ? direction > 0 ? 0 : options.length - 1 : (active + direction + options.length) % options.length);
    }
  }

  return <div ref={rootRef} className="grid gap-2" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <label htmlFor={inputId} className="text-sm font-medium">{label}</label>
    {selected.length ? <ul aria-label={`Selected ${label.toLowerCase()}`} className="flex flex-wrap gap-2">{selected.map((tag) => <li key={tag.id} className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-sm">
      <span>{tag.name}</span><button type="button" aria-label={`Remove tag ${tag.name}`} disabled={disabled || creating} className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={() => {
        const next = selectedRef.current.filter((value) => value.id !== tag.id); selectedRef.current = next; onChange(next); setError('');
      }}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
    </li>)}</ul> : null}
    <div className="relative">
      <Input ref={inputRef} id={inputId} role="combobox" aria-autocomplete="list" aria-expanded={showingOptions} aria-controls={showingOptions ? listId : undefined}
        aria-activedescendant={showingOptions && active >= 0 ? `${id}-option-${active}` : undefined} aria-describedby={`${countId}${error ? ` ${errorId}` : ''}`} aria-busy={creating}
        placeholder="Type to find a tag" autoComplete="off" value={query} disabled={disabled || atLimit} readOnly={creating}
        onFocus={() => { setOpen(true); setActiveIndex(query.trim() ? 0 : -1); }} onKeyDown={handleKey}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); setError(''); }} />
      {showingOptions ? <div id={listId} role="listbox" aria-label={`${label} suggestions`} className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        {options.length ? options.map((option, index) => <button key={option.kind === 'tag' ? option.tag.id : 'create'} type="button" id={`${id}-option-${index}`} role="option" aria-selected={index === active}
          tabIndex={-1}
          disabled={creating} className={`block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${index === active ? 'bg-accent text-accent-foreground' : ''}`}
          onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>
          {option.kind === 'tag' ? option.tag.name : `Create tag "${option.name}"`}
        </button>) : <p className="px-3 py-2 text-sm text-muted-foreground">No matching tags.</p>}
      </div> : null}
    </div>
    <p id={countId} className="text-xs text-muted-foreground">{selected.length} of {MAX_TEMPLATE_IMAGE_TAGS} tags{atLimit ? '. Remove a tag to add another.' : ''}</p>
    {creating ? <p role="status" className="text-xs text-muted-foreground">Creating tag…</p> : null}
    {error ? <p id={errorId} role="alert" className="text-sm text-red-700">{error}</p> : null}
  </div>;
}
