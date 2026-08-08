'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type CategoriesClientProps = {
  categories: string[];
};

export function CategoriesClient({ categories }: CategoriesClientProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function resetForm() {
    setName('');
    setDescription('');
    setError(null);
  }

  function closeDialog() {
    resetForm();
    setIsOpen(false);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to create category.');
      }

      closeDialog();
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create category.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
          <div>
            <CardTitle>Categories</CardTitle>
            <CardDescription>These are the categories.</CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="outline" aria-label="Add category" onClick={() => setIsOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" size="icon" variant="outline" aria-label="Sync categories">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {categories.length > 0 ? (
            <ul className="category-list">
              {categories.map((category) => (
                <li key={category} className="category-row">
                  <span>{category}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No categories found.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : closeDialog())}>
        <DialogContent>
          <form onSubmit={handleSave} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add category</DialogTitle>
              <DialogDescription>Create a local category folder and save it to the database.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="category-name">Category Name</Label>
              <Input
                id="category-name"
                value={name}
                maxLength={50}
                onChange={(event) => setName(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">{name.length}/50 characters</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="category-description">Description</Label>
              <textarea
                id="category-description"
                value={description}
                maxLength={1000}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">{description.length}/1000 characters</p>
            </div>

            {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
