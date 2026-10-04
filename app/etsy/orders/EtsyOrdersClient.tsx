'use client';

import { useState } from 'react';
import { Download, ImageIcon, LoaderCircle, PackageCheck } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EtsyOrderDetailsData, EtsyOrdersPageData, EtsyOrderRow } from '@/lib/etsy-orders';

function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Unknown';
}

function statusLabel(value: string) {
  return value.toLocaleLowerCase().replace(/_/g, ' ').replace(/^./, (character) => character.toLocaleUpperCase());
}

function orderListings(order: EtsyOrderRow) {
  const links = new Map<string, { href: string; name: string }>();
  for (const item of order.items) {
    if (!item.listingHref) continue;
    links.set(item.listingHref, {
      href: item.listingHref,
      name: item.listingName || item.title || `Listing ${item.listingId}`,
    });
  }
  return [...links.values()];
}

export function EtsyOrdersClient({ initialData }: { initialData: EtsyOrdersPageData }) {
  const [data, setData] = useState(initialData);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EtsyOrderDetailsData | null>(null);
  const [selectedRow, setSelectedRow] = useState<EtsyOrderRow | null>(null);
  const [detailsOnly, setDetailsOnly] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState<string | null>(null);
  const [working, setWorking] = useState<'generate' | 'create' | null>(null);
  const [customStep, setCustomStep] = useState(0);

  async function refreshOrders() {
    const response = await fetch('/api/etsy/orders', { cache: 'no-store' });
    const payload = await response.json() as EtsyOrdersPageData & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'Unable to refresh Etsy orders.');
    setData(payload);
  }

  async function syncOrders() {
    setSyncing(true);
    setError(null);
    setSyncMessage(null);
    try {
      const response = await fetch('/api/etsy/orders', { method: 'POST' });
      const payload = await response.json() as { data?: EtsyOrdersPageData; summary?: { downloaded: number; refreshed: number }; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Unable to download Etsy orders.');
      setData(payload.data);
      setSyncMessage(`Downloaded or updated ${payload.summary?.downloaded ?? 0} orders and refreshed ${payload.summary?.refreshed ?? 0} unprocessed orders.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to download Etsy orders.');
    } finally {
      setSyncing(false);
    }
  }

  async function openOrder(order: EtsyOrderRow, readOnly = false) {
    setLoadingOrder(order.id);
    setError(null);
    try {
      const response = await fetch(`/api/etsy/orders/${encodeURIComponent(order.id)}`, { cache: 'no-store' });
      const payload = await response.json() as EtsyOrderDetailsData & { error?: string };
      if (!response.ok || !payload.order) throw new Error(payload.error ?? 'Unable to load the Etsy order.');
      setSelectedRow(order);
      setSelected(payload);
      setDetailsOnly(readOnly);
      setCustomStep(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the Etsy order.');
    } finally {
      setLoadingOrder(null);
    }
  }

  async function generateArtwork() {
    if (!selected) return;
    setWorking('generate');
    setError(null);
    try {
      const response = await fetch(`/api/etsy/orders/${encodeURIComponent(selected.order.id)}/artwork`, { method: 'POST' });
      const payload = await response.json() as { details?: EtsyOrderDetailsData; error?: string };
      if (!response.ok || !payload.details) throw new Error(payload.error ?? 'Unable to generate the customised artwork.');
      setSelected(payload.details);
      setCustomStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to generate the customised artwork.');
    } finally {
      setWorking(null);
    }
  }

  async function createOrder() {
    if (!selected) return;
    setWorking('create');
    setError(null);
    try {
      const response = await fetch(`/api/etsy/orders/${encodeURIComponent(selected.order.id)}/process`, { method: 'POST' });
      const payload = await response.json() as { submitted?: boolean; closed?: boolean; message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create the PrintShrimp order.');
      setSyncMessage(payload.message ?? (payload.submitted ? 'The order was created in PrintShrimp.' : 'The order was refreshed without being sent.'));
      setSelected(null);
      setSelectedRow(null);
      await refreshOrders();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the PrintShrimp order.');
    } finally {
      setWorking(null);
    }
  }

  const orderCanOpen = (order: EtsyOrderRow) => !['SUBMITTED', 'COMPLETED', 'CANCELED', 'PROCESSING', 'FAILED', 'UNKNOWN'].includes(order.processingStatus);
  const customisedImages = selected?.order.items.filter((item) => item.isCustomised && item.artworkUrl) ?? [];

  return <div className="grid gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Etsy Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">Download new Etsy orders, refresh outstanding statuses and create each PrintShrimp order once.</p>
      </div>
      <Button onClick={syncOrders} disabled={syncing}>
        {syncing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {syncing ? 'Downloading…' : 'Download new orders'}
      </Button>
    </div>

    {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
    {syncMessage ? <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{syncMessage}</div> : null}
    {!data.hasTransactionsWriteScope ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <span>Reconnect Etsy once to approve transaction write access before creating PrintShrimp orders.</span>
      <Button asChild size="sm" variant="outline"><Link href={data.reconnectUrl as Route}>Reconnect Etsy</Link></Button>
    </div> : null}

    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Name</TableHead><TableHead>Listing</TableHead><TableHead>Country</TableHead><TableHead>Paid</TableHead><TableHead>Order date / time</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {data.orders.map((order) => <TableRow key={order.id}>
            <TableCell className="font-medium">{order.name || 'Name unavailable'}</TableCell>
            <TableCell>{orderListings(order).length > 0 ? <div className="grid gap-1">
              {orderListings(order).map((listing) => <Link key={listing.href} href={listing.href as Route} className="font-medium text-primary underline underline-offset-2">
                {listing.name}
              </Link>)}
            </div> : <span className="text-sm text-destructive">Not linked</span>}</TableCell>
            <TableCell>{order.countryIso || '—'}</TableCell>
            <TableCell>{order.isPaid ? 'Yes' : 'No'}</TableCell>
            <TableCell>{dateTime(order.orderedAt)}</TableCell>
            <TableCell><div>{statusLabel(order.processingStatus)}</div><div className="text-xs text-muted-foreground">Etsy: {order.etsyStatus || 'unknown'}</div></TableCell>
            <TableCell className="text-right">
              {order.processingStatus === 'COMPLETED' ? <Button size="sm" variant="outline" onClick={() => openOrder(order, true)} disabled={loadingOrder !== null}>
                {loadingOrder === order.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Completed
              </Button> : orderCanOpen(order) ? <Button size="sm" onClick={() => openOrder(order)} disabled={loadingOrder !== null}>
                {loadingOrder === order.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Process
              </Button> : <span className="text-xs text-muted-foreground">{statusLabel(order.processingStatus)}</span>}
            </TableCell>
          </TableRow>)}
          {data.orders.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No Etsy orders have been downloaded yet.</TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </div>

    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open && !working) { setSelected(null); setSelectedRow(null); setDetailsOnly(false); } }}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{detailsOnly ? 'Completed Etsy order' : 'Process Etsy order'} {selected?.order.etsyReceiptId}</DialogTitle>
          <DialogDescription>{selectedRow?.name} · {selected?.isCustomised ? 'Customised order' : 'Standard order'}</DialogDescription>
        </DialogHeader>
        {selected && detailsOnly ? <div className="grid min-h-0 gap-4 overflow-hidden">
          <pre className="max-h-[65vh] overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap">{JSON.stringify(selected.order, null, 2)}</pre>
          <div className="flex justify-end border-t pt-4">
            <Button type="button" onClick={() => { setSelected(null); setSelectedRow(null); setDetailsOnly(false); }}>Close</Button>
          </div>
        </div> : selected ? <div className="grid min-h-0 gap-4">
          {selected.isCustomised ? <div className="flex flex-wrap gap-2 border-b pb-3">
            {['1. Order Details', '2. Generate Image', '3. Payload'].map((label, index) => <Button key={label} type="button" size="sm" variant={customStep === index ? 'default' : 'outline'} onClick={() => setCustomStep(index)}>{label}</Button>)}
          </div> : <div className="flex gap-2 border-b pb-3">
            {['Order Details', 'Payload'].map((label, index) => <Button key={label} type="button" size="sm" variant={customStep === index ? 'default' : 'outline'} onClick={() => setCustomStep(index)}>{label}</Button>)}
          </div>}

          {customStep === 0 ? <pre className="max-h-[55vh] overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap">{JSON.stringify(selected.order.rawJson, null, 2)}</pre> : null}

          {selected.isCustomised && customStep === 1 ? <div className="grid max-h-[58vh] gap-4 overflow-auto">
            <div className="flex justify-end"><Button onClick={generateArtwork} disabled={working !== null}>
              {working === 'generate' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              {working === 'generate' ? 'Generating…' : customisedImages.length ? 'Regenerate Image' : 'Generate Image'}
            </Button></div>
            {customisedImages.map((item) => <div key={item.id} className="rounded-lg border bg-muted/20 p-3">
              <p className="mb-2 text-sm font-medium">{item.title} · {item.size}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.artworkUrl!} alt={`Custom artwork for ${item.title}`} className="mx-auto max-h-[46vh] max-w-full rounded-md object-contain" />
            </div>)}
            {customisedImages.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Generate the customised image before creating the order.</p> : null}
          </div> : null}

          {((selected.isCustomised && customStep === 2) || (!selected.isCustomised && customStep === 1)) ? <pre aria-label="PrintShrimp payload JSON" className="max-h-[55vh] overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap">{JSON.stringify(selected.payload, null, 2)}</pre> : null}

          {selected.missing.length > 0 ? <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Cannot create this order yet: {selected.missing.join(', ')}.</div> : null}
          {(!selected.isCustomised || customStep === 2) ? <div className="flex justify-end border-t pt-4">
            <Button onClick={createOrder} disabled={working !== null || !selected.canCreate}>
              {working === 'create' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              {working === 'create' ? 'Creating Order…' : 'Create Order'}
            </Button>
          </div> : null}
        </div> : null}
      </DialogContent>
    </Dialog>
  </div>;
}
