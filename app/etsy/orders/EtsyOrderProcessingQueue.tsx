'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { EtsyOrderDetailsData, getEtsyOrdersForProcessing } from '@/lib/etsy-orders';

type QueueEntry = Awaited<ReturnType<typeof getEtsyOrdersForProcessing>>[number];
type Result = { submitted: boolean; message: string; status?: string; response?: unknown; error?: boolean };

export function EtsyOrderProcessingQueue({ onClose, onProcessed, hasWriteScope }: {
  onClose: () => void;
  onProcessed: () => Promise<void>;
  hasWriteScope: boolean;
}) {
  const [orders, setOrders] = useState<QueueEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [details, setDetails] = useState<EtsyOrderDetailsData | null>(null);
  const [busy, setBusy] = useState<'loading' | 'artwork' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [retry, setRetry] = useState(0);
  const current = orders[index];
  const isLast = index >= orders.length - 1;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/etsy/orders/queue', { cache: 'no-store', signal: controller.signal });
        const payload = await response.json() as { orders?: QueueEntry[]; error?: string };
        if (!response.ok || !payload.orders) throw new Error(payload.error ?? 'Unable to load new orders.');
        if (!controller.signal.aborted) setOrders(payload.orders);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load new orders.');
      } finally {
        if (!controller.signal.aborted) setLoadingQueue(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    setBusy('loading'); setDetails(null); setError(null); setResult(null);
    void (async () => {
      try {
        const response = await fetch(`/api/etsy/orders/${encodeURIComponent(current.id)}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json() as EtsyOrderDetailsData & { error?: string };
        if (!response.ok || !payload.order) throw new Error(payload.error ?? 'Unable to load this order.');
        if (controller.signal.aborted) return;
        setDetails(payload);
        if (payload.orderType === 'Customised' && payload.order.processingStatus === 'UNPROCESSED') {
          setBusy('artwork');
          const generated = await fetch(`/api/etsy/orders/${encodeURIComponent(current.id)}/artwork`, { method: 'POST', signal: controller.signal });
          const artwork = await generated.json() as { details?: EtsyOrderDetailsData; error?: string };
          if (!generated.ok || !artwork.details) throw new Error(artwork.error ?? 'Unable to generate the customised artwork.');
          if (!controller.signal.aborted) setDetails(artwork.details);
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to prepare this order.');
      } finally {
        if (!controller.signal.aborted) setBusy(null);
      }
    })();
    return () => controller.abort();
  }, [current, retry]);

  function next() {
    if (isLast) onClose();
    else { setDetails(null); setResult(null); setError(null); setIndex((value) => value + 1); }
  }

  async function createOrder() {
    if (!current || !details?.canCreate || busy || result || error || details.orderType === 'In Error') return;
    setBusy('create');
    try {
      const response = await fetch(`/api/etsy/orders/${encodeURIComponent(current.id)}/process`, { method: 'POST' });
      const payload = await response.json() as { submitted?: boolean; message?: string; response?: { order?: { order_id?: string; status?: string } }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'PrintShrimp could not create this order.');
      const remote = payload.response?.order;
      setResult({
        submitted: payload.submitted === true,
        message: payload.message ?? (payload.submitted ? `PrintShrimp order${remote?.order_id ? ` ${remote.order_id}` : ''} created.` : 'No order was sent to PrintShrimp.'),
        status: remote?.status ?? (payload.submitted ? 'Submitted' : undefined),
        response: payload.response,
      });
    } catch (caught) {
      setResult({ submitted: false, error: true, message: caught instanceof Error ? caught.message : 'Unable to create the PrintShrimp order.' });
    } finally {
      setBusy(null);
      // Refresh the table even after a rejected or uncertain submission, which may record an attempt.
      void onProcessed().catch(() => undefined);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && busy !== 'create') onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{current ? `Process Etsy order ${current.etsyReceiptId}` : 'Process new Etsy orders'}</DialogTitle>
        <DialogDescription>{current
          ? `${details?.order.name || current.name || 'Name unavailable'} · ${details?.orderType ?? 'Loading order'}`
          : 'Review new paid orders, newest first, before sending them to PrintShrimp.'}</DialogDescription>
      </DialogHeader>
      {current ? <p className="text-sm text-muted-foreground">Order {index + 1} of {orders.length}</p> : null}
      {loadingQueue || busy === 'loading' ? <p role="status" className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" />Loading orders…</p> : null}
      {!loadingQueue && !current && !error ? <p>No new paid orders need processing.</p> : null}
      {details ? <div className="grid gap-4">
        {details.order.items.map((item) => <section key={item.id} className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">{item.title || item.listingName || 'Order item'} · Quantity {item.quantity}</h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="inline font-medium">Size: </dt><dd className="inline">{item.size || 'Not provided'}</dd></div>
            <div><dt className="inline font-medium">Frame: </dt><dd className="inline">{item.productType === 'Frame' ? item.frameColour || 'Frame' : 'No Frame'}</dd></div>
            <div><dt className="inline font-medium">Border: </dt><dd className="inline">{item.border ? 'Yes' : 'No'}</dd></div>
            <div><dt className="inline font-medium">Font Style: </dt><dd className="inline">{item.fontStyle}</dd></div>
            {item.topText ? <div><dt className="inline font-medium">Top Text: </dt><dd className="inline">{item.topText}</dd></div> : null}
            {item.bottomText ? <div><dt className="inline font-medium">Bottom Text: </dt><dd className="inline">{item.bottomText}</dd></div> : null}
            <div><dt className="inline font-medium">Order Type: </dt><dd className="inline">{item.orderType}</dd></div>
          </dl>
          {item.error ? <p role="alert" className="mt-3 text-sm text-destructive">{item.error}</p> : null}
          {item.isCustomised && item.artworkUrl ? <figure className="mt-4 grid gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.artworkUrl} alt={`${item.title || 'Customised artwork'} preview at ${item.size}`} className="mx-auto max-h-[45vh] max-w-full object-contain outline outline-1 outline-black" />
            <figcaption className="text-center text-sm text-muted-foreground">Print size: {item.size}{item.border ? ' · White border' : ''}</figcaption>
          </figure> : null}
        </section>)}
        {details.orderType === 'Normal' && !result ? <p>This order is normal. Press Create Order to create the order in PrintShrimp.</p> : null}
        {details.orderType === 'Customised' && !result ? <p>Review the artwork at the ordered size, then press Create Order to send it to PrintShrimp.</p> : null}
        {busy === 'artwork' ? <p role="status" className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" />Creating customised artwork…</p> : null}
        {!busy && details.missing.length > 0 && !result ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">Cannot create this order yet: {details.missing.join(', ')}.</p> : null}
        {!hasWriteScope ? <p className="text-sm text-destructive">Reconnect Etsy to approve transaction write access before creating orders.</p> : null}
        {!busy && !details.canCreate && details.missing.length === 0 && !result ? <p>This order is no longer available for processing. Skip it to continue.</p> : null}
      </div> : null}
      {error ? <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p> : null}
      {result ? <div role={result.error ? 'alert' : 'status'} className={`rounded-md border p-4 ${result.error ? 'border-destructive text-destructive' : ''}`}>
        <p>{result.message}</p>
        {result.status ? <p className="mt-1 text-sm">PrintShrimp status: {result.status}</p> : null}
        {result.error ? <p className="mt-2 text-sm">Check PrintShrimp before attempting a resend.</p> : null}
        {result.response ? <details className="mt-3"><summary className="cursor-pointer text-sm">PrintShrimp response</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(result.response, null, 2)}</pre></details> : null}
      </div> : null}
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        {!result ? <Button type="button" variant="outline" onClick={current ? next : onClose} disabled={busy !== null}>{current && !isLast ? 'Skip' : 'Cancel'}</Button> : <span />}
        {result ? <Button type="button" onClick={next}>Continue</Button> : error && current ? <Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)} disabled={busy !== null}>Retry preview</Button> : current ? <Button type="button" onClick={() => void createOrder()} disabled={busy !== null || !details?.canCreate || !hasWriteScope || details.orderType === 'In Error'}>
          {busy === 'create' ? 'Creating Order…' : 'Create Order'}
        </Button> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
