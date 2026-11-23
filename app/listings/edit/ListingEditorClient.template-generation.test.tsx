import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingEditorData } from '@/lib/listing-editor';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';
import { defaultListingPersonalisationTextAreaSettings } from '@/lib/personalisation-text-areas';

vi.mock('@/components/MarketsDeliverySettings', () => ({ MarketsDeliverySettings: () => null }));
vi.mock('./ListingThumbnailGapControl', () => ({ ListingThumbnailGapControl: () => null }));
vi.mock('./ListingPersonalisationPreviewDialog', () => ({ ListingPersonalisationPreviewDialog: () => null }));
vi.mock('./ListingMockupTesterDialog', () => ({ ListingMockupTesterDialog: () => null }));

import { ListingEditorClient } from './ListingEditorClient';

// Existing generation-progress fixture, reused with the real selector/setup dialogs.
function editorData(): ListingEditorData {
  const source = { fileName: 'thumbnail.png', updatedAt: '2026-11-17T12:00:00.000Z', width: 1120, height: 1400 };
  return {
    context: { shopId: '66615491', sectionId: '7', subSectionId: '12', listingId: '194' },
    shop: { id: '66615491', shopName: 'CosyHousePrints' },
    section: { id: '7', sectionName: 'Woodland Wall Art', hasEtsySection: true },
    subSection: { id: '12', name: 'Woodland Wall Art', numberOfDownloads: 1, includeAllDownloads: false },
    listing: {
      id: '194', etsyId: '4614991337', title: 'Fox Nursery Print', localDirectoryName: 'Fox',
      description: 'A friendly fox print for a woodland nursery.', digitalTitle: 'Fox Digital Download',
      digitalDescription: 'Printable fox artwork.', digitalQuantity: 99, listingDescription: 'A friendly orange fox.',
      artworkOrientation: 'portrait', listingItem: 'Fox', listingItemInherited: false,
      roomTheme: 'Woodland nursery', roomThemeInherited: false, backgroundColour: '#F5F0E8', backgroundColourInherited: false,
      personalisationHeaderText: "Rory's", personalisationFooterText: 'Bedroom', personalisationFontId: 'nunito',
      personalisationTextAreas: defaultListingPersonalisationTextAreaSettings(),
      printCropSettings: createListingPrintCropSettings(defaultNativeListingPrintCropDraft(1120, 1400), source),
      status: 'active', quantity: 99, priceAmount: 1599, priceDivisor: 100, priceCurrencyCode: 'GBP',
      taxonomyId: 1, shopSectionId: 1, whoMade: 'i_did', whenMade: '2020_2026', isSupply: false,
      shouldAutoRenew: true, isPersonalizable: true, language: 'en-GB', primaryColour: 'Orange', secondaryColour: 'White',
      listingType: 'physical', etsySku: 'FOX-194', numberOfItems: 1, includeAllItems: false, thumbnailUpdatedAt: source.updatedAt,
    },
    template: {
      id: 8, name: 'Woodland Animals Kids', templateType: 'single', itemCount: 1, followedTemplateId: null,
      printsFrames: true, customisePrints: true, customTop: true, customBottom: true, digitalDownload: true,
      backgroundColour: '#F5F0E8', downloadSection: { title: 'Digital downloads', etsyShopSectionId: 2 },
      imageTemplates: [{ id: '142', name: 'First room', position: 0, generated: false }, { id: '143', name: 'Second room', position: 1, generated: false }],
    },
    groupCandidates: [], groupItems: [], sales: { itemsSold: 0, orderCount: 0, lastSoldAt: null },
    thumbnail: { fileName: source.fileName, originalFileName: 'Fox source.png', updatedAt: source.updatedAt, widthPixels: 1120, heightPixels: 1400, ratio: '4x5' },
    pendingChanges: [], readyToUpload: true, missingUploadFields: [], todoItems: [], tags: [], materials: [], styles: [],
    images: [], files: [], zippedFiles: [], videos: [], translations: [], inventory: [], personalization: [], buyerPrices: [],
    etsyProducts: {
      config: {
        listOnEtsy: true, digitalDownload: true, printsFrames: true, printsFramesOverride: true, digitalDownloadOverride: true,
        customTop: true, customBottom: true, customisePrints: true, giftMessageEnabled: false, downloadSectionId: 2, returnPolicyId: null,
      },
      sizes: [{ key: 'a4', label: 'A4', enabled: true }],
      frames: [{ key: 'no_frame', label: 'Unframed', enabled: true }], products: [], prices: [],
    },
    dropbox: { bundle: null, current: false, canCreateZips: false, zipsCurrent: false, message: null, action: null },
  };
}


const templateEndpoint = '/api/shops/listings/editor/template';
const cropEndpoint = '/api/shops/listings/editor/print-crops';
const textEndpoint = '/api/shops/listings/editor/text-areas';
const overviewEndpoint = '/api/shops/listings/editor/overview';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T = Response>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
function normalData() {
  const value = editorData();
  value.template!.customisePrints = false; value.template!.customTop = false; value.template!.customBottom = false;
  value.etsyProducts.config.customisePrints = false; value.etsyProducts.config.customTop = false; value.etsyProducts.config.customBottom = false;
  value.listing.personalisationTextAreas = null;
  return value;
}
function nightSky(value: ListingEditorData) {
  const next = structuredClone(value);
  next.template = { ...next.template!, id: 22, name: 'Night Sky', customisePrints: true, customTop: true, customBottom: true,
    imageTemplates: [{ id: '222', name: 'Night room', generated: false, position: 0 }] };
  next.etsyProducts.config.customisePrints = true; next.etsyProducts.config.customTop = true; next.etsyProducts.config.customBottom = true;
  next.listing.personalisationTextAreas = null;
  return next;
}
function requests(initial: ListingEditorData, changed = initial,
  intercept?: (url: string, options: RequestInit | undefined, current: ListingEditorData) => Response | Promise<Response> | undefined) {
  let current = initial;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
    const intercepted = intercept?.(url, options, current); if (intercepted) return intercepted;
    if (url.startsWith(`${templateEndpoint}?`)) return json({ templates: [
      { id: '8', name: 'Woodland Animals Kids', templateType: 'single', itemCount: 1 },
      { id: '22', name: 'Night Sky', templateType: 'single', itemCount: 1 },
    ], currentTemplateId: String(current.template?.id ?? '') });
    if (url === templateEndpoint && options?.method === 'PUT') { current = changed; return json({ data: current }); }
    if (url.startsWith(`${cropEndpoint}?`)) return json({ dimensions: { width: 1120, height: 1400 } });
    if (url === cropEndpoint && options?.method === 'PUT') {
      current = { ...current, listing: { ...current.listing, printCropSettings: editorData().listing.printCropSettings } };
      return json({ data: current });
    }
    if (url === textEndpoint && options?.method === 'PUT') {
      current = { ...current, listing: { ...current.listing, personalisationTextAreas: JSON.parse(String(options.body)).textAreas } };
      return json({ data: current });
    }
    if (url === overviewEndpoint || url === '/api/shops/listings/editor/downloads/generate' || url === '/api/shops/listings/dropbox') return json({ data: current });
    throw new Error(`Unexpected mocked request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
function overviewActions(fetchMock: ReturnType<typeof requests>) {
  return fetchMock.mock.calls.filter(([url]) => url === overviewEndpoint).map(([, options]) => JSON.parse(String(options?.body)));
}
async function changeTemplate() {
  await screen.findByRole('option', { name: 'Night Sky — Single' });
  fireEvent.change(screen.getByLabelText('Listing template'), { target: { value: '22' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
  await screen.findByText('Template changed. Regenerate the listing images to use the new template.');
}
async function saveSize(label: string) {
  const dialog = screen.getByRole('dialog', { name: 'Set Size' });
  fireEvent.load(within(dialog).getByRole('img'));
  const save = within(dialog).getByRole('button', { name: `Save Size and continue ${label}` }) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  fireEvent.click(save);
}

afterEach(() => vi.unstubAllGlobals());

describe('guided generation after changing a listing template', () => {
  it.each(['Generate Images', 'Generate'] as const)('%s guides newly required text areas, then resumes exactly the chosen workflow with the fresh template', async (action) => {
    const initial = normalData(), changed = nightSky(initial), saved = structuredClone(changed);
    saved.listing.personalisationTextAreas = defaultListingPersonalisationTextAreaSettings();
    const textSave = deferred(), cleanup = deferred();
    const fetchMock = requests(initial, changed, (url, options) => {
      if (url === textEndpoint) return textSave.promise;
      if (url === overviewEndpoint && JSON.parse(String(options?.body)).action === 'clear-images') return cleanup.promise;
      return undefined;
    });
    render(<ListingEditorClient initialData={initial} />);
    await changeTemplate();
    expect((screen.getByRole('button', { name: action }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: action }));
    const dialog = screen.getByRole('dialog', { name: 'Set Text Areas' });
    expect(within(dialog).getByText(`Save these text areas to continue ${action}.`)).toBeTruthy();
    expect(overviewActions(fetchMock)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: `Save Text Areas and continue ${action}` }));
    expect(overviewActions(fetchMock)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(textEndpoint, expect.objectContaining({ method: 'PUT' }));
    await act(async () => textSave.resolve(json({ data: saved })));
    await waitFor(() => expect(overviewActions(fetchMock)).toHaveLength(1));
    expect(overviewActions(fetchMock)[0].action).toBe('clear-images');
    expect((screen.getByRole('button', { name: action === 'Generate Images' ? 'Generating Images...' : 'Generating...' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => cleanup.resolve(json({ data: saved })));
    await screen.findByText('Generation complete');
    expect(overviewActions(fetchMock).find((request) => request.action === 'images')?.imageTemplateId).toBe(222);
    expect(overviewActions(fetchMock).some((request) => request.action === 'details')).toBe(action === 'Generate');
    expect(overviewActions(fetchMock).some((request) => request.action === 'mark-current')).toBe(action === 'Generate');
  });

  it('guides Set Size before text areas and never clears existing images before both explicit saves', async () => {
    const initial = nightSky(normalData()); initial.listing.printCropSettings = null;
    const fetchMock = requests(initial);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' }));
    const sizes = screen.getByRole('dialog', { name: 'Set Size' });
    const image = within(sizes).getByRole('img') as HTMLImageElement;
    expect(new URL(image.src).searchParams.get('preview')).toBe('1');
    expect(overviewActions(fetchMock)).toEqual([]);
    await saveSize('Generate Images');
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith(`${cropEndpoint}?`))).toBe(false);
    const text = await screen.findByRole('dialog', { name: 'Set Text Areas' });
    expect(overviewActions(fetchMock)).toEqual([]);
    fireEvent.click(within(text).getByRole('button', { name: 'Save Text Areas and continue Generate Images' }));
    await screen.findByText('Generation complete');
    const puts = fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT').map(([url]) => url);
    expect(puts).toEqual([cropEndpoint, textEndpoint]);
    expect(overviewActions(fetchMock).map((request) => request.action)).toEqual(['clear-images', 'images']);
  });

  it('cancel discards the queued action so a later manual save does not generate', async () => {
    const initial = nightSky(normalData()); const fetchMock = requests(initial);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set Text Areas' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Set Text Areas' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Set Text Areas' }));
    const manual = screen.getByRole('dialog', { name: 'Set Text Areas' });
    expect(within(manual).queryByText(/to continue Generate/)).toBeNull();
    fireEvent.click(within(manual).getByRole('button', { name: 'Save Text Areas' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set Text Areas' })).toBeNull());
    expect(overviewActions(fetchMock)).toEqual([]);
  });

  it('retains the dialog and intent on a save failure and starts generation only after a successful retry', async () => {
    const initial = nightSky(normalData()); let attempts = 0;
    const fetchMock = requests(initial, initial, (url) => url === textEndpoint && attempts++ === 0 ? json({ error: 'Text areas were not saved.' }, 500) : undefined);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' }));
    const dialog = screen.getByRole('dialog', { name: 'Set Text Areas' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Text Areas and continue Generate Images' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Text areas were not saved.');
    expect(overviewActions(fetchMock)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Text Areas and continue Generate Images' }));
    await screen.findByText('Generation complete');
    expect(overviewActions(fetchMock).filter((request) => request.action === 'clear-images')).toHaveLength(1);
  });

  it('does not resume when a successful save response omits fresh listing data', async () => {
    const initial = nightSky(normalData());
    const fetchMock = requests(initial, initial, (url) => url === textEndpoint ? json({}) : undefined);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' }));
    const dialog = screen.getByRole('dialog', { name: 'Set Text Areas' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Text Areas and continue Generate Images' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('could not be reloaded');
    expect(overviewActions(fetchMock)).toEqual([]);
  });

  it('cancels the old intent when the saved response reports a different assigned template', async () => {
    const initial = nightSky(normalData()), reassigned = normalData();
    const fetchMock = requests(initial, initial, (url) => url === textEndpoint ? json({ data: reassigned }) : undefined);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set Text Areas' })).getByRole('button', { name: 'Save Text Areas and continue Generate Images' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set Text Areas' })).toBeNull());
    expect(overviewActions(fetchMock)).toEqual([]);
    expect((screen.getByRole('button', { name: 'Generate Images' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not resume or apply an old save after navigation while its JSON body is still pending', async () => {
    const initial = nightSky(normalData()), body = deferred<{ data: ListingEditorData }>();
    const fetchMock = requests(initial, initial, (url) => url === textEndpoint ? Promise.resolve({ ok: true, json: () => body.promise } as Response) : undefined);
    const { rerender } = render(<ListingEditorClient key="194" initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set Text Areas' })).getByRole('button', { name: 'Save Text Areas and continue Generate Images' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === textEndpoint)).toBe(true));
    const other = normalData(); other.context.listingId = '748'; other.listing.id = '748'; other.listing.listingItem = 'Otter';
    rerender(<ListingEditorClient key="748" initialData={other} />);
    const saved = structuredClone(initial); saved.listing.personalisationTextAreas = defaultListingPersonalisationTextAreaSettings();
    await act(async () => body.resolve({ data: saved }));
    expect((screen.getByLabelText('Listing Name') as HTMLInputElement).value).toBe('Otter');
    expect(overviewActions(fetchMock)).toEqual([]);
  });

  it('accepts a legacy missing thumbnail timestamp filled by the size save without cancelling generation', async () => {
    const initial = normalData(); initial.listing.printCropSettings = null; initial.thumbnail!.updatedAt = null;
    const saved = normalData();
    const fetchMock = requests(initial, initial, (url, options) => url === cropEndpoint && options?.method === 'PUT' ? json({ data: saved }) : undefined);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' })); await saveSize('Generate Images');
    await screen.findByText('Generation complete');
    expect(overviewActions(fetchMock)[0].action).toBe('clear-images');
    expect(fetchMock.mock.calls.some(([url]) => url === textEndpoint)).toBe(false);
  });

  it.each(['missing source', 'missing template', 'incomplete group'] as const)('keeps both main actions disabled for %s', (scenario) => {
    const initial = normalData();
    if (scenario === 'missing source') initial.thumbnail = null;
    if (scenario === 'missing template') initial.template = null;
    if (scenario === 'incomplete group') { initial.template!.templateType = 'multiple'; initial.template!.itemCount = 3; initial.groupItems = []; }
    const fetchMock = requests(initial);
    render(<ListingEditorClient initialData={initial} />);
    for (const name of ['Generate Images', 'Generate']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(overviewActions(fetchMock)).toEqual([]);
  });
});
