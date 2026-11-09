'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { composeDeliveryDescription, MAX_ETSY_DESCRIPTION_LENGTH } from '@/lib/delivery-description';
import type { DeliveryProfile, DeliverySettingsInput, MarketsDeliverySettingsState } from '@/lib/markets-delivery-types';

type ListingContext = { shopId: string; sectionId: string; subSectionId: string; listingId: string };
type Props = {
  target: { type: 'listing'; context: ListingContext } | { type: 'template'; templateId: string; shopId: string };
  printsEnabled: boolean;
  customisedEnabled: boolean;
  sharedPhysicalListing?: boolean;
  baseDescription?: string;
  disabled?: boolean;
};

const emptySettings: DeliverySettingsInput = {
  printProfileId: null, customisedProfileId: null, includeDeliveryInformation: null, deliveryInformation: null,
};
const selectClassName = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

function destinationSummary(profile: DeliveryProfile | undefined) {
  if (!profile) return 'Existing Etsy delivery settings are retained until a profile is selected.';
  const names = new Intl.DisplayNames(['en-GB'], { type: 'region' });
  return profile.destinations.map(({ countryCode }) => {
    if (countryCode === '*') return 'Everywhere Else (worldwide coverage)';
    if (countryCode === 'region:eu') return 'European Union region (imported coverage)';
    if (countryCode === 'region:non_eu') return 'Non-European Union region (imported coverage)';
    return /^[A-Z]{2}$/.test(countryCode) ? names.of(countryCode) ?? countryCode : countryCode;
  }).join(', ') || 'No destinations enabled';
}

export function MarketsDeliverySettings({ target, printsEnabled, customisedEnabled, sharedPhysicalListing = false, baseDescription, disabled = false }: Props) {
  const [data, setData] = useState<MarketsDeliverySettingsState | null>(null);
  const [settings, setSettings] = useState<DeliverySettingsInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const physical = printsEnabled || customisedEnabled;
  const shopId = target.type === 'listing' ? target.context.shopId : target.shopId;
  const query = target.type === 'listing'
    ? new URLSearchParams(target.context).toString()
    : new URLSearchParams({ templateId: target.templateId, shopId }).toString();
  const endpoint = `/api/etsy/markets-delivery/${target.type}`;

  useEffect(() => {
    if (!physical) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`${endpoint}?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { data?: MarketsDeliverySettingsState; error?: string };
        if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Unable to load Markets & Delivery settings.');
        if (controller.signal.aborted) return;
        setData(payload.data);
        setSettings(payload.data.settings);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load delivery settings.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, query, physical, reload]);

  const inherited = target.type === 'listing' && settings === null;
  const values = settings ?? data?.templateSettings ?? emptySettings;
  const profiles = data?.profiles ?? [];
  const unchanged = data !== null && JSON.stringify(settings) === JSON.stringify(data.settings);
  const printProfileId = values.printProfileId ?? (sharedPhysicalListing ? values.customisedProfileId : null)
    ?? (unchanged ? data?.effective.print.profileId : null);
  const customisedProfileId = (sharedPhysicalListing ? printProfileId : values.customisedProfileId)
    ?? (unchanged ? data?.effective.customised.profileId : null);
  const printProfile = profiles.find(({ id }) => id === printProfileId);
  const customisedProfile = profiles.find(({ id }) => id === customisedProfileId);
  const profileWording = values.includeDeliveryInformation === null && values.deliveryInformation === null;
  const primaryProfile = printsEnabled ? printProfile : customisedProfile;
  const include = values.includeDeliveryInformation ?? primaryProfile?.includeDeliveryInformation ?? false;
  const wording = values.deliveryInformation ?? primaryProfile?.deliveryInformation ?? '';
  const locked = loading || saving || disabled || inherited;
  const dirty = data !== null && JSON.stringify(settings) !== JSON.stringify(data.settings);

  const variants = [
    ...(printsEnabled ? [{ key: 'print', label: sharedPhysicalListing ? 'Print / Frames and Customised Prints' : 'Print / Frames', profile: printProfile }] : []),
    ...(customisedEnabled && !sharedPhysicalListing ? [{ key: 'customised', label: 'Customised Prints', profile: customisedProfile }] : []),
  ];
  const previews = variants.map((variant) => {
    const text = values.deliveryInformation ?? variant.profile?.deliveryInformation ?? '';
    const enabled = values.includeDeliveryInformation ?? variant.profile?.includeDeliveryInformation ?? false;
    let description = '';
    let validationError: string | null = null;
    try { description = composeDeliveryDescription(baseDescription ?? data?.baseDescription ?? '', text, enabled); }
    catch (failure) { validationError = failure instanceof Error ? failure.message : 'Unable to compose the description.'; }
    return { ...variant, text, enabled, description, count: Array.from(description).length, validationError };
  });
  const invalidDescription = previews.some(({ count, validationError }) => count > MAX_ETSY_DESCRIPTION_LENGTH || validationError !== null);
  const conflicts = previews.flatMap((preview) => {
    const effective = preview.key === 'print' ? data?.effective.print : data?.effective.customised;
    return effective?.descriptionConflict ? [{ ...preview, message: effective.descriptionConflict, remote: effective.remoteDescription }] : [];
  });

  function update(next: Partial<DeliverySettingsInput>) {
    setSettings({ ...values, ...next });
    setMessage(null);
  }

  async function save(next = settings, confirmDescriptionOverwrite = false) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(target.type === 'listing' ? target.context : { templateId: target.templateId, shopId }), settings: next,
          ...(confirmDescriptionOverwrite ? { confirmDescriptionOverwrite: true } : {}) }),
      });
      const payload = await response.json() as { data?: MarketsDeliverySettingsState; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Unable to save Markets & Delivery settings.');
      setData(payload.data);
      setSettings(payload.data.settings);
      setMessage(confirmDescriptionOverwrite ? 'Description replacement reviewed and saved. Sync this listing to replace its Etsy description.' : target.type === 'template'
        ? 'Delivery defaults saved. Affected listings using these defaults are pending Etsy sync.'
        : 'Delivery settings saved. Sync this physical listing to apply changes on Etsy.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save delivery settings.');
    } finally { setSaving(false); }
  }

  function profileField(key: 'printProfileId' | 'customisedProfileId', label: string, profile: DeliveryProfile | undefined) {
    const selectedId = sharedPhysicalListing ? values.printProfileId ?? values.customisedProfileId : values[key];
    return <div className="grid gap-2" key={key}>
      <label className="grid gap-2 text-sm font-medium">
        {label} delivery profile
        <select className={selectClassName} value={selectedId ?? ''} disabled={locked} onChange={(event) => {
          const id = event.target.value || null;
          update(sharedPhysicalListing ? { printProfileId: id, customisedProfileId: id } : { [key]: id });
        }}>
          <option value="">Keep existing Etsy delivery settings</option>
          {selectedId && !profiles.some(({ id }) => id === selectedId) ? <option value={selectedId}>Selected profile is unavailable</option> : null}
          {profiles.filter(({ archivedAt, id }) => !archivedAt || id === selectedId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">{destinationSummary(profile)}</p>
      {profile ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>{profile.etsyShippingProfileId ? `Etsy profile ${profile.etsyShippingProfileId}` : 'Local profile — sync the profile to Etsy before syncing this listing'}</span>
        <a className="font-medium underline underline-offset-4" href={`/etsy/markets-delivery?shopId=${encodeURIComponent(shopId)}&profileId=${encodeURIComponent(profile.id)}`}>Manage selected profile</a>
      </div> : null}
      {profile?.etsyShippingProfileId && profile.syncStatus !== 'SYNCED' ? <p className="text-xs text-amber-700">Delivery profile status: {profile.syncStatus.toLowerCase().replaceAll('_', ' ')}. Sync the profile on Markets &amp; Delivery before syncing this listing.</p> : null}
    </div>;
  }

  return <section className="grid gap-4 border-t pt-4" aria-label="Markets & Delivery">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="font-semibold">Markets &amp; Delivery</h3>
        <p className="text-xs text-muted-foreground">Delivery information appears in the Etsy description, separately from artwork Top Text and Bottom Text.</p>
      </div>
      <a href={`/etsy/markets-delivery?shopId=${encodeURIComponent(shopId)}`} className="text-sm font-medium underline underline-offset-4">Manage delivery profiles</a>
    </div>
    {!physical ? <p className="text-sm text-muted-foreground">Digital downloads have no physical delivery profile or delivery information.</p> : <>
      {loading ? <p className="text-sm text-muted-foreground" role="status">Loading delivery settings…</p> : null}
      {data ? <>
        {target.type === 'listing' ? <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={inherited} disabled={saving || disabled} onChange={(event) => {
              setSettings(event.target.checked ? null : { ...(data.templateSettings ?? emptySettings) });
              setMessage(null);
            }} />Use template defaults
          </label>
          {!inherited ? <Button type="button" variant="outline" size="sm" disabled={saving || disabled} onClick={() => void save(null)}>Reset to template</Button> : null}
        </div> : <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">Listings inherit these defaults until their delivery settings are overridden. Reusable profile wording is used unless you enter custom wording below.</p>
          {data.templateSettings !== null ? <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{settings === null ? 'Using delivery defaults from the followed template. Editing creates defaults for this template.' : 'This template overrides delivery defaults from its followed template.'}</p>
            {settings !== null ? <Button type="button" variant="outline" size="sm" disabled={saving || disabled} onClick={() => void save(null)}>Reset to followed template</Button> : null}
          </div> : null}
        </div>}
        {conflicts.length ? <div className="grid gap-3 rounded-md border border-amber-500/50 bg-amber-50/40 p-3">
          {conflicts.map((conflict) => <div key={conflict.key} className="grid gap-2">
            <p className="text-sm font-medium" role="alert">Etsy description needs review — {conflict.label}</p>
            <p className="text-xs text-muted-foreground">{conflict.message}</p>
            {conflict.remote !== null && conflict.remote !== undefined ? <details className="text-sm"><summary className="cursor-pointer font-medium">Current Etsy description</summary><p className="mt-2 whitespace-pre-wrap">{conflict.remote}</p></details> : null}
          </div>)}
          <p className="text-xs text-muted-foreground">Review the current Etsy text and final description preview below. To keep changes made in Etsy, copy the text you want into the listing's base description on the Details tab first.</p>
          <div><Button type="button" size="sm" variant="outline" disabled={saving || disabled || invalidDescription} onClick={() => void save(settings, true)}>Use saved local description on next sync</Button></div>
        </div> : null}
        {printsEnabled ? profileField('printProfileId', sharedPhysicalListing ? 'Print / Frames and Customised Prints' : 'Print / Frames', printProfile) : null}
        {customisedEnabled && !sharedPhysicalListing ? profileField('customisedProfileId', 'Customised Prints', customisedProfile) : null}
        <p className="text-xs text-muted-foreground">Framed and unframed options are variations of the same Etsy listing and share one delivery profile and its rates. Account for the cost of each variation when setting prices.{sharedPhysicalListing ? ' This template also combines customised prints into that Etsy listing.' : ''}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={profileWording} disabled={locked} onChange={(event) => update(event.target.checked
            ? { includeDeliveryInformation: null, deliveryInformation: null }
            : { includeDeliveryInformation: include, deliveryInformation: wording })} />Use delivery wording from each selected profile
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={include} disabled={locked || profileWording} onChange={(event) => update({ includeDeliveryInformation: event.target.checked })} />Include delivery information in description
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Delivery information
          <textarea className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal" value={wording} disabled={locked || profileWording} onChange={(event) => update({ deliveryInformation: event.target.value })} placeholder="Enter customer-facing delivery information" />
        </label>
        <p className="text-xs text-muted-foreground">The Etsy delivery profile controls where buyers can order. Description wording does not restrict destinations. No physical delivery wording is added to digital downloads.</p>
        {previews.map((preview) => <details key={preview.key} className="rounded-md border bg-muted/30 p-3">
          <summary className="cursor-pointer text-sm font-medium">{target.type === 'listing' ? 'Final Etsy description' : 'Delivery text preview'} — {preview.label}</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm" data-testid={`delivery-preview-${preview.key}`}>{preview.description || 'No delivery information included.'}</p>
          {preview.validationError ? <p role="alert" className="mt-2 text-xs text-destructive">{preview.validationError}</p> : null}
          {target.type === 'listing' ? <p className={`mt-2 text-xs ${preview.count > MAX_ETSY_DESCRIPTION_LENGTH ? 'text-destructive' : 'text-muted-foreground'}`}>{preview.count.toLocaleString('en-GB')} / {MAX_ETSY_DESCRIPTION_LENGTH.toLocaleString('en-GB')} characters (application limit)</p> : null}
        </details>)}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" role="status">{dirty ? 'Unsaved delivery changes.' : data.pending ? 'Saved locally · pending Etsy sync.' : inherited ? 'Using template delivery defaults.' : 'Delivery settings saved locally.'}</p>
          <Button type="button" size="sm" disabled={saving || disabled || !dirty || invalidDescription} onClick={() => void save()}>{saving ? 'Saving…' : target.type === 'template' ? 'Save Delivery Defaults' : 'Save Delivery Settings'}</Button>
        </div>
      </> : null}
    </>}
    {message ? <p role="status" className="text-xs text-green-700">{message}</p> : null}
    {error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><p>{error}</p>{!data ? <Button type="button" variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>Retry</Button> : null}</div> : null}
  </section>;
}
