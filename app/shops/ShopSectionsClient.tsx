'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ArrowLeft, List, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ShopSectionsPageData } from '@/lib/etsy-sync';

type SectionActionResponse = {
  data?: ShopSectionsPageData | null;
  error?: string;
};

type ShopSectionsClientProps = {
  initialData: ShopSectionsPageData | null;
  shopId: string | null;
};

export function ShopSectionsClient({ initialData, shopId }: ShopSectionsClientProps) {
  const [data, setData] = useState(initialData);
  const [createOpen, setCreateOpen] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [downloads, setDownloads] = useState('1');
  const [roomTheme, setRoomTheme] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  async function createSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!shopId) {
      setError('Missing shop id.');
      return;
    }

    setError(null);
    setCreateLoading(true);

    try {
      const response = await fetch('/api/shops/sections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shopId,
          sectionName,
          numberOfDownloads: downloads === 'all' ? null : Number(downloads),
          includeAllDownloads: downloads === 'all',
          roomTheme: downloads === '1' ? roomTheme : '',
        }),
      });
      const payload = (await response.json()) as SectionActionResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to create section.');
      }

      setData(payload.data ?? null);
      setSectionName('');
      setDownloads('1');
      setRoomTheme('');
      setCreateOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create section.');
    } finally {
      setCreateLoading(false);
    }
  }

  async function deleteSection(sectionId: string) {
    if (!shopId) {
      setError('Missing shop id.');
      return;
    }

    setError(null);

    try {
      const response = await fetch('/api/shops/sections', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shopId, sectionId }),
      });
      const payload = (await response.json()) as SectionActionResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to delete section.');
      }

      setData(payload.data ?? null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to delete section.');
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Button asChild variant="outline">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Shop
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Add section"
            title="Add section"
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
            disabled={!shopId}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>{data ? `${data.shop.shopName} Sections` : 'Shop Sections'}</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-4 text-sm font-medium text-destructive">{error}</p> : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Section Names</TableHead>
                <TableHead className="text-right">No of Downloads</TableHead>
                <TableHead className="text-right">No of Listings</TableHead>
                <TableHead className="text-right">No of Active</TableHead>
                <TableHead className="text-right">No of Draft</TableHead>
                <TableHead className="text-right">Uploaded to Etsy</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && data.sections.length > 0 ? (
                data.sections.map((section) => (
                  <TableRow key={section.id}>
                    <TableCell className="font-medium">
                      <span className="block">{section.sectionName}</span>
                      {section.roomTheme ? <span className="block text-xs font-normal text-muted-foreground">Room theme: {section.roomTheme}</span> : null}
                    </TableCell>
                    <TableCell className="text-right">{section.includeAllDownloads ? 'All' : section.numberOfDownloads}</TableCell>
                    <TableCell className="text-right tabular-nums">{section.noOfListings}</TableCell>
                    <TableCell className="text-right tabular-nums">{section.noOfActive}</TableCell>
                    <TableCell className="text-right tabular-nums">{section.noOfDraft}</TableCell>
                    <TableCell className="text-right">{section.hasEtsyShopSection ? 'Yes' : 'No'}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        {section.noOfListings === 0 ? <Button
                          type="button" variant="outline" size="icon" aria-label="Delete Section" title="Delete Section"
                          onClick={() => deleteSection(section.id)}
                        ><Trash2 className="h-4 w-4" aria-hidden="true" /></Button> : null}
                        <Button asChild variant="outline" size="icon" aria-label="View Listings" title="View Listings">
                          <Link href={`/listings?shopId=${encodeURIComponent(data.shop.id)}&sectionId=${encodeURIComponent(section.id)}`}>
                            <List className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No sections found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={createSection}>
            <DialogHeader>
              <DialogTitle>Create Section</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Input
                value={sectionName}
                onChange={(event) => setSectionName(event.target.value)}
                placeholder="Section name"
                autoFocus
              />
              <label className="grid gap-2 text-sm font-medium">
                No of Downloads
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={downloads}
                  onChange={(event) => {
                    setDownloads(event.target.value);
                    if (event.target.value !== '1') setRoomTheme('');
                  }}
                >
                  <option value="1">1</option><option value="3">3</option><option value="6">6</option>
                  <option value="12">12</option><option value="all">All</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Room Theme
                <textarea
                  value={roomTheme}
                  maxLength={200}
                  onChange={(event) => setRoomTheme(event.target.value)}
                  disabled={downloads !== '1'}
                  placeholder={downloads === '1' ? 'For example, Bugs or Dinosaurs' : 'Only used for sections with one download'}
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{roomTheme.length} / 200</span>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </>
  );
}
