'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { BulkPriceUpdateResult, PriceUpdateData } from '@/lib/price-update';

type PriceUpdateClientProps = { initialData: PriceUpdateData };

export function PriceUpdateClient({ initialData }: PriceUpdateClientProps) {
  const [sectionId, setSectionId] = useState('');
  const [price, setPrice] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkPriceUpdateResult | null>(null);

  const selectedSection = useMemo(
    () => initialData.sections.find((section) => section.id === sectionId) ?? null,
    [initialData.sections, sectionId]
  );
  const numericPrice = Number(price);
  const canUpdate = Boolean(selectedSection && price.trim() && Number.isFinite(numericPrice) && numericPrice > 0);

  async function updateConfirmed() {
    if (!canUpdate || !selectedSection) return;
    setUpdating(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/price-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: selectedSection.id,
          priceAmount: Math.round(numericPrice * 100),
        }),
      });
      const payload = (await response.json()) as { result?: BulkPriceUpdateResult; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error ?? 'Unable to update prices.');
      setResult(payload.result);
      setConfirmOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update prices.');
    } finally {
      setUpdating(false);
    }
  }

  return <>
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Price Update</h1>
        <p className="mt-2 text-muted-foreground">Update the local and Etsy price for every listing in a section.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Choose listings</CardTitle></CardHeader>
        <CardContent className="grid max-w-2xl gap-5">
          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          {result ? (
            <div className={`rounded-md border p-3 text-sm ${result.etsyFailed > 0 ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-green-300 bg-green-50 text-green-950'}`}>
              Updated {result.localUpdated} local listing{result.localUpdated === 1 ? '' : 's'} and {result.etsyUpdated} Etsy listing{result.etsyUpdated === 1 ? '' : 's'}.
              {result.etsyFailed > 0 ? <div className="mt-2"><strong>{result.etsyFailed} Etsy update{result.etsyFailed === 1 ? '' : 's'} failed:</strong><ul className="mt-1 list-disc pl-5">{result.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul></div> : null}
            </div>
          ) : null}

          <label className="grid gap-2 text-sm font-medium">
            Section
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={sectionId}
              onChange={(event) => { setSectionId(event.target.value); setResult(null); }}
              disabled={updating}
            >
              <option value="">Select section</option>
              {initialData.sections.map((section) => <option key={section.id} value={section.id}>{section.shopName} / {section.name} ({section.listingCount})</option>)}
            </select>
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Price (£)
            <Input type="number" min="0.01" step="0.01" value={price} onChange={(event) => { setPrice(event.target.value); setResult(null); }} disabled={!selectedSection || updating} />
          </label>

          <Button type="button" className="w-fit" onClick={() => setConfirmOpen(true)} disabled={!canUpdate || updating}>Update</Button>
        </CardContent>
      </Card>
    </div>

    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!updating) setConfirmOpen(open); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Update listing prices?</DialogTitle></DialogHeader>
        <p>Are you sure you want to set all {selectedSection?.listingCount ?? 0} listings in {selectedSection?.name} to £{Number.isFinite(numericPrice) ? numericPrice.toFixed(2) : price}?</p>
        <p className="text-sm text-muted-foreground">The database will be updated first, followed by every linked Etsy listing.</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={updating}>Cancel</Button>
          <Button type="button" onClick={updateConfirmed} disabled={updating}>{updating ? 'Updating...' : 'Confirm'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
