'use client';

import { FormEvent, useState } from 'react';
import { LoaderCircle, Search, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EtsyOrderRow } from '@/lib/etsy-orders';

function dateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : 'Unknown';
}

export function PrintShrimpResendClient({ initialOrders }: { initialOrders: EtsyOrderRow[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<EtsyOrderRow | null>(null);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const response = await fetch(`/api/printshrimp/resend?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' });
      const payload = await response.json() as { orders?: EtsyOrderRow[]; error?: string };
      if (!response.ok || !payload.orders) throw new Error(payload.error ?? 'Unable to search Etsy orders.');
      setOrders(payload.orders);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to search Etsy orders.');
    } finally {
      setSearching(false);
    }
  }

  async function resend() {
    if (!selected) return;
    setResending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/printshrimp/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: selected.id, confirmation: 'RESEND' }),
      });
      const payload = await response.json() as { submitted?: boolean; error?: string };
      if (!response.ok || !payload.submitted) throw new Error(payload.error ?? 'PrintShrimp did not accept the resend.');
      setSelected(null);
      setMessage(`Order ${selected.etsyReceiptId} was explicitly resent to PrintShrimp.`);
      await search();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to resend the order.');
    } finally {
      setResending(false);
    }
  }

  return <div className="grid gap-6">
    <div>
      <h1 className="text-2xl font-semibold">Resend PrintShrimp Item</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Search Etsy orders and deliberately create a new PrintShrimp order. Normal processing never submits the same order twice.
      </p>
    </div>

    <form onSubmit={search} className="flex max-w-2xl gap-2">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search name, postcode, town or email address"
        aria-label="Search orders"
      />
      <Button type="submit" disabled={searching}>
        {searching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        Search
      </Button>
    </form>

    {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
    {message ? <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}

    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Town</TableHead><TableHead>Postcode</TableHead><TableHead>Order</TableHead><TableHead>Status</TableHead><TableHead>Last submission</TableHead><TableHead className="text-right">Action</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {orders.map((order) => <TableRow key={order.id}>
            <TableCell className="font-medium">{order.name || 'Name unavailable'}</TableCell>
            <TableCell>{order.buyerEmail || '-'}</TableCell>
            <TableCell>{order.city || '-'}</TableCell>
            <TableCell>{order.postcode || '-'}</TableCell>
            <TableCell>{order.etsyReceiptId}</TableCell>
            <TableCell>{order.processingStatus.toLocaleLowerCase().replace(/_/g, ' ')}</TableCell>
            <TableCell>{dateTime(order.printShrimpSubmittedAt)}</TableCell>
            <TableCell className="text-right"><Button size="sm" variant="destructive" onClick={() => setSelected(order)}>
              <Send className="h-4 w-4" /> Resend
            </Button></TableCell>
          </TableRow>)}
          {orders.length === 0 ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No matching Etsy orders.</TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </div>

    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open && !resending) setSelected(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resend this item?</DialogTitle>
          <DialogDescription>
            This creates another chargeable PrintShrimp order for Etsy order {selected?.etsyReceiptId}. Use it only when a replacement or deliberate duplicate is required.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSelected(null)} disabled={resending}>Cancel</Button>
          <Button variant="destructive" onClick={resend} disabled={resending}>
            {resending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {resending ? 'Resending...' : 'Yes, resend item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
