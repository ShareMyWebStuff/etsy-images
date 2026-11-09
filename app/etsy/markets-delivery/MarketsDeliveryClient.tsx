'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Archive, Copy, Download, Pencil, Plus, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ISO_COUNTRY_CODES } from '@/lib/iso-country-codes';
import { currencyMinorDigits, type DeliveryAffectedListing, type DeliveryDestinationInput, type DeliveryProfile, type DeliveryProfileValues, type DeliverySyncStatus, type MarketsDeliveryPageData } from '@/lib/markets-delivery-types';

const checkboxClassName = 'h-4 w-4 rounded border-input accent-primary';
const selectClassName = 'h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm';
const textareaClassName = 'min-h-28 min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const countryNames = new Intl.DisplayNames(['en-GB'], { type: 'region' });
const COUNTRY_OPTIONS = ISO_COUNTRY_CODES.map((code) => ({ code, name: countryNames.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));
const EUROPE_CODES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
const COUNTRY_GROUPS = [
  { name: 'United Kingdom', codes: ['GB'] },
  { name: 'United States', codes: ['US'] },
  { name: 'Canada', codes: ['CA'] },
  { name: 'Australia', codes: ['AU'] },
  { name: 'Selected European countries', codes: EUROPE_CODES },
];
const STATUS_LABELS: Record<DeliverySyncStatus, string> = { LOCAL_ONLY: 'Local only', PENDING: 'Pending changes', SYNCED: 'Synced', CONFLICT: 'Conflict', FAILED: 'Failed' };

type DestinationDraft = {
  countryCode: string;
  primaryCost: string;
  secondaryCost: string;
  freeDelivery: boolean;
  transitMode: 'range' | 'service';
  minDeliveryDays: string;
  maxDeliveryDays: string;
  carrierId: string;
  mailClass: string;
};
type ProfileDraft = {
  name: string;
  currencyCode: string;
  originCountryIso: string;
  originPostalCode: string;
  readinessStateId: string;
  includeDeliveryInformation: boolean;
  deliveryInformation: string;
  destinations: DestinationDraft[];
};
type Action = 'create' | 'update' | 'duplicate' | 'archive' | 'import' | 'sync' | 'impact' | 'reload-remote';
type ApiPayload = { data?: MarketsDeliveryPageData; affectedListings?: DeliveryAffectedListing[]; importedCount?: number; error?: string };
type Metadata = { readinessProfiles?: Array<{ readinessStateId: string; label?: string; minProcessingDays?: number; maxProcessingDays?: number }> };

function countryLabel(code: string) {
  if (code === '*') return 'Everywhere Else / worldwide';
  if (code === 'region:eu') return 'European Union region';
  if (code === 'region:non_eu') return 'Non-European Union region';
  return `${countryNames.of(code) ?? code} (${code})`;
}

function destinationSummary(profile: DeliveryProfile) {
  if (!profile.destinations.length) return 'No destinations selected';
  return profile.destinations.map((destination) => countryLabel(destination.countryCode)).join(', ');
}

function amountText(value: number, currency: string) {
  return (value / (10 ** currencyMinorDigits(currency))).toFixed(currencyMinorDigits(currency));
}

function makeDraft(profile: DeliveryProfile | null, currencyCode: string | null): ProfileDraft {
  return {
    name: profile?.name ?? '',
    currencyCode: profile?.currencyCode ?? currencyCode ?? '',
    originCountryIso: profile?.originCountryIso ?? '',
    originPostalCode: profile?.originPostalCode ?? '',
    readinessStateId: profile?.readinessStateId ?? '',
    includeDeliveryInformation: profile?.includeDeliveryInformation ?? false,
    deliveryInformation: profile?.deliveryInformation ?? '',
    destinations: profile?.destinations.map((destination) => ({
      countryCode: destination.countryCode,
      primaryCost: amountText(destination.primaryCostMinor, profile.currencyCode),
      secondaryCost: amountText(destination.secondaryCostMinor, profile.currencyCode),
      freeDelivery: destination.primaryCostMinor === 0 && destination.secondaryCostMinor === 0,
      transitMode: destination.carrierId && destination.mailClass ? 'service' : 'range',
      minDeliveryDays: destination.minDeliveryDays?.toString() ?? '',
      maxDeliveryDays: destination.maxDeliveryDays?.toString() ?? '',
      carrierId: destination.carrierId ?? '',
      mailClass: destination.mailClass ?? '',
    })) ?? [],
  };
}

function moneyMinor(value: string, currency: string, label: string) {
  const digits = currencyMinorDigits(currency);
  const pattern = digits > 0 ? new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`) : /^\d+$/;
  if (!pattern.test(value.trim())) throw new Error(`Enter a valid ${label} in ${currency}, with up to ${digits} decimal places.`);
  const [whole, fraction = ''] = value.trim().split('.');
  const minor = Number(whole) * (10 ** digits) + Number(fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error(`The ${label} is too large.`);
  return minor;
}

function profileValues(draft: ProfileDraft): DeliveryProfileValues {
  const currencyCode = draft.currencyCode.trim().toUpperCase();
  if (!draft.name.trim() || draft.name.trim().length > 100) throw new Error('Enter a profile name between 1 and 100 characters.');
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error('Enter the shop currency as a three-letter code.');
  try { currencyMinorDigits(currencyCode); } catch { throw new Error('Enter a valid shop currency.'); }
  if (!ISO_COUNTRY_CODES.includes(draft.originCountryIso)) throw new Error('Choose the dispatch origin country.');
  if (!draft.destinations.length) throw new Error('Select at least one delivery country.');
  if (draft.deliveryInformation.length > 10000) throw new Error('Delivery wording must be 10,000 characters or fewer.');
  if (draft.readinessStateId && !/^[1-9]\d*$/.test(draft.readinessStateId)) throw new Error('Enter a valid Etsy processing profile ID.');
  const destinations = draft.destinations.map((destination): DeliveryDestinationInput => {
    const label = countryLabel(destination.countryCode);
    let minDeliveryDays: number | null = null;
    let maxDeliveryDays: number | null = null;
    if (destination.transitMode === 'range') {
      minDeliveryDays = Number(destination.minDeliveryDays);
      maxDeliveryDays = Number(destination.maxDeliveryDays);
      if (!/^\d+$/.test(destination.minDeliveryDays) || !/^\d+$/.test(destination.maxDeliveryDays) || minDeliveryDays < 1 || maxDeliveryDays > 45 || minDeliveryDays > maxDeliveryDays) {
        throw new Error(`Enter a transit range from 1 to 45 days for ${label}.`);
      }
    } else if (!/^[1-9]\d*$/.test(destination.carrierId) || !destination.mailClass.trim()) {
      throw new Error(`Enter the Etsy carrier ID and mail class for ${label}, or use a transit range.`);
    }
    return {
      countryCode: destination.countryCode,
      primaryCostMinor: destination.freeDelivery ? 0 : moneyMinor(destination.primaryCost, currencyCode, `first-item charge for ${label}`),
      secondaryCostMinor: destination.freeDelivery ? 0 : moneyMinor(destination.secondaryCost, currencyCode, `additional-item charge for ${label}`),
      minDeliveryDays,
      maxDeliveryDays,
      carrierId: destination.transitMode === 'service' ? destination.carrierId.trim() : null,
      mailClass: destination.transitMode === 'service' ? destination.mailClass.trim() : null,
    };
  });
  return { name: draft.name.trim(), currencyCode, originCountryIso: draft.originCountryIso, originPostalCode: draft.originPostalCode.trim(), readinessStateId: draft.readinessStateId.trim() || null, includeDeliveryInformation: draft.includeDeliveryInformation, deliveryInformation: draft.deliveryInformation, destinations };
}

function AffectedListings({ listings }: { listings: DeliveryAffectedListing[] }) {
  if (!listings.length) return <p className="text-sm text-muted-foreground">No local physical listings use this profile.</p>;
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-3" aria-label="Affected listings">
      {listings.map((listing) => (
        <details key={`${listing.listingId}-${listing.variant}`} className="rounded-md border bg-background p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {listing.listingName} — {listing.variant === 'print' ? 'Print / Frames' : 'Customised Print'}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{listing.etsyListingId ? `Etsy ${listing.etsyListingId}` : 'Not yet on Etsy'} · {listing.inherited ? 'Inherited' : 'Listing override'}</span>
          </summary>
          {listing.templateName ? <p className="mt-2 text-xs text-muted-foreground">Template: {listing.templateName}</p> : null}
          <p className="mt-3 text-xs font-medium">Final customer description preview</p>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm">{listing.descriptionPreview || 'Description is empty.'}</pre>
        </details>
      ))}
    </div>
  );
}

export function MarketsDeliveryClient({ initialData, initialProfileId }: { initialData: MarketsDeliveryPageData; initialProfileId?: string }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DeliveryProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(() => makeDraft(null, initialData.currencyCode));
  const [formError, setFormError] = useState<string | null>(null);
  const [countrySearch, setCountrySearch] = useState('');
  const [affected, setAffected] = useState<DeliveryAffectedListing[] | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const [impactFingerprint, setImpactFingerprint] = useState<string | null>(null);
  const [syncTarget, setSyncTarget] = useState<DeliveryProfile | null>(null);
  const [syncConfirmed, setSyncConfirmed] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<DeliveryProfile | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [metadata, setMetadata] = useState<Metadata | null>(null);

  async function action(actionName: Action, details: Record<string, unknown> = {}) {
    const response = await fetch('/api/etsy/markets-delivery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId: data.shopId, action: actionName, ...details }),
    });
    const payload = await response.json() as ApiPayload;
    if (payload.data) setData(payload.data);
    if (!response.ok || payload.error) {
      if (!payload.data && ['sync', 'import', 'reload-remote'].includes(actionName)) {
        try {
          const refresh = await fetch(`/api/etsy/markets-delivery?shopId=${encodeURIComponent(data.shopId)}`);
          const refreshed = await refresh.json() as ApiPayload;
          if (refresh.ok && refreshed.data) setData(refreshed.data);
        } catch { /* Preserve the original action error if the status refresh also fails. */ }
      }
      throw new Error(payload.error ?? 'Unable to complete the delivery-profile action.');
    }
    return payload;
  }

  function openEditor(profile: DeliveryProfile | null) {
    if (profile?.isCalculated) return;
    setEditTarget(profile);
    setDraft(makeDraft(profile, data.currencyCode));
    setFormError(null); setAffected(null); setImpactConfirmed(false); setImpactFingerprint(null); setCountrySearch('');
    setEditorOpen(true);
  }

  useEffect(() => {
    if (!initialProfileId) return;
    const profile = initialData.profiles.find((item) => item.id === initialProfileId && !item.archivedAt && !item.isCalculated);
    if (profile) {
      setEditTarget(profile); setDraft(makeDraft(profile, initialData.currencyCode)); setEditorOpen(true);
    }
  }, [initialData, initialProfileId]);

  useEffect(() => {
    if (syncTarget) {
      const latest = data.profiles.find((profile) => profile.id === syncTarget.id) ?? null;
      if (latest?.syncStatus !== syncTarget.syncStatus) setSyncConfirmed(false);
      setSyncTarget(latest);
    }
  }, [data, syncTarget]);

  function updateDraft<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setImpactConfirmed(false);
  }

  function addCountries(codes: string[]) {
    setDraft((current) => ({ ...current, destinations: [...current.destinations, ...codes.filter((code) => !current.destinations.some((destination) => destination.countryCode === code)).map((countryCode): DestinationDraft => ({ countryCode, primaryCost: '', secondaryCost: '', freeDelivery: false, transitMode: 'range', minDeliveryDays: '', maxDeliveryDays: '', carrierId: '', mailClass: '' }))] }));
    setImpactConfirmed(false);
  }

  function updateDestination(code: string, values: Partial<DestinationDraft>) {
    updateDraft('destinations', draft.destinations.map((destination) => destination.countryCode === code ? { ...destination, ...values } : destination));
  }

  async function switchShop(shopId: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/etsy/markets-delivery?shopId=${encodeURIComponent(shopId)}`);
      const payload = await response.json() as ApiPayload;
      if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Unable to load this shop.');
      setData(payload.data); setMetadata(null); setEditorOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load this shop.'); }
    finally { setBusy(false); }
  }

  async function previewImpact() {
    if (!editTarget) return;
    setFormError(null); setImpactLoading(true);
    try {
      const values = profileValues(draft);
      const payload = await action('impact', { profileId: editTarget.id, values });
      setAffected(payload.affectedListings ?? []); setImpactFingerprint(JSON.stringify(values)); setImpactConfirmed(false);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Unable to preview affected listings.'); }
    finally { setImpactLoading(false); }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError(null); setNotice(null);
    let values: DeliveryProfileValues;
    try {
      if (!data.currencyCode) throw new Error('Import from Etsy to confirm this shop’s currency before saving delivery charges.');
      if (draft.currencyCode !== data.currencyCode) throw new Error('Use the current shop currency and re-enter each delivery charge before saving.');
      values = profileValues(draft);
      if (editTarget?.linkedListingCount && (!impactConfirmed || impactFingerprint !== JSON.stringify(values))) throw new Error('Preview the affected listings and confirm the shared-profile changes before saving.');
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Check the profile fields.'); return; }
    setBusy(true);
    try {
      await action(editTarget ? 'update' : 'create', { ...(editTarget ? { profileId: editTarget.id, expectedRevision: editTarget.revision } : {}), values, confirmAffected: impactConfirmed });
      setEditorOpen(false); setNotice('Saved locally. Use Sync to Etsy when you are ready to apply the profile to Etsy.');
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Unable to save the profile.'); }
    finally { setBusy(false); }
  }

  async function beginSync(profile: DeliveryProfile) {
    setSyncTarget(profile); setSyncConfirmed(false); setAffected(null); setError(null); setImpactLoading(true);
    try { const payload = await action('impact', { profileId: profile.id }); setAffected(payload.affectedListings ?? []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to preview affected listings.'); }
    finally { setImpactLoading(false); }
  }

  async function runAction(actionName: Action, profile: DeliveryProfile | null, details: Record<string, unknown> = {}) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload = await action(actionName, { ...(profile ? { profileId: profile.id, expectedRevision: profile.revision } : {}), ...details });
      setArchiveTarget(null); setImportOpen(false); setSyncTarget(null);
      setNotice(actionName === 'sync' ? 'Delivery profile synced. Listing assignments and descriptions remain pending until their listing sync succeeds.' : actionName === 'import' ? `Imported ${payload.importedCount ?? 0} Etsy delivery profiles. Existing local edits were preserved.` : actionName === 'duplicate' ? 'Profile duplicated locally. Edit its countries and rates before syncing.' : actionName === 'archive' ? 'Profile archived locally. Its Etsy profile has been retained.' : 'Local profile replaced with the current Etsy version.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to complete the delivery-profile action.'); }
    finally { setBusy(false); }
  }

  async function loadMetadata() {
    setImpactLoading(true); setFormError(null);
    try {
      const response = await fetch(`/api/etsy/markets-delivery/metadata?shopId=${encodeURIComponent(data.shopId)}`);
      const payload = await response.json() as Metadata & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load Etsy processing profiles.');
      setMetadata(payload);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Unable to load Etsy processing profiles.'); }
    finally { setImpactLoading(false); }
  }

  const displayedProfiles = data.profiles.filter((profile) => showArchived || !profile.archivedAt);
  const filteredCountries = COUNTRY_OPTIONS.filter((country) => `${country.name} ${country.code}`.toLowerCase().includes(countrySearch.trim().toLowerCase()));
  const remoteBusy = busy || impactLoading;
  const draftCurrencyMismatch = Boolean(data.currencyCode && draft.currencyCode !== data.currencyCode);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">Markets &amp; Delivery</h1><p className="mt-1 text-sm text-muted-foreground">Reusable delivery profiles for physical Etsy listings.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={remoteBusy || !data.shopId || !data.connection.canRead} onClick={() => { setError(null); setImportOpen(true); }}><Download className="h-4 w-4" aria-hidden="true" />Import from Etsy</Button>
          <Button disabled={remoteBusy || !data.shopId || !data.currencyCode} onClick={() => openEditor(null)}><Plus className="h-4 w-4" aria-hidden="true" />Create profile</Button>
        </div>
      </div>
      {data.shopId && !data.currencyCode ? <p className="rounded-md border bg-muted/30 p-4 text-sm">The shop currency is not confirmed. Import from Etsy to refresh it before creating, editing or syncing delivery charges. Existing profiles can still be reviewed locally.</p> : null}
      {!data.shops.length ? <p className="rounded-md border bg-muted/30 p-4 text-sm">Add a shop on the <Link className="font-medium underline" href="/shops">Shops page</Link> before managing its delivery profiles.</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <label className="grid w-full max-w-sm gap-2 text-sm font-medium">Shop
          <select className={selectClassName} value={data.shopId} disabled={remoteBusy} onChange={(event) => void switchShop(event.target.value)} aria-label="Shop">
            {!data.shops.length ? <option value="">No connected shops</option> : data.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
        </label>
        <p className="text-sm text-muted-foreground">Shop currency: <span className="font-medium text-foreground">{data.currencyCode ?? 'Not yet confirmed'}</span></p>
      </div>
      {data.connection.message ? <div className="rounded-md border bg-muted/30 p-4 text-sm"><p>{data.connection.message}</p>{!data.connection.connected || !data.connection.canRead || !data.connection.canWrite ? <Link href="/connect-etsy" className="mt-2 inline-block font-medium underline">Reconnect Etsy</Link> : null}</div> : null}
      {error && !syncTarget && !archiveTarget && !importOpen ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">{notice}</p> : null}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Profile / destinations</TableHead><TableHead>Etsy profile</TableHead><TableHead>Linked listings</TableHead><TableHead>Status</TableHead><TableHead>Last successful sync</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{displayedProfiles.length ? displayedProfiles.map((profile) => (
              <TableRow key={profile.id}>
                <TableCell className="max-w-sm"><p className="font-medium">{profile.name}{profile.archivedAt ? ' (Archived)' : ''}</p><p className="mt-1 text-xs text-muted-foreground">{destinationSummary(profile)}</p>{profile.destinations.some((destination) => destination.countryCode === '*' || destination.countryCode.startsWith('region:')) ? <p className="mt-2 text-xs font-medium text-destructive">Imported worldwide or regional coverage is enabled. Review its scope before syncing.</p> : null}{profile.isCalculated ? <p className="mt-2 text-xs text-muted-foreground">Calculated Etsy profile: assign it to listings here; manage its rates in Etsy. The API cannot edit or duplicate calculated profiles.</p> : null}{data.currencyCode && profile.currencyCode !== data.currencyCode ? <p className="mt-2 text-xs font-medium text-destructive">Saved charges use {profile.currencyCode}; this shop now uses {data.currencyCode}. Edit the profile and re-enter rates before syncing.</p> : null}</TableCell>
                <TableCell className="tabular-nums">{profile.etsyShippingProfileId ?? 'Not linked'}</TableCell>
                <TableCell className="tabular-nums">{profile.linkedListingCount}</TableCell>
                <TableCell><Badge variant={profile.syncStatus === 'FAILED' || profile.syncStatus === 'CONFLICT' ? 'destructive' : profile.syncStatus === 'SYNCED' ? 'secondary' : 'outline'}>{STATUS_LABELS[profile.syncStatus]}</Badge>{profile.error ? <p className="mt-2 max-w-xs text-xs text-destructive">{profile.error}</p> : null}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{profile.lastSyncedAt ? new Date(profile.lastSyncedAt).toLocaleString('en-GB') : 'Never'}</TableCell>
                <TableCell><div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={remoteBusy || Boolean(profile.archivedAt) || profile.isCalculated} onClick={() => openEditor(profile)} aria-label={`Edit ${profile.name}`}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</Button>
                  <Button size="sm" variant="outline" disabled={remoteBusy || profile.isCalculated} onClick={() => void runAction('duplicate', profile)} aria-label={`Duplicate ${profile.name}`}><Copy className="h-3.5 w-3.5" aria-hidden="true" />Duplicate</Button>
                  <Button size="sm" variant="outline" disabled={remoteBusy || Boolean(profile.archivedAt)} onClick={() => { setError(null); setArchiveTarget(profile); }} aria-label={`Archive ${profile.name}`}><Archive className="h-3.5 w-3.5" aria-hidden="true" />Archive</Button>
                  <Button size="sm" disabled={remoteBusy || Boolean(profile.archivedAt) || profile.isCalculated || !data.connection.canWrite || !data.currencyCode || profile.currencyCode !== data.currencyCode} onClick={() => void beginSync(profile)} aria-label={`Sync ${profile.name} to Etsy`}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Sync to Etsy</Button>
                </div></TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No local delivery profiles. Create one or import your existing Etsy profiles.</TableCell></TableRow>}</TableBody>
          </Table>
        </CardContent>
      </Card>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className={checkboxClassName} checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Show archived profiles</label>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Physical listing and origin limits</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Etsy uses one delivery profile for an entire physical listing. Framed and unframed variations share its delivery charges; they cannot have separate profiles.</p><p>Each Etsy delivery profile has one dispatch origin. PrintShrimp may fulfil from different locations; choose an origin that accurately represents the product. This page does not assume UK dispatch or support a different origin per destination.</p><p>Digital downloads do not receive physical delivery profiles or this delivery wording.</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Costs and profit estimates</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p className="font-medium text-foreground">Cost unavailable</p><p>{data.pricing.message}</p><p>Country selection does not imply equal PrintShrimp costs. Check each destination and product before setting delivery charges.</p></CardContent></Card>
      </div>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!busy) setEditorOpen(open); }}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <form className="min-w-0 space-y-6" onSubmit={(event) => void saveProfile(event)}>
            <DialogHeader><DialogTitle>{editTarget ? `Edit ${editTarget.name}` : 'Create delivery profile'}</DialogTitle><DialogDescription>Save a reusable local profile. Sync to Etsy is a separate action.</DialogDescription></DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">Profile name<Input aria-label="Profile name" maxLength={100} value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} /></label>
              <label className="grid gap-2 text-sm font-medium">Currency<Input aria-label="Currency" value={draft.currencyCode} disabled placeholder="Shop currency not confirmed" /></label>
            </div>
            {!data.currencyCode ? <p className="text-sm text-muted-foreground">Import from Etsy to confirm the shop currency before saving. The existing charges are shown in their saved currency.</p> : null}
            {draftCurrencyMismatch ? <div className="space-y-3 rounded-md border border-destructive p-4 text-sm"><p>This profile uses {draft.currencyCode}; the shop uses {data.currencyCode}. Confirm the current currency and re-enter every delivery rate. Amounts are not converted automatically.</p><Button type="button" variant="outline" className="h-auto whitespace-normal py-2" onClick={() => { setDraft((current) => ({ ...current, currencyCode: data.currencyCode!, destinations: current.destinations.map((destination) => ({ ...destination, primaryCost: '', secondaryCost: '', freeDelivery: false })) })); setImpactConfirmed(false); }}>Use {data.currencyCode} and clear rates for review</Button></div> : null}
            <fieldset className="min-w-0 space-y-4 rounded-lg border p-4"><legend className="px-1 text-sm font-semibold">Dispatch origin</legend>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">Origin country<select aria-label="Origin country" className={selectClassName} value={draft.originCountryIso} onChange={(event) => updateDraft('originCountryIso', event.target.value)}><option value="">Choose the actual dispatch country</option>{COUNTRY_OPTIONS.map((country) => <option key={country.code} value={country.code}>{country.name} ({country.code})</option>)}</select></label>
                <label className="grid gap-2 text-sm font-medium">Origin postal code<Input aria-label="Origin postal code" maxLength={32} value={draft.originPostalCode} onChange={(event) => updateDraft('originPostalCode', event.target.value)} /><span className="text-xs font-normal text-muted-foreground">Required by Etsy for origins with postal codes.</span></label>
              </div><p className="text-xs text-muted-foreground">One origin applies to the whole Etsy profile. Confirm the fulfilment location instead of assuming UK dispatch.</p>
            </fieldset>
            <fieldset className="min-w-0 space-y-4 rounded-lg border p-4"><legend className="px-1 text-sm font-semibold">Processing / readiness</legend>
              <div className="flex flex-wrap items-end gap-3"><label className="grid min-w-0 basis-64 flex-1 gap-2 text-sm font-medium">Etsy processing profile ID<Input aria-label="Etsy processing profile ID" value={draft.readinessStateId} inputMode="numeric" placeholder="Keep the listing's current processing profile" onChange={(event) => updateDraft('readinessStateId', event.target.value)} /></label><Button type="button" variant="outline" disabled={remoteBusy || !data.connection.canRead} onClick={() => void loadMetadata()}>Load Etsy processing profiles</Button></div>
              {metadata?.readinessProfiles ? <label className="grid gap-2 text-sm font-medium">Choose an Etsy processing profile<select className={selectClassName} value={draft.readinessStateId} onChange={(event) => updateDraft('readinessStateId', event.target.value)}><option value="">Keep current processing profile</option>{metadata.readinessProfiles.map((profile) => <option key={profile.readinessStateId} value={profile.readinessStateId}>{profile.label ?? `Processing profile ${profile.readinessStateId}`}{profile.minProcessingDays !== undefined ? ` (${profile.minProcessingDays}–${profile.maxProcessingDays ?? profile.minProcessingDays} processing days)` : ''}</option>)}</select></label> : null}
              <p className="text-xs text-muted-foreground">Processing is the time before dispatch. It is stored separately from the destination transit times below. Create or edit processing profiles in Etsy.</p>
            </fieldset>
            <fieldset className="min-w-0 space-y-4 rounded-lg border p-4"><legend className="px-1 text-sm font-semibold">Enabled delivery countries</legend>
              <p className="text-sm text-muted-foreground">No countries are added automatically. Groups select the listed countries; enter a separate rate for each one.</p>
              <div className="flex flex-wrap gap-2">{COUNTRY_GROUPS.map((group) => <Button key={group.name} type="button" size="sm" variant="outline" onClick={() => addCountries(group.codes)} title={group.codes.map(countryLabel).join(', ')}>Add {group.name}</Button>)}</div>
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Countries in the European group</summary><p className="mt-2">{EUROPE_CODES.map(countryLabel).join(', ')}</p></details>
              <Input aria-label="Search delivery countries" placeholder="Find an individual country" value={countrySearch} onChange={(event) => setCountrySearch(event.target.value)} />
              <div className="grid max-h-40 grid-cols-1 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3">{filteredCountries.map((country) => <label key={country.code} className="flex items-center gap-2 text-sm"><input type="checkbox" className={checkboxClassName} checked={draft.destinations.some((destination) => destination.countryCode === country.code)} onChange={(event) => event.target.checked ? addCountries([country.code]) : updateDraft('destinations', draft.destinations.filter((destination) => destination.countryCode !== country.code))} />{country.name} ({country.code})</label>)}</div>
              <p className="text-sm font-medium">Selected: {draft.destinations.length ? draft.destinations.map((destination) => countryLabel(destination.countryCode)).join(', ') : 'No countries selected'}</p>
              {draft.destinations.map((destination) => <div key={destination.countryCode} className="space-y-4 rounded-md border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{countryLabel(destination.countryCode)}</h3><Button type="button" size="sm" variant="ghost" aria-label={`Remove ${countryLabel(destination.countryCode)}`} onClick={() => updateDraft('destinations', draft.destinations.filter((item) => item.countryCode !== destination.countryCode))}>Remove</Button></div>
                {destination.countryCode === '*' || destination.countryCode.startsWith('region:') ? <p className="text-sm font-medium text-destructive">Imported broad coverage: this destination covers countries beyond individually selected ones. Remove it to restrict delivery to explicit countries.</p> : null}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className={checkboxClassName} checked={destination.freeDelivery} onChange={(event) => updateDestination(destination.countryCode, { freeDelivery: event.target.checked, ...(event.target.checked ? { primaryCost: '0', secondaryCost: '0' } : {}) })} />Free delivery for {countryLabel(destination.countryCode)} (both charges zero)</label>
                <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">First-item charge ({draft.currencyCode || 'shop currency'})<Input aria-label={`First-item charge for ${destination.countryCode}`} inputMode="decimal" value={destination.primaryCost} disabled={destination.freeDelivery} onChange={(event) => updateDestination(destination.countryCode, { primaryCost: event.target.value })} /></label><label className="grid gap-2 text-sm font-medium">Additional-item charge ({draft.currencyCode || 'shop currency'})<Input aria-label={`Additional-item charge for ${destination.countryCode}`} inputMode="decimal" value={destination.secondaryCost} disabled={destination.freeDelivery} onChange={(event) => updateDestination(destination.countryCode, { secondaryCost: event.target.value })} /></label></div>
                <label className="grid gap-2 text-sm font-medium">Delivery timing / service<select aria-label={`Delivery timing for ${destination.countryCode}`} className={selectClassName} value={destination.transitMode} onChange={(event) => updateDestination(destination.countryCode, { transitMode: event.target.value as 'range' | 'service' })}><option value="range">Transit day range</option><option value="service">Etsy carrier and mail class</option></select></label>
                {destination.transitMode === 'range' ? <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Minimum transit days<Input aria-label={`Minimum transit days for ${destination.countryCode}`} type="number" min={1} max={45} value={destination.minDeliveryDays} onChange={(event) => updateDestination(destination.countryCode, { minDeliveryDays: event.target.value })} /></label><label className="grid gap-2 text-sm font-medium">Maximum transit days<Input aria-label={`Maximum transit days for ${destination.countryCode}`} type="number" min={1} max={45} value={destination.maxDeliveryDays} onChange={(event) => updateDestination(destination.countryCode, { maxDeliveryDays: event.target.value })} /></label></div> : <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Etsy carrier ID<Input aria-label={`Etsy carrier ID for ${destination.countryCode}`} inputMode="numeric" value={destination.carrierId} onChange={(event) => updateDestination(destination.countryCode, { carrierId: event.target.value })} /></label><label className="grid gap-2 text-sm font-medium">Etsy mail class<Input aria-label={`Etsy mail class for ${destination.countryCode}`} value={destination.mailClass} onChange={(event) => updateDestination(destination.countryCode, { mailClass: event.target.value })} /></label></div>}
              </div>)}
            </fieldset>
            <fieldset className="min-w-0 space-y-4 rounded-lg border p-4"><legend className="px-1 text-sm font-semibold">Customer-facing delivery information</legend>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className={checkboxClassName} checked={draft.includeDeliveryInformation} onChange={(event) => updateDraft('includeDeliveryInformation', event.target.checked)} />Include delivery information in description by default</label>
              <label className="grid gap-2 text-sm font-medium">Delivery information<textarea aria-label="Delivery information" className={textareaClassName} maxLength={10000} value={draft.deliveryInformation} onChange={(event) => updateDraft('deliveryInformation', event.target.value)} placeholder="Enter your own accurate delivery information" /></label>
              <div className="rounded-md border bg-background p-4"><p className="text-xs font-semibold text-muted-foreground">Customer-facing delivery text preview</p>{draft.includeDeliveryInformation && draft.deliveryInformation.trim() ? <div className="mt-3 text-sm"><p className="font-semibold">Delivery</p><p className="mt-2 whitespace-pre-wrap">{draft.deliveryInformation}</p></div> : <p className="mt-2 text-sm text-muted-foreground">No Delivery section will be added by this profile default.</p>}</div>
              <p className="text-xs text-muted-foreground">Profile defaults can be overridden by a template, then by a listing. Wording does not enforce destination restrictions; the Etsy delivery profile does. Enter only claims that apply to your products.</p>
            </fieldset>
            {editTarget?.linkedListingCount ? <div className="space-y-3 rounded-lg border p-4"><p className="text-sm font-semibold">Shared profile: {editTarget.linkedListingCount} linked listings</p><p className="text-sm text-muted-foreground">Preview the affected physical listings before saving. Local changes become pending; applying this shared Etsy profile later affects its linked Etsy listings.</p><Button type="button" variant="outline" disabled={remoteBusy} onClick={() => void previewImpact()}>{impactLoading ? 'Loading preview...' : 'Preview affected listings'}</Button>{affected ? <AffectedListings listings={affected} /> : null}{affected ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" className={`${checkboxClassName} mt-0.5`} checked={impactConfirmed} onChange={(event) => setImpactConfirmed(event.target.checked)} />I have reviewed the affected listings for these changes.</label> : null}</div> : null}
            {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
            <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setEditorOpen(false)}>Cancel</Button><Button type="submit" disabled={remoteBusy || !data.currencyCode || draftCurrencyMismatch}>{busy ? 'Saving...' : 'Save locally'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={syncTarget !== null} onOpenChange={(open) => { if (!remoteBusy && !open) setSyncTarget(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sync {syncTarget?.name} to Etsy?</DialogTitle>
            <DialogDescription>This explicitly updates the linked Etsy delivery profile. Every Etsy listing using that profile can be affected, including listings managed directly in Etsy.</DialogDescription>
          </DialogHeader>
          {syncTarget ? <div className="space-y-2 rounded-md border bg-muted/20 p-4 text-sm">
            <p><span className="font-medium">Dispatch origin:</span> {countryLabel(syncTarget.originCountryIso)} {syncTarget.originPostalCode}</p>
            <p><span className="font-medium">Enabled destinations:</span> {destinationSummary(syncTarget)}</p>
            <div className="space-y-1 text-xs text-muted-foreground">{syncTarget.destinations.map((destination) => <p key={destination.countryCode}>{countryLabel(destination.countryCode)}: {amountText(destination.primaryCostMinor, syncTarget.currencyCode)} {syncTarget.currencyCode} first item, {amountText(destination.secondaryCostMinor, syncTarget.currencyCode)} {syncTarget.currencyCode} additional item; {destination.carrierId && destination.mailClass ? `carrier ${destination.carrierId}, ${destination.mailClass}` : `${destination.minDeliveryDays}–${destination.maxDeliveryDays} transit days`}</p>)}</div>
          </div> : null}
          {impactLoading ? <p role="status" className="text-sm">Loading affected listings...</p> : affected ? <AffectedListings listings={affected} /> : null}
          <p className="text-sm text-muted-foreground">Physical listing assignments and customer descriptions are sent through the normal listing-sync process. Review each final description above before continuing.</p>
          {syncTarget?.syncStatus === 'CONFLICT' ? <div className="space-y-3 rounded-md border border-destructive p-4">
            <p className="text-sm font-medium">The Etsy profile has changed since the last sync.</p>
            <p className="text-sm text-muted-foreground">You can replace this local profile with the current Etsy version, or explicitly overwrite the remote changes with the saved local version.</p>
            <Button type="button" variant="outline" disabled={remoteBusy} onClick={() => void runAction('reload-remote', syncTarget, { resolveConflict: 'import' })}>Replace local with Etsy version</Button>
          </div> : null}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className={`${checkboxClassName} mt-0.5`} checked={syncConfirmed} onChange={(event) => setSyncConfirmed(event.target.checked)} disabled={remoteBusy || affected === null} />{syncTarget?.syncStatus === 'CONFLICT' ? 'I reviewed the affected listings and want to overwrite the Etsy changes with this local profile.' : 'I reviewed the destinations and affected listings and want to sync this profile to Etsy.'}</label>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={remoteBusy} onClick={() => setSyncTarget(null)}>Cancel</Button>
            <Button type="button" disabled={remoteBusy || !syncConfirmed || affected === null} onClick={() => syncTarget && void runAction('sync', syncTarget, { confirmAffected: true, ...(syncTarget.syncStatus === 'CONFLICT' ? { resolveConflict: 'overwrite' } : {}) })}>{busy ? 'Syncing...' : syncTarget?.syncStatus === 'CONFLICT' ? 'Overwrite Etsy and sync' : 'Sync to Etsy'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveTarget !== null} onOpenChange={(open) => { if (!busy && !open) setArchiveTarget(null); }}><DialogContent><DialogHeader><DialogTitle>Archive {archiveTarget?.name}?</DialogTitle><DialogDescription>The profile is archived locally and retained in Etsy.</DialogDescription></DialogHeader>{archiveTarget?.linkedListingCount ? <p className="text-sm">This profile is assigned to {archiveTarget.linkedListingCount} listings. Choose replacement profiles in those listings or their templates before archiving.</p> : <p className="text-sm">This profile will no longer be available for new assignments. Its remote Etsy profile will not be deleted.</p>}{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setArchiveTarget(null)}>Cancel</Button><Button disabled={busy || Boolean(archiveTarget?.linkedListingCount)} onClick={() => archiveTarget && void runAction('archive', archiveTarget)}>{busy ? 'Archiving...' : 'Archive locally'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={importOpen} onOpenChange={(open) => { if (!busy) setImportOpen(open); }}><DialogContent><DialogHeader><DialogTitle>Import Etsy delivery profiles</DialogTitle><DialogDescription>Read this shop’s delivery profiles and save local copies, including their destination coverage. This does not change Etsy.</DialogDescription></DialogHeader><p className="text-sm">Existing unsynced local changes are preserved. Imported worldwide and regional coverage will be shown explicitly for review.</p>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setImportOpen(false)}>Cancel</Button><Button disabled={busy || !data.connection.canRead} onClick={() => void runAction('import', null)}>{busy ? 'Importing...' : 'Import profiles'}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
