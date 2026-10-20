'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EtsyCategoriesPageData, EtsyCategoryListRow, EtsySectionUsage } from '@/lib/local-shop-sections';

type CategoryUses = Record<EtsySectionUsage, boolean>;

const DEFAULT_USES: CategoryUses = {
  printFrames: true,
  customisedPrints: true,
  digitalDownloads: true,
};

const checkboxClassName = 'h-4 w-4 rounded border-input accent-primary';

export function EtsyCategoriesClient({ initialData }: { initialData: EtsyCategoriesPageData }) {
  const [data, setData] = useState(initialData);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EtsyCategoryListRow | null>(null);
  const [title, setTitle] = useState('');
  const [uses, setUses] = useState<CategoryUses>(DEFAULT_USES);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EtsyCategoryListRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setEditTarget(null);
    setTitle('');
    setUses(DEFAULT_USES);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(category: EtsyCategoryListRow) {
    if (category.listingCount > 0) return;
    setEditTarget(category);
    setTitle(category.title);
    setUses({
      printFrames: category.useForPrintFrames,
      customisedPrints: category.useForCustomisedPrints,
      digitalDownloads: category.useForDigitalDownloads,
    });
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditTarget(null);
    setFormError(null);
  }

  function updateUse(usage: EtsySectionUsage, checked: boolean) {
    setUses((current) => ({ ...current, [usage]: checked }));
  }

  async function saveCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError('Enter an Etsy category name.');
      return;
    }
    const usages = (Object.entries(uses) as Array<[EtsySectionUsage, boolean]>)
      .filter(([, enabled]) => enabled)
      .map(([usage]) => usage);
    if (usages.length === 0) {
      setFormError('Select at least one product type.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const response = await fetch('/api/etsy/categories', {
        method: editTarget ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: data.shopId,
          ...(editTarget ? { categoryId: String(editTarget.id) } : {}),
          title: trimmedTitle,
          usages,
        }),
      });
      const payload = await response.json() as { data?: EtsyCategoriesPageData; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? `Unable to ${editTarget ? 'update' : 'create'} the Etsy category.`);
      setData(payload.data);
      setFormOpen(false);
      setEditTarget(null);
      toast.success(editTarget ? 'Etsy category updated.' : 'Etsy category created.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : `Unable to ${editTarget ? 'update' : 'create'} the Etsy category.`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch('/api/etsy/categories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: data.shopId, categoryId: String(deleteTarget.id) }),
      });
      const payload = await response.json() as { data?: EtsyCategoriesPageData; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Unable to delete the Etsy category.');
      setData(payload.data);
      setDeleteTarget(null);
      toast.success('Etsy category deleted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete the Etsy category.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Etsy Categories</h1>
        <Button type="button" onClick={openCreate}><Plus className="h-4 w-4" aria-hidden="true" />Create</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category Name</TableHead>
                <TableHead>Print / Frames</TableHead>
                <TableHead>Customised</TableHead>
                <TableHead>Digital Downloads</TableHead>
                <TableHead className="text-right">No of Listings</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.categories.length > 0 ? data.categories.map((category) => {
                const locked = category.listingCount > 0;
                const lockedTitle = 'This Etsy category is used by one or more listings.';
                return (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.title}</TableCell>
                    <TableCell>{category.useForPrintFrames ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{category.useForCustomisedPrints ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{category.useForDigitalDownloads ? 'Yes' : 'No'}</TableCell>
                    <TableCell className="text-right tabular-nums">{category.listingCount}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          disabled={locked}
                          onClick={() => setDeleteTarget(category)}
                          aria-label={`Delete ${category.title}`}
                          title={locked ? lockedTitle : 'Delete Etsy category'}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          disabled={locked}
                          onClick={() => openEdit(category)}
                          aria-label={`Edit ${category.title}`}
                          title={locked ? lockedTitle : 'Edit Etsy category'}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No Etsy categories have been created.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <DialogContent>
          <form className="grid gap-5" onSubmit={(event) => void saveCategory(event)}>
            <DialogHeader>
              <DialogTitle>{editTarget ? 'Edit Etsy Category' : 'Create Etsy Category'}</DialogTitle>
              <DialogDescription>Choose the name and the product types that can use this Etsy category.</DialogDescription>
            </DialogHeader>
            <label className="grid gap-2 text-sm font-medium">
              Category name
              <Input aria-label="Category name" maxLength={191} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
            </label>
            <div className="grid gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className={checkboxClassName} checked={uses.printFrames} onChange={(event) => updateUse('printFrames', event.target.checked)} />
                Print / Frames
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className={checkboxClassName} checked={uses.customisedPrints} onChange={(event) => updateUse('customisedPrints', event.target.checked)} />
                Customised
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className={checkboxClassName} checked={uses.digitalDownloads} onChange={(event) => updateUse('digitalDownloads', event.target.checked)} />
                Digital Downloads
              </label>
            </div>
            {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editTarget ? 'Save' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Etsy Category?</DialogTitle>
            <DialogDescription>This will delete the category from Etsy and remove it from the category dropdowns.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">Are you sure you want to delete {deleteTarget?.title}?</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void deleteCategory()} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
