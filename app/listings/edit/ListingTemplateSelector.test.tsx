import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingEditorContext, ListingEditorData } from '@/lib/listing-editor';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';
import { defaultListingPersonalisationTextAreaSettings } from '@/lib/personalisation-text-areas';
import { ListingTemplateSelector } from './ListingTemplateSelector';

vi.mock('@/components/MarketsDeliverySettings', () => ({ MarketsDeliverySettings: () => null }));
vi.mock('./ListingThumbnailGapControl', () => ({ ListingThumbnailGapControl: () => null }));
vi.mock('./ListingPrintCropDialog', () => ({ ListingPrintCropDialog: () => null }));
vi.mock('./ListingTextAreasDialog', () => ({ ListingTextAreasDialog: () => null }));
vi.mock('./ListingPersonalisationPreviewDialog', () => ({ ListingPersonalisationPreviewDialog: () => null }));
vi.mock('./ListingMockupTesterDialog', () => ({ ListingMockupTesterDialog: () => null }));

import { ListingEditorClient } from './ListingEditorClient';

const endpoint = '/api/shops/listings/editor/template';
const context: ListingEditorContext = { shopId: '66615491', sectionId: '7', subSectionId: '12', listingId: '194' };
const choices = [
  { id: '8', name: 'Woodland rooms', templateType: 'single', itemCount: 1 },
  { id: '9', name: 'Modern rooms', templateType: 'single', itemCount: 1 },
  { id: '12', name: 'Three print set', templateType: 'multiple', itemCount: 3 },
];
const assigned = { id: 8, name: 'Woodland rooms' };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { resolve, promise };
}
async function finish(request: ReturnType<typeof deferred>, response: Response) { await act(async () => request.resolve(response)); }

function editorData(templateId = 8, listingContext = context): ListingEditorData {
  const source = { fileName: 'thumbnail.png', updatedAt: '2026-11-17T12:00:00.000Z', width: 1120, height: 1400 };
  const name = templateId === 9 ? 'Modern rooms' : 'Woodland rooms';
  return {
    context: listingContext, shop: { id: context.shopId, shopName: 'CosyHousePrints' },
    section: { id: context.sectionId, sectionName: 'Woodland Wall Art', hasEtsySection: true },
    subSection: { id: context.subSectionId, name: 'Woodland Wall Art', numberOfDownloads: 1, includeAllDownloads: false },
    listing: {
      id: listingContext.listingId, etsyId: '4614991337', title: templateId === 9 ? 'Fresh fox print details' : 'Original fox title', localDirectoryName: 'Fox',
      description: 'Fox artwork for a woodland nursery.', digitalTitle: 'Fox Digital Download', digitalDescription: 'Printable fox artwork.', digitalQuantity: 99,
      listingDescription: 'A friendly orange fox.', artworkOrientation: 'portrait', listingItem: 'Fox', listingItemInherited: false,
      roomTheme: 'Woodland nursery', roomThemeInherited: false, backgroundColour: '#F5F0E8', backgroundColourInherited: false,
      personalisationHeaderText: "Rory's", personalisationFooterText: 'Bedroom', personalisationFontId: 'nunito',
      personalisationTextAreas: defaultListingPersonalisationTextAreaSettings(),
      printCropSettings: createListingPrintCropSettings(defaultNativeListingPrintCropDraft(1120, 1400), source),
      status: 'active', quantity: 99, priceAmount: 1599, priceDivisor: 100, priceCurrencyCode: 'GBP', taxonomyId: 1, shopSectionId: 1,
      whoMade: 'i_did', whenMade: '2020_2026', isSupply: false, shouldAutoRenew: true, isPersonalizable: true,
      language: 'en-GB', primaryColour: 'Orange', secondaryColour: 'White', listingType: 'physical', etsySku: 'FOX-194',
      numberOfItems: 1, includeAllItems: false, thumbnailUpdatedAt: source.updatedAt, imagesNeedRegeneration: templateId === 9,
    },
    template: { id: templateId, name, templateType: 'single', itemCount: 1, followedTemplateId: null,
      printsFrames: true, customisePrints: true, customTop: true, customBottom: true, digitalDownload: true, backgroundColour: '#F5F0E8',
      downloadSection: { title: 'Digital downloads', etsyShopSectionId: 2 },
      imageTemplates: [{ id: templateId === 9 ? '902' : '801', name: templateId === 9 ? 'New room scene' : 'Old room scene', position: 0, generated: false }] },
    groupCandidates: [], groupItems: [], sales: { itemsSold: 0, orderCount: 0, lastSoldAt: null },
    thumbnail: { fileName: source.fileName, originalFileName: 'Fox source.png', updatedAt: source.updatedAt, widthPixels: 1120, heightPixels: 1400, ratio: '4x5' },
    pendingChanges: [], readyToUpload: true, missingUploadFields: [], todoItems: [], tags: [], materials: [], styles: [],
    images: [], files: [], zippedFiles: [], videos: [], translations: [], inventory: [], personalization: [], buyerPrices: [],
    etsyProducts: { config: { listOnEtsy: true, digitalDownload: true, printsFrames: true, printsFramesOverride: true, digitalDownloadOverride: true,
      customTop: true, customBottom: true, customisePrints: true, giftMessageEnabled: false, downloadSectionId: 2, returnPolicyId: null },
      sizes: [{ key: 'a4', label: 'A4', enabled: true }], frames: [{ key: 'no_frame', label: 'Unframed', enabled: true }], products: [], prices: [] },
    dropbox: { bundle: null, current: false, canCreateZips: false, zipsCurrent: false, message: null, action: null },
  };
}

function loadedChoices(currentTemplateId: string | null = '8') { return json({ templates: choices, currentTemplateId }); }
async function chooseModern() {
  await screen.findByRole('option', { name: 'Modern rooms — Single' });
  fireEvent.change(screen.getByLabelText('Listing template'), { target: { value: '9' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('listing template selector', () => {
  it('loads shop-scoped choices and requires an explicit different selection before saving', async () => {
    const load = deferred();
    const fetchMock = vi.fn(async () => load.promise); vi.stubGlobal('fetch', fetchMock);
    render(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={vi.fn()} />);
    expect(screen.getByText('Loading templates…')).toBeTruthy();
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole('option', { name: 'Woodland rooms' })).toBeTruthy();
    await finish(load, loadedChoices());
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.pathname).toBe(endpoint);
    for (const [key, value] of Object.entries(context)) expect(parsed.searchParams.get(key)).toBe(value);
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).value).toBe('8');
    expect((screen.getByRole('button', { name: 'Change template' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Listing template'), { target: { value: '12' } });
    expect((screen.getByRole('button', { name: 'Change template' }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Listing template'), { target: { value: '8' } });
    expect((screen.getByRole('button', { name: 'Change template' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Changing template removes the previous generated images/)).toBeTruthy();
  });

  it('saves once, propagates busy state, and applies the fresh listing before showing regeneration guidance', async () => {
    const update = deferred(); const onSaved = vi.fn(), onBusy = vi.fn();
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'PUT' ? update.promise : loadedChoices());
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={onSaved} onSavingChange={onBusy} />);
    await chooseModern();
    fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
    expect(screen.getByRole('button', { name: 'Changing template…' }).hasAttribute('disabled')).toBe(true);
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).disabled).toBe(true);
    expect(onBusy).toHaveBeenCalledWith(true); expect(onSaved).not.toHaveBeenCalled();
    const put = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')!;
    expect(put[0]).toBe(endpoint); expect(JSON.parse(String(put[1]?.body))).toEqual({ ...context, templateId: '9' });
    const next = editorData(9); await finish(update, json({ data: next }));
    expect(onSaved).toHaveBeenCalledTimes(1); expect(onSaved).toHaveBeenCalledWith(JSON.parse(JSON.stringify(next)));
    expect(onBusy.mock.calls.map(([value]) => value)).toEqual([true, false]);
    expect(screen.getByText('Template changed. Regenerate the listing images to use the new template.')).toBeTruthy();
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).value).toBe('9');
    expect((screen.getByRole('button', { name: 'Change template' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a failed selection available for retry without claiming the template changed', async () => {
    let attempts = 0; const onSaved = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'PUT'
      ? ++attempts === 1 ? json({ error: 'Generated image cleanup failed.' }, 500) : json({ data: editorData(9) }) : loadedChoices()));
    render(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={onSaved} />);
    await chooseModern(); fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Generated image cleanup failed.');
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).value).toBe('9');
    expect((screen.getByRole('button', { name: 'Change template' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
    await screen.findByText('Template changed. Regenerate the listing images to use the new template.');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('supports a listing with no current template and explains an empty shop catalogue', async () => {
    const fetchMock = vi.fn(async () => loadedChoices(null)); vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<ListingTemplateSelector context={context} currentTemplate={null} onSaved={vi.fn()} />);
    await screen.findByRole('option', { name: 'Modern rooms — Single' });
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('option', { name: 'No template selected' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Listing template'), { target: { value: '9' } });
    expect((screen.getByRole('button', { name: 'Change template' }) as HTMLButtonElement).disabled).toBe(false);
    unmount(); fetchMock.mockImplementation(async () => json({ templates: [], currentTemplateId: null }));
    render(<ListingTemplateSelector context={context} currentTemplate={null} onSaved={vi.fn()} />);
    expect(await screen.findByText('No templates are available for this shop.')).toBeTruthy();
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Change template' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports loading errors and retries the scoped choices request', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ++attempts === 1 ? json({ error: 'Templates are unavailable.' }, 500) : loadedChoices()));
    render(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Templates are unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry templates' }));
    expect(await screen.findByRole('option', { name: 'Modern rooms — Single' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables changes while another editor operation is busy', async () => {
    const fetchMock = vi.fn(async () => loadedChoices()); vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={vi.fn()} />);
    await chooseModern();
    rerender(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={vi.fn()} disabled />);
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale choices response after the listing context changes', async () => {
    const oldLoad = deferred(); const nextContext = { ...context, listingId: '195' };
    const fetchMock = vi.fn(async (url: string) => new URL(url, 'http://localhost').searchParams.get('listingId') === context.listingId
      ? oldLoad.promise : loadedChoices('12'));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={vi.fn()} />);
    rerender(<ListingTemplateSelector context={nextContext} currentTemplate={{ id: '12', name: 'Three print set' }} onSaved={vi.fn()} />);
    await screen.findByRole('option', { name: 'Three print set — Set of 3' });
    await finish(oldLoad, loadedChoices('8'));
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).value).toBe('12');
  });

  it('aborts an old save and suppresses its callback after a context change', async () => {
    const update = deferred(); const onSaved = vi.fn(), onBusy = vi.fn(); const nextContext = { ...context, listingId: '195' };
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => options?.method === 'PUT' ? update.promise
      : loadedChoices(new URL(url, 'http://localhost').searchParams.get('listingId') === context.listingId ? '8' : '12'));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={onSaved} onSavingChange={onBusy} />);
    await chooseModern(); fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
    const put = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')!;
    rerender(<ListingTemplateSelector context={nextContext} currentTemplate={{ id: '12', name: 'Three print set' }} onSaved={onSaved} onSavingChange={onBusy} />);
    await screen.findByRole('option', { name: 'Three print set — Set of 3' });
    expect(put[1]?.signal?.aborted).toBe(true);
    await finish(update, json({ data: editorData(9) }));
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Listing template') as HTMLSelectElement).value).toBe('12');
    expect(onBusy.mock.calls.map(([value]) => value)).toEqual([true, false]);
  });

  it('releases busy state and ignores a save response after unmounting', async () => {
    const update = deferred(); const onSaved = vi.fn(), onBusy = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'PUT' ? update.promise : loadedChoices()));
    const { unmount } = render(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={onSaved} onSavingChange={onBusy} />);
    await chooseModern(); fireEvent.click(screen.getByRole('button', { name: 'Change template' })); unmount();
    await finish(update, json({ data: editorData(9) }));
    expect(onSaved).not.toHaveBeenCalled(); expect(onBusy.mock.calls.map(([value]) => value)).toEqual([true, false]);
  });

  it('rejects a mismatched refreshed listing instead of applying another listing to this editor', async () => {
    const onSaved = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'PUT'
      ? json({ data: editorData(9, { ...context, listingId: '195' }) }) : loadedChoices()));
    render(<ListingTemplateSelector context={context} currentTemplate={assigned} onSaved={onSaved} />);
    await chooseModern(); fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
    expect((await screen.findByRole('alert')).textContent).toContain('refreshed listing could not be read');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('refreshes the real listing editor, its details form and generation controls after a mocked template change', async () => {
    const initial = editorData(); const next = editorData(9); const update = deferred();
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (!url.startsWith(endpoint)) throw new Error(`Unexpected editor request: ${url}`);
      return options?.method === 'PUT' ? update.promise : loadedChoices();
    }));
    render(<ListingEditorClient initialData={initial} />);
    const sourceUrl = screen.getByAltText('Fox source.png').getAttribute('src');
    await chooseModern(); fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
    expect((screen.getByRole('button', { name: 'Generate Images' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(true);
    await finish(update, json({ data: next }));
    await screen.findByText('Template changed. Regenerate the listing images to use the new template.');
    expect(screen.getAllByText('Template: Modern rooms')).toHaveLength(2);
    expect(screen.queryByRole('row', { name: /Old room scene/ })).toBeNull();
    expect(screen.getByRole('row', { name: /New room scene/ })).toBeTruthy();
    expect(screen.getByAltText('Fox source.png').getAttribute('src')).toBe(sourceUrl);
    expect((screen.getByRole('button', { name: 'Generate Images' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByDisplayValue('Fresh fox print details')).toBeTruthy();
    expect(screen.queryByDisplayValue('Original fox title')).toBeNull();
  });
});
