'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ChevronDown, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { OurCategoryListRow } from '@/lib/our-categories';

function TemplateSearchSelect({ label, options, value, onChange, disabled }: {
  label: string;
  options: OurCategoryListRow[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.id === value);
  const filtered = options.filter((option) => option.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function choose(option: OurCategoryListRow) {
    onChange(option.id);
    setQuery('');
    setOpen(false);
  }
  return <div className="relative grid gap-2" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(''); }
  }}>
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${id}-options`}
        aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${filtered[activeIndex].id}` : undefined}
        placeholder="Search templates..."
        className="pr-10"
        value={open ? query : selected?.name ?? ''}
        disabled={disabled}
        onFocus={() => { setOpen(true); setQuery(''); setActiveIndex(0); }}
        onClick={() => setOpen(true)}
        onChange={(event) => { onChange(''); setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (filtered[activeIndex]) choose(filtered[activeIndex]);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery('');
          }
        }}
      />
      <button type="button" className="absolute inset-y-0 right-0 px-3" aria-label={`Toggle ${label} templates`} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(!open); setQuery(''); setActiveIndex(0); }}>
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
    {open ? <div id={`${id}-options`} role="listbox" aria-label={`${label} templates`} className="absolute top-full z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {filtered.length ? filtered.map((option, index) => <div
        key={option.id} id={`${id}-option-${option.id}`} role="option" aria-selected={option.id === value}
        className={`cursor-pointer rounded-sm px-3 py-2 text-sm ${index === activeIndex ? 'bg-accent text-accent-foreground' : ''}`}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}
      >{option.name}</div>) : <p className="px-3 py-2 text-sm text-muted-foreground">No matching templates.</p>}
    </div> : null}
  </div>;
}

export function OurCategoriesClient({ initialCategories }: { initialCategories: OurCategoryListRow[] }) {
  const [categories, setCategories] = useState(initialCategories);
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OurCategoryListRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyType, setCopyType] = useState<'single' | 'multiple'>('single');
  const [copyFrom, setCopyFrom] = useState('');
  const [copyTo, setCopyTo] = useState('');
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyTemplate() {
    setCopying(true);
    setCopyError(null);
    try {
      const response = await fetch('/api/our-categories/copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCategoryId: copyFrom, targetCategoryId: copyTo }),
      });
      const payload = await response.json() as { categories?: OurCategoryListRow[]; error?: string };
      if (!response.ok || !payload.categories) throw new Error(payload.error ?? 'Unable to copy template.');
      setCategories(payload.categories);
      setCopyOpen(false);
      toast.success('Template images and area settings copied.');
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : 'Unable to copy template.');
    } finally {
      setCopying(false);
    }
  }

  async function deleteCategory() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/our-categories/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      const payload = await response.json() as { categories?: OurCategoryListRow[]; error?: string };
      if (!response.ok || !payload.categories) throw new Error(payload.error ?? 'Unable to delete the template.');
      setCategories(payload.categories);
      setDeleteTarget(null);
      toast.success('Our Template deleted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete the template.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Our Templates</h1>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => {
            setCopyType('single'); setCopyFrom(''); setCopyTo(''); setCopyError(null); setCopyOpen(true);
          }}><Copy className="h-4 w-4" aria-hidden="true" />Copy Template</Button>
          <Button type="button" onClick={() => setCreateTypeOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />Create</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Followed Template</TableHead>
                <TableHead className="text-right">No of Listings</TableHead>
                <TableHead className="text-right">No of Image Templates</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length > 0 ? categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell>{category.templateType === 'multiple' ? 'Multiple' : 'Single'}</TableCell>
                  <TableCell>{category.followedTemplateName ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{category.listingCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{category.imageTemplateCount}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        disabled={category.listingCount > 0}
                        onClick={() => setDeleteTarget(category)}
                        aria-label={`Delete ${category.name}`}
                        title={category.listingCount > 0 ? 'This template is used by one or more listings.' : 'Delete template'}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button asChild size="icon" variant="outline">
                        <Link href={`/our-templates/${category.id}/edit` as Route} aria-label={`Edit ${category.name}`} title="Edit template">
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No templates have been created.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={copyOpen} onOpenChange={(open) => { if (!copying) setCopyOpen(open); }}>
        <DialogContent onEscapeKeyDown={(event) => {
          if (event.target instanceof HTMLElement && event.target.getAttribute('role') === 'combobox'
            && event.target.getAttribute('aria-expanded') === 'true') event.preventDefault();
        }}>
          <DialogHeader>
            <DialogTitle>Copy Template</DialogTitle>
            <DialogDescription>Copy all images and their area settings to a template with no images. The destination can have existing listings. Both templates must have the same type and number of items.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <label className="grid gap-2 text-sm font-medium">
              Template Type
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={copyType} disabled={copying}
                onChange={(event) => { setCopyType(event.target.value as 'single' | 'multiple'); setCopyFrom(''); setCopyTo(''); setCopyError(null); }}>
                <option value="single">Single</option><option value="multiple">Multiple</option>
              </select>
            </label>
            <TemplateSearchSelect key={`from-${copyType}`} label="Copy From" value={copyFrom} onChange={(value) => { setCopyFrom(value); setCopyTo(''); }} disabled={copying}
              options={categories.filter((category) => category.templateType === copyType && category.imageTemplateCount > 0)} />
            <TemplateSearchSelect key={`to-${copyType}-${copyFrom}`} label="Copy To" value={copyTo} onChange={setCopyTo} disabled={copying}
              options={categories.filter((category) => category.templateType === copyType && category.imageTemplateCount === 0
                && (!copyFrom || category.itemCount === categories.find((source) => source.id === copyFrom)?.itemCount))} />
            {copyType === 'multiple' ? <p className="text-sm text-muted-foreground">Multiple templates must have the same number of items. Choose Copy From to see matching destinations.</p> : null}
            {copyError ? <p role="alert" className="text-sm text-destructive">{copyError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={copying} onClick={() => setCopyOpen(false)}>Cancel</Button>
            <Button type="button" disabled={copying || !copyFrom || !copyTo} onClick={() => void copyTemplate()}>{copying ? 'Copying...' : 'Copy'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createTypeOpen} onOpenChange={setCreateTypeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Template</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Select if you want a single template or a multiple template.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button asChild size="lg"><Link href={'/our-templates/create' as Route}>Single Template</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href={'/our-templates/create/multiple' as Route}>Multiple Template</Link></Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Our Template?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Delete {deleteTarget?.name} and its image templates? This cannot be undone.</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void deleteCategory()} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
