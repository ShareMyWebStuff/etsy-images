'use client';

import { FormEvent, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AccountsFilters, AccountsPageData } from '@/lib/accounts';
import type { EtsyAccountingSyncSummary } from '@/lib/etsy-accounting-sync';

type AccountsClientProps = { initialData: AccountsPageData };

const selectClassName = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function formatMoney(amountMinorUnits: number, currencyCode: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currencyCode }).format(amountMinorUnits / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function AccountsClient({ initialData }: AccountsClientProps) {
  const [data, setData] = useState(initialData);
  const [filters, setFilters] = useState<AccountsFilters>(initialData.filters);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [manual, setManual] = useState({
    entryDate: todayUtc(),
    type: 'INCOME' as 'INCOME' | 'EXPENSE',
    amount: '',
    currencyCode: 'GBP',
    category: '',
    description: '',
  });

  async function parseResponse<T>(response: Response, fallback: string) {
    const payload = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? fallback);
    return payload;
  }

  async function loadData(nextFilters: AccountsFilters = filters) {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        view: nextFilters.view,
        month: nextFilters.month,
        type: nextFilters.type,
        source: nextFilters.source,
        category: nextFilters.category,
        page: String(nextFilters.page),
      });
      const response = await fetch(`/api/admin/accounts?${query}`, { cache: 'no-store' });
      const payload = await parseResponse<{ data: AccountsPageData }>(response, 'Unable to refresh accounts data.');
      setData(payload.data);
      setFilters(payload.data.filters);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to refresh accounts data.');
    } finally {
      setLoading(false);
    }
  }

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadData({ ...filters, page: 1 });
  }

  async function addManualEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manual),
      });
      await parseResponse(response, 'Unable to save the manual entry.');
      const message = `Manual ${manual.type === 'INCOME' ? 'income' : 'expense'} saved.`;
      setSuccess(message);
      toast.success(message);
      setManual((current) => ({ ...current, amount: '', category: '', description: '' }));
      await loadData({ ...filters, page: 1 });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to save the manual entry.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function syncEtsy() {
    setSyncing(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/admin/accounts/sync', { method: 'POST' });
      const payload = await parseResponse<{ summary: EtsyAccountingSyncSummary }>(response, 'Unable to sync Etsy accounts data.');
      const summary = payload.summary;
      const message = `${summary.fullHistoryImported ? 'Historical import' : 'Etsy sync'} complete: ${summary.receiptsImported} receipts, ${summary.transactionsImported} transactions and ${summary.ledgerEntriesImported} ledger entries processed.`;
      setSuccess(message);
      toast.success(message);
      await loadData({ ...filters, page: 1 });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to sync Etsy accounts data.';
      setError(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  function summaryValue(key: 'incomeMinorUnits' | 'expenseMinorUnits' | 'netMinorUnits') {
    const rows = data.summary.length > 0 ? data.summary : [{ currencyCode: 'GBP', incomeMinorUnits: 0, expenseMinorUnits: 0, netMinorUnits: 0, entryCount: 0 }];
    return rows.map((row) => <div key={row.currencyCode}>{formatMoney(row[key], row.currencyCode)}</div>);
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Income and expenditure for {data.period.label}.</p>
          <p className="mt-1 text-xs text-muted-foreground">{data.dateInterpretation}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!data.etsyAuthorization.hasTransactionsScope ? (
            <Button asChild variant="outline">
              <a href={data.etsyAuthorization.reconnectUrl}>{data.etsyAuthorization.connected ? 'Reconnect Etsy' : 'Connect Etsy'}</a>
            </Button>
          ) : null}
          <Button onClick={syncEtsy} disabled={syncing || data.shops.length === 0 || !data.etsyAuthorization.hasTransactionsScope}>
            {syncing ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {syncing ? 'Syncing Etsy...' : 'Sync latest Etsy sales and costs'}
          </Button>
        </div>
      </div>

      {error ? <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
      {success ? <div role="status" className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{success}</div> : null}
      {!data.etsyAuthorization.hasTransactionsScope ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Etsy must be reauthorised with the <code>transactions_r</code> permission before sales and costs can be imported.
        </div>
      ) : null}
      {data.shops.length === 0 ? <div className="rounded-md border p-4 text-sm text-muted-foreground">No Etsy shops are stored yet. Connect and sync Etsy shops first.</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>Income</CardDescription></CardHeader><CardContent className="text-2xl font-semibold text-green-700">{summaryValue('incomeMinorUnits')}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Expenditure</CardDescription></CardHeader><CardContent className="text-2xl font-semibold text-destructive">{summaryValue('expenseMinorUnits')}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Net amount</CardDescription></CardHeader><CardContent className="text-2xl font-semibold">{summaryValue('netMinorUnits')}</CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reporting period</CardTitle>
          <CardDescription>Current accounting year: {data.currentAccountingYear.label}, starting in month {data.accountingYearStartMonth}.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={applyFilters} className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <label className="grid gap-2 text-sm font-medium">View<select className={selectClassName} value={filters.view} onChange={(event) => setFilters({ ...filters, view: event.target.value as AccountsFilters['view'] })}><option value="month">Month</option><option value="accounting-year">Current accounting year</option></select></label>
            <label className="grid gap-2 text-sm font-medium">Month<Input type="month" value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} disabled={filters.view !== 'month'} /></label>
            <label className="grid gap-2 text-sm font-medium">Type<select className={selectClassName} value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value as AccountsFilters['type'] })}><option value="ALL">All types</option><option value="INCOME">Income</option><option value="EXPENSE">Expense</option></select></label>
            <label className="grid gap-2 text-sm font-medium">Source<select className={selectClassName} value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value as AccountsFilters['source'] })}><option value="ALL">All sources</option><option value="ETSY">Etsy</option><option value="MANUAL">Manual</option></select></label>
            <label className="grid gap-2 text-sm font-medium">Category<select className={selectClassName} value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="">All categories</option>{data.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
            <div className="flex items-end"><Button type="submit" className="w-full" disabled={loading}>{loading ? 'Loading...' : 'Apply filters'}</Button></div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <Card>
          <CardHeader><CardTitle>Entries</CardTitle><CardDescription>{data.entryCount} entries in the selected report.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead><TableHead>Source</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.entries.length === 0 ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No entries match this reporting period.</TableCell></TableRow> : data.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(entry.entryDate)}</TableCell>
                      <TableCell><span className={entry.type === 'INCOME' ? 'font-medium text-green-700' : 'font-medium text-destructive'}>{entry.type === 'INCOME' ? 'Income' : 'Expense'}</span></TableCell>
                      <TableCell><div className="max-w-md"><div>{entry.description}</div>{entry.externalReference ? <div className="text-xs text-muted-foreground">Ref: {entry.externalReference}</div> : null}</div></TableCell>
                      <TableCell>{entry.category}</TableCell>
                      <TableCell>{entry.source === 'ETSY' ? 'Etsy' : 'Manual'}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium">{entry.type === 'EXPENSE' ? '-' : ''}{formatMoney(entry.amountMinorUnits, entry.currencyCode)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <Button variant="outline" disabled={loading || data.pagination.page <= 1} onClick={() => loadData({ ...filters, page: data.pagination.page - 1 })}>Previous</Button>
              <span>Page {data.pagination.page} of {data.pagination.pageCount}</span>
              <Button variant="outline" disabled={loading || data.pagination.page >= data.pagination.pageCount} onClick={() => loadData({ ...filters, page: data.pagination.page + 1 })}>Next</Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Add manual entry</CardTitle><CardDescription>Add income or an expense that did not come from Etsy.</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={addManualEntry} className="grid gap-4">
                <label className="grid gap-2 text-sm font-medium">Type<select className={selectClassName} value={manual.type} onChange={(event) => setManual({ ...manual, type: event.target.value as 'INCOME' | 'EXPENSE' })}><option value="INCOME">Income</option><option value="EXPENSE">Expense</option></select></label>
                <label className="grid gap-2 text-sm font-medium">Date<Input type="date" required value={manual.entryDate} onChange={(event) => setManual({ ...manual, entryDate: event.target.value })} /></label>
                <div className="grid grid-cols-[1fr_7rem] gap-3">
                  <label className="grid gap-2 text-sm font-medium">Amount<Input inputMode="decimal" required placeholder="0.00" value={manual.amount} onChange={(event) => setManual({ ...manual, amount: event.target.value })} /></label>
                  <label className="grid gap-2 text-sm font-medium">Currency<select className={selectClassName} value={manual.currencyCode} onChange={(event) => setManual({ ...manual, currencyCode: event.target.value })}>{data.supportedCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
                </div>
                <label className="grid gap-2 text-sm font-medium">Category<Input maxLength={100} required value={manual.category} onChange={(event) => setManual({ ...manual, category: event.target.value })} /></label>
                <label className="grid gap-2 text-sm font-medium">Description<textarea maxLength={500} required value={manual.description} onChange={(event) => setManual({ ...manual, description: event.target.value })} className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm" /></label>
                <Button type="submit" disabled={saving}>{saving ? 'Saving...' : `Add ${manual.type === 'INCOME' ? 'income' : 'expense'}`}</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Etsy sync status</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {data.shops.map((shop) => <div key={shop.etsyShopId} className="rounded-md border p-3"><div className="font-medium">{shop.shopName}</div><div className="mt-1 text-muted-foreground">{shop.fullSyncCompleted ? 'Incremental sync enabled' : 'First historical import required'}</div><div className="text-muted-foreground">Last successful sync: {formatDateTime(shop.lastSuccessfulSyncAt)}</div>{shop.status === 'FAILED' && shop.lastError ? <div className="mt-2 text-destructive">{shop.lastError}</div> : null}</div>)}
              {data.shops.length === 0 ? <p className="text-muted-foreground">No Etsy shops available.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {data.categoryTotals.length > 0 ? (
        <Card><CardHeader><CardTitle>Totals by category</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Currency</TableHead><TableHead className="text-right">Income</TableHead><TableHead className="text-right">Expenses</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader><TableBody>{data.categoryTotals.map((total) => <TableRow key={`${total.category}-${total.currencyCode}`}><TableCell>{total.category}</TableCell><TableCell>{total.currencyCode}</TableCell><TableCell className="text-right">{formatMoney(total.incomeMinorUnits, total.currencyCode)}</TableCell><TableCell className="text-right">{formatMoney(total.expenseMinorUnits, total.currencyCode)}</TableCell><TableCell className="text-right">{formatMoney(total.netMinorUnits, total.currencyCode)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      ) : null}

      <p className="text-xs text-muted-foreground">The term “Etsy” is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.</p>
    </div>
  );
}
