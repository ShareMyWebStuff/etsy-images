'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { OurCategoryListRow } from '@/lib/our-categories';

export function OurCategoriesClient({ initialCategories }: { initialCategories: OurCategoryListRow[] }) {
  const [categories, setCategories] = useState(initialCategories);
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OurCategoryListRow | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        <Button type="button" onClick={() => setCreateTypeOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />Create</Button>
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
