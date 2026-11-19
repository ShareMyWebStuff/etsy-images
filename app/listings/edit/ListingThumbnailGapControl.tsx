'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ListingEditorContext, ListingEditorData } from '@/lib/listing-editor';

type Props = {
  context: ListingEditorContext;
  thumbnail: ListingEditorData['thumbnail'];
  disabled?: boolean;
  onAdjusted: (data: ListingEditorData) => void;
  onAdjustingChange?: (busy: boolean) => void;
};
type GapAnalysis = { eligible: boolean; reason?: string | null };
type GapResponse = {
  analysis: GapAnalysis | null;
  thumbnailVersion?: string | null;
  thumbnailIdentity?: { fileName: string; updatedAt: string | null } | null;
  changed?: boolean;
  data?: ListingEditorData;
  error?: string;
};
const endpoint = '/api/shops/listings/editor/thumbnail-gap';

export function ListingThumbnailGapControl({ context, thumbnail, disabled = false, onAdjusted, onAdjustingChange }: Props) {
  const inputId = useId();
  const validationId = useId();
  const [gap, setGap] = useState('5');
  const [analysis, setAnalysis] = useState<GapAnalysis | null>(null);
  const [analysisIdentity, setAnalysisIdentity] = useState<string | null>(null);
  const [thumbnailVersion, setThumbnailVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({
    shopId: context.shopId,
    sectionId: context.sectionId,
    subSectionId: context.subSectionId,
    listingId: context.listingId,
  }).toString();
  const identity = JSON.stringify([query, thumbnail?.fileName ?? null, thumbnail?.updatedAt ?? null]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const mounted = useRef(false);
  const analysisRequest = useRef(0);
  const adjustmentRequest = useRef(0);
  const adjustmentLocked = useRef(false);
  const adjustmentController = useRef<AbortController | null>(null);
  const adjustedCallback = useRef(onAdjusted);
  adjustedCallback.current = onAdjusted;
  const adjustingCallback = useRef(onAdjustingChange);
  adjustingCallback.current = onAdjustingChange;
  const notifiedAdjusting = useRef(false);

  function notifyAdjusting(busy: boolean) {
    if (notifiedAdjusting.current === busy) return;
    notifiedAdjusting.current = busy;
    adjustingCallback.current?.(busy);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      adjustmentRequest.current += 1;
      adjustmentController.current?.abort();
      notifyAdjusting(false);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++analysisRequest.current;
    const requestIdentity = identity;
    adjustmentRequest.current += 1;
    adjustmentController.current?.abort();
    adjustmentLocked.current = false;
    notifyAdjusting(false);
    setAdjusting(false);
    setLoading(true);
    setAnalysis(null);
    setAnalysisIdentity(null);
    setThumbnailVersion(null);
    setError(null);
    setMessage(null);
    const current = () => mounted.current && !controller.signal.aborted
      && analysisRequest.current === request && currentIdentity.current === requestIdentity;
    fetch(`${endpoint}?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as GapResponse;
        if (!response.ok) throw new Error(result.error ?? 'Unable to check the thumbnail gap.');
        if ('thumbnailIdentity' in result) {
          const matchesPreview = thumbnail
            ? result.thumbnailIdentity?.fileName === thumbnail.fileName && result.thumbnailIdentity.updatedAt === thumbnail.updatedAt
            : result.thumbnailIdentity === null;
          if (!matchesPreview) throw new Error('The thumbnail changed. Reload the listing before adjusting its gap.');
        }
        if (result.analysis !== null && typeof result.analysis?.eligible !== 'boolean') throw new Error('The thumbnail gap check returned an invalid result.');
        if (result.analysis?.eligible && !result.thumbnailVersion) throw new Error('The thumbnail version could not be checked. Retry before adjusting it.');
        if (!current()) return;
        setAnalysis(result.analysis);
        setAnalysisIdentity(requestIdentity);
        setThumbnailVersion(result.thumbnailVersion ?? null);
      })
      .catch((failure: unknown) => {
        if (current()) setError(failure instanceof Error ? failure.message : 'Unable to check the thumbnail gap.');
      })
      .finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, [identity, query, retry]);

  const gapPercent = Number(gap);
  const validGap = gap.trim() !== '' && Number.isFinite(gapPercent) && gapPercent >= 0 && gapPercent <= 20;
  const canAdjust = Boolean(thumbnail && analysisIdentity === identity && analysis?.eligible && thumbnailVersion && validGap && !disabled && !loading && !adjusting && !error);

  async function adjustGap() {
    if (!canAdjust || adjustmentLocked.current || !thumbnailVersion) return;
    adjustmentLocked.current = true;
    notifyAdjusting(true);
    const controller = new AbortController();
    adjustmentController.current = controller;
    const request = ++adjustmentRequest.current;
    const requestIdentity = identity;
    const current = () => mounted.current && !controller.signal.aborted
      && adjustmentRequest.current === request && currentIdentity.current === requestIdentity;
    setAdjusting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ ...context, gapPercent, expectedThumbnailVersion: thumbnailVersion }),
      });
      const result = await response.json() as GapResponse;
      if (!current()) return;
      if (!response.ok) throw new Error(result.error ?? 'Unable to adjust the thumbnail gap.');
      if (typeof result.changed !== 'boolean') throw new Error('The thumbnail gap adjustment returned an invalid result.');
      if (result.analysis) setAnalysis(result.analysis);
      if (result.thumbnailVersion) setThumbnailVersion(result.thumbnailVersion);
      if (result.changed) {
        if (result.data) {
          setMessage('Thumbnail gap adjusted.');
          adjustedCallback.current(result.data);
        } else setMessage('Thumbnail gap adjusted. Reload the listing to see the updated thumbnail.');
      } else setMessage(result.analysis?.eligible === false && result.analysis.reason
        ? result.analysis.reason : 'The thumbnail already has this gap.');
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : 'Unable to adjust the thumbnail gap.');
    } finally {
      if (adjustmentRequest.current === request) {
        adjustmentLocked.current = false;
        adjustmentController.current = null;
        notifyAdjusting(false);
        if (current()) setAdjusting(false);
      }
    }
  }

  return <div className="grid gap-2">
    <label htmlFor={inputId} className="text-sm font-medium">Gap (%)</label>
    <div className="flex items-center gap-2">
      <Input id={inputId} type="number" min="0" max="20" step="any" className="w-20 shrink-0" value={gap}
        disabled={disabled || adjusting} aria-invalid={!validGap} aria-describedby={!validGap ? validationId : undefined}
        onChange={(event) => setGap(event.target.value)} />
      <Button type="button" size="sm" variant="outline" disabled={!canAdjust} onClick={adjustGap}>{adjusting ? 'Adjusting...' : 'Adjust Gap'}</Button>
    </div>
    {!validGap ? <p id={validationId} role="alert" className="text-xs text-destructive">Enter a gap from 0 to 20%.</p> : null}
    {!thumbnail ? <p className="text-xs text-muted-foreground">Upload a thumbnail to adjust its gap.</p>
      : loading ? <p role="status" className="text-xs text-muted-foreground">Checking thumbnail transparency...</p>
        : !error && analysis && !analysis.eligible ? <p className="text-xs text-muted-foreground">{analysis.reason || 'This thumbnail has no adjustable transparent gap.'}</p> : null}
    {error ? <div role="alert" className="flex items-start gap-2 text-xs text-destructive"><p>{error}</p><button type="button" className="shrink-0 underline" disabled={disabled || loading || adjusting} onClick={() => setRetry((value) => value + 1)}>Retry</button></div> : null}
    {message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}
  </div>;
}
