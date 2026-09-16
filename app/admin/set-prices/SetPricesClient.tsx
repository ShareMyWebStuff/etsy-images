'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, LoaderCircle, RefreshCw, Save, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatGbp, parseGbpInput, type ProductPriceKey } from '@/lib/set-prices-core';
import type { PriceUpdateJobView, SavePricesResult, SetPricesData } from '@/lib/set-prices';

type SetPricesClientProps = { initialData: SetPricesData };
type PendingNavigation = { type: 'href'; href: string } | { type: 'back' };

function valuesFromData(data: SetPricesData) {
  return Object.fromEntries(data.sections.flatMap((section) => section.prices.map((price) => [price.key, formatGbp(price.amountPence)]))) as Record<ProductPriceKey, string>;
}

function originalAmountsFromData(data: SetPricesData) {
  return Object.fromEntries(data.sections.flatMap((section) => section.prices.map((price) => [price.key, price.amountPence]))) as Record<ProductPriceKey, number>;
}

function jobStatusIcon(status: PriceUpdateJobView['items'][number]['status']) {
  if (status === 'updated') return <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />;
  if (status === 'skipped') return <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />;
  if (status === 'updating') return <LoaderCircle className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />;
  return <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}

export function SetPricesClient({ initialData }: SetPricesClientProps) {
  const [data, setData] = useState(initialData);
  const [values, setValues] = useState(() => valuesFromData(initialData));
  const [originalAmounts, setOriginalAmounts] = useState(() => originalAmountsFromData(initialData));
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SavePricesResult | null>(null);
  const [etsyConfirmOpen, setEtsyConfirmOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [job, setJob] = useState<PriceUpdateJobView | null>(initialData.latestJob);
  const guardPushed = useRef(false);
  const bypassPopState = useRef(false);
  const processingJob = useRef(false);

  const validationErrors = useMemo(() => Object.fromEntries(
    data.sections.flatMap((section) => section.prices.map((price) => [
      price.key,
      parseGbpInput(values[price.key] ?? '') === null ? 'Enter a positive GBP amount with no more than two decimal places.' : null,
    ]))
  ) as Record<ProductPriceKey, string | null>, [data.sections, values]);

  const changedKeys = useMemo(() => data.sections.flatMap((section) => section.prices)
    .filter((price) => parseGbpInput(values[price.key] ?? '') !== originalAmounts[price.key])
    .map((price) => price.key), [data.sections, originalAmounts, values]);
  const dirty = changedKeys.length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const continueNavigation = useCallback((navigation: PendingNavigation) => {
    const navigate = () => {
      if (navigation.type === 'back') window.history.back();
      else window.location.assign(navigation.href);
    };
    if (!guardPushed.current) {
      navigate();
      return;
    }
    bypassPopState.current = true;
    window.addEventListener('popstate', () => {
      guardPushed.current = false;
      bypassPopState.current = false;
      navigate();
    }, { once: true });
    window.history.back();
  }, []);

  useEffect(() => {
    if (dirty && !guardPushed.current) {
      window.history.pushState({ setPricesUnsavedGuard: true }, '', window.location.href);
      guardPushed.current = true;
    }
  }, [dirty]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onDocumentClick = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!target || target.target === '_blank' || target.download) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.href === window.location.href || destination.origin !== window.location.origin) return;
      event.preventDefault();
      setPendingNavigation({ type: 'href', href: destination.href });
      setLeaveConfirmOpen(true);
    };
    const onPopState = () => {
      if (bypassPopState.current) return;
      if (!dirtyRef.current) return;
      window.history.forward();
      setPendingNavigation({ type: 'back' });
      setLeaveConfirmOpen(true);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  async function parseResponse<T>(response: Response, fallback: string) {
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? fallback);
    return payload;
  }

  async function savePrices(openEtsyConfirmation: boolean) {
    setError(null);
    if (Object.values(validationErrors).some(Boolean)) {
      setError('Correct the invalid prices before saving.');
      return null;
    }
    setSaving(true);
    try {
      const prices = data.sections.flatMap((section) => section.prices.map((price) => ({
        key: price.key,
        amountPence: parseGbpInput(values[price.key] ?? ''),
      })));
      const response = await fetch('/api/admin/set-prices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices }),
      });
      const payload = await parseResponse<{ result: SavePricesResult }>(response, 'Unable to save prices.');
      setData(payload.result.data);
      setValues(valuesFromData(payload.result.data));
      setOriginalAmounts(originalAmountsFromData(payload.result.data));
      setSaveResult(payload.result);
      toast.success('Prices saved locally.');
      if (openEtsyConfirmation && payload.result.changedKeys.length > 0) setEtsyConfirmOpen(true);
      return payload.result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to save prices.';
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  const runJob = useCallback(async (startingJob: PriceUpdateJobView) => {
    if (processingJob.current) return;
    processingJob.current = true;
    setProcessing(true);
    setError(null);
    let current = startingJob;
    try {
      while (current.status !== 'completed') {
        const nextItem = current.items.find((item) => item.status === 'waiting');
        if (!nextItem) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const statusResponse = await fetch(`/api/admin/set-prices/jobs?jobId=${encodeURIComponent(current.id)}`);
          const statusPayload = await parseResponse<{ job: PriceUpdateJobView }>(statusResponse, 'Unable to refresh the Etsy price update.');
          current = statusPayload.job;
          setJob(current);
          continue;
        }
        if (nextItem) {
          setJob({
            ...current,
            status: 'running',
            currentListing: nextItem.listingName,
            items: current.items.map((item) => item.id === nextItem.id ? { ...item, status: 'updating' } : item),
          });
        }
        const response = await fetch('/api/admin/set-prices/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'process', jobId: current.id }),
        });
        const payload = await parseResponse<{ job: PriceUpdateJobView }>(response, 'Unable to continue the Etsy price update.');
        current = payload.job;
        setJob(current);
      }
      if (current.total > 0 && current.failed === 0 && current.skipped === 0) {
        setData((savedData) => ({
          ...savedData,
          pendingEtsy: {
            ...savedData.pendingEtsy,
            keys: savedData.pendingEtsy.keys.filter((key) => !current.changedKeys.includes(key)),
          },
        }));
      }
      if (current.failed > 0) toast.error(`${current.failed} Etsy listing${current.failed === 1 ? '' : 's'} failed to update.`);
      else toast.success(`Etsy price update completed: ${current.succeeded} updated, ${current.skipped} skipped.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to continue the Etsy price update.';
      setError(message);
      toast.error(message);
    } finally {
      processingJob.current = false;
      setProcessing(false);
    }
  }, []);

  useEffect(() => {
    if (job && job.status !== 'completed') void runJob(job);
  }, [job?.id, job?.status, runJob]);

  async function applyToEtsy() {
    if (!saveResult || processing) return;
    setEtsyConfirmOpen(false);
    setProcessing(true);
    try {
      const response = await fetch('/api/admin/set-prices/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', changedKeys: saveResult.changedKeys }),
      });
      const payload = await parseResponse<{ job: PriceUpdateJobView }>(response, 'Unable to start the Etsy price update.');
      setJob(payload.job);
      setProcessing(false);
      await runJob(payload.job);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to start the Etsy price update.';
      setError(message);
      toast.error(message);
      setProcessing(false);
      setEtsyConfirmOpen(true);
    }
  }

  async function retryFailed() {
    if (!job || processing) return;
    setProcessing(true);
    try {
      const response = await fetch('/api/admin/set-prices/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry', jobId: job.id }),
      });
      const payload = await parseResponse<{ job: PriceUpdateJobView }>(response, 'Unable to retry failed listings.');
      setJob(payload.job);
      setProcessing(false);
      await runJob(payload.job);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to retry failed listings.';
      setError(message);
      toast.error(message);
      setProcessing(false);
    }
  }

  async function saveAndLeave() {
    const navigation = pendingNavigation;
    if (!navigation) return;
    const result = await savePrices(false);
    if (!result) return;
    setLeaveConfirmOpen(false);
    continueNavigation(navigation);
  }

  function reviewPendingEtsyChanges() {
    if (data.pendingEtsy.keys.length === 0) return;
    setSaveResult({
      data,
      changedKeys: data.pendingEtsy.keys,
      affectedListings: data.pendingEtsy.affectedListings,
      skippedListings: data.pendingEtsy.skippedListings,
      deliveryWarnings: data.pendingEtsy.deliveryWarnings,
    });
    setEtsyConfirmOpen(true);
  }

  const progressPercent = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : job?.status === 'completed' ? 100 : 0;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Set Prices</h1>
        <p className="mt-2 text-muted-foreground">Manage base GBP prices locally, then explicitly choose whether to apply saved changes to Etsy.</p>
      </div>

      <div className="flex gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <p>Physical prices are base product prices. Delivery, Etsy fees, taxes and fulfilment costs vary by destination, so these prices do not guarantee a fixed worldwide profit. Delivery profiles are never changed from this screen.</p>
      </div>

      {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-destructive">{error}</p> : null}

      {data.sections.map((section) => (
        <Card key={section.key}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {section.prices.map((price) => (
              <div key={price.key} className="grid content-start gap-2">
                <label htmlFor={`price-${price.key}`} className="text-sm font-medium">{price.label}</label>
                <div className="relative max-w-xs">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">£</span>
                  <Input
                    id={`price-${price.key}`}
                    inputMode="decimal"
                    value={values[price.key] ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, [price.key]: event.target.value }))}
                    className="pl-7 tabular-nums"
                    aria-invalid={Boolean(validationErrors[price.key])}
                    aria-describedby={`price-${price.key}-help`}
                    disabled={saving}
                  />
                </div>
                <div id={`price-${price.key}-help`} className="min-h-5 text-xs">
                  {validationErrors[price.key] ? (
                    <span className="text-destructive">{validationErrors[price.key]}</span>
                  ) : section.key === 'customisation' ? (
                    <span className="text-muted-foreground">Saved locally as the default customisation fee</span>
                  ) : price.affectedListings > 0 ? (
                    <span className="text-muted-foreground">{price.affectedListings} mapped Etsy listing{price.affectedListings === 1 ? '' : 's'}</span>
                  ) : price.unsupportedMappings > 0 ? (
                    <span className="text-amber-700">No currently supported Etsy listings ({price.unsupportedMappings} mapping{price.unsupportedMappings === 1 ? '' : 's'} skipped)</span>
                  ) : section.key !== 'digital' ? (
                    <span className="text-amber-700">No Etsy listings currently mapped for this option</span>
                  ) : (
                    <span className="text-muted-foreground">No linked Etsy listings currently use this option</span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {data.deliveryWarnings.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Delivery-profile warnings</CardTitle></CardHeader>
          <CardContent><ul className="list-disc space-y-2 pl-5 text-sm">{data.deliveryWarnings.map((warning, index) => <li key={`${warning.listingId ?? 'general'}-${index}`}>{warning.message}</li>)}</ul></CardContent>
        </Card>
      ) : null}

      <div className="sticky bottom-4 flex flex-wrap justify-end gap-2 rounded-lg border border-border bg-card/95 p-4 shadow-lg backdrop-blur">
        <Button type="button" variant="outline" onClick={reviewPendingEtsyChanges} disabled={data.pendingEtsy.keys.length === 0 || saving || processing}>
          Review Etsy updates{data.pendingEtsy.keys.length > 0 ? ` (${data.pendingEtsy.keys.length})` : ''}
        </Button>
        <Button type="button" onClick={() => void savePrices(true)} disabled={!dirty || saving || processing}>
          <Save className="h-4 w-4" aria-hidden="true" />
          {saving ? 'Saving...' : 'Save prices'}
        </Button>
      </div>

      {job ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Etsy update progress</CardTitle>
              <CardDescription>{job.status === 'completed' ? 'Update completed.' : `Currently processing: ${job.currentListing ?? 'Waiting'}`}</CardDescription>
            </div>
            {job.failed > 0 && job.status === 'completed' ? (
              <Button type="button" variant="outline" onClick={retryFailed} disabled={processing}>
                <RefreshCw className={`h-4 w-4 ${processing ? 'animate-spin' : ''}`} aria-hidden="true" /> Retry failed
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div><span className="text-muted-foreground">Total</span><div className="text-lg font-semibold">{job.total}</div></div>
              <div><span className="text-muted-foreground">Processed</span><div className="text-lg font-semibold">{job.processed}</div></div>
              <div><span className="text-muted-foreground">Updated</span><div className="text-lg font-semibold text-green-700">{job.succeeded}</div></div>
              <div><span className="text-muted-foreground">Failed</span><div className="text-lg font-semibold text-destructive">{job.failed}</div></div>
              <div><span className="text-muted-foreground">Skipped</span><div className="text-lg font-semibold text-amber-700">{job.skipped}</div></div>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label="Etsy price update progress">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              {job.items.length > 0 ? job.items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0">
                  <div className="flex min-w-0 items-start gap-2">
                    {jobStatusIcon(item.status)}
                    <div className="min-w-0"><div className="font-medium">{item.listingName}</div>{item.message ? <div className="mt-1 text-muted-foreground">{item.message}</div> : null}</div>
                  </div>
                  <span className="shrink-0 capitalize text-muted-foreground">{item.status === 'updated' ? 'Updated' : item.status}</span>
                </div>
              )) : <p className="p-4 text-sm text-muted-foreground">No Etsy listings matched the changed product prices.</p>}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={etsyConfirmOpen} onOpenChange={(open) => { if (!processing) setEtsyConfirmOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply saved prices to Etsy?</DialogTitle></DialogHeader>
          <div className="grid gap-3 text-sm">
            <p>Your prices are saved locally. {saveResult?.affectedListings ?? 0} Etsy listing{saveResult?.affectedListings === 1 ? '' : 's'} can be updated from the changed options.</p>
            {(saveResult?.skippedListings ?? 0) > 0 ? <p className="text-amber-700">{saveResult!.skippedListings} mapped listing{saveResult!.skippedListings === 1 ? '' : 's'} will be skipped because its provider or exact Etsy variation is unsupported.</p> : null}
            {(saveResult?.deliveryWarnings.length ?? 0) > 0 ? <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"><strong>Delivery warning</strong><ul className="mt-2 list-disc pl-5">{saveResult!.deliveryWarnings.map((warning, index) => <li key={`${warning.listingId ?? 'warning'}-${index}`}>{warning.message}</li>)}</ul></div> : null}
            <p className="text-muted-foreground">Only matching listings and exact mapped variations will be updated. Etsy delivery profiles will not be changed.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEtsyConfirmOpen(false)} disabled={processing}>Not now</Button>
            <Button type="button" onClick={applyToEtsy} disabled={processing}>{processing ? 'Starting...' : 'Apply to Etsy'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leaveConfirmOpen} onOpenChange={(open) => { if (!saving) { setLeaveConfirmOpen(open); if (!open) setPendingNavigation(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save changes before leaving?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">You have unsaved price changes.</p>
          <DialogFooter className="sm:flex-wrap">
            <Button type="button" variant="outline" onClick={() => { setLeaveConfirmOpen(false); setPendingNavigation(null); }} disabled={saving}>Keep editing</Button>
            <Button type="button" variant="destructive" onClick={() => { const navigation = pendingNavigation; if (navigation) { setLeaveConfirmOpen(false); continueNavigation(navigation); } }} disabled={saving}>Leave without saving</Button>
            <Button type="button" onClick={saveAndLeave} disabled={saving}>{saving ? 'Saving...' : 'Save and leave'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
