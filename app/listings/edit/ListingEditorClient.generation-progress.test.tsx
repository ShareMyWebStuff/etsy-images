import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingEditorData } from '@/lib/listing-editor';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';
import { defaultListingPersonalisationTextAreaSettings } from '@/lib/personalisation-text-areas';
import { PRINTABLE_DOWNLOAD_SPECS } from '@/lib/printable-download-specs';

vi.mock('@/components/MarketsDeliverySettings', () => ({ MarketsDeliverySettings: () => null }));
vi.mock('./ListingThumbnailGapControl', () => ({ ListingThumbnailGapControl: () => null }));
vi.mock('./ListingTemplateSelector', () => ({ ListingTemplateSelector: () => null }));
vi.mock('./ListingPrintCropDialog', () => ({ ListingPrintCropDialog: () => null }));
vi.mock('./ListingTextAreasDialog', () => ({ ListingTextAreasDialog: () => null }));
vi.mock('./ListingPersonalisationPreviewDialog', () => ({ ListingPersonalisationPreviewDialog: () => null }));
vi.mock('./ListingMockupTesterDialog', () => ({ ListingMockupTesterDialog: () => null }));

import { ListingEditorClient } from './ListingEditorClient';

const overviewEndpoint = '/api/shops/listings/editor/overview';
const downloadsEndpoint = '/api/shops/listings/editor/downloads/generate';
const dropboxEndpoint = '/api/shops/listings/dropbox';

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

function multipleData(): ListingEditorData {
  const initial = editorData();
  initial.template = { ...initial.template!, templateType: 'multiple', itemCount: 3, followedTemplateId: 4 };
  initial.listing.numberOfItems = 3;
  initial.groupItems = ['Fox', 'Bear', 'Bunny'].map((name, index) => ({ id: String(301 + index), position: index + 1,
    name, sectionId: '7', subSectionId: '12', thumbnailFileName: `${name.toLowerCase()}.png`, printCropSettings: initial.listing.printCropSettings }));
  initial.groupCandidates = initial.groupItems.map((item) => ({ ...item }));
  return initial;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

type GenerationRequest = { action?: string; imageTemplateId?: number; ratio?: string };
function body(options?: RequestInit): GenerationRequest { return JSON.parse(String(options?.body ?? '{}')); }
function row(name: string) { return screen.getByRole('row', { name: new RegExp(name) }); }
function progress() { return screen.getByRole('progressbar', { name: 'Generation progress' }) as HTMLProgressElement; }
async function finish(pending: ReturnType<typeof deferred>, response: Response) { await act(async () => pending.resolve(response)); }

afterEach(() => vi.unstubAllGlobals());

describe('listing generation progress', () => {
  it.each(['Generate Images', 'Generate'] as const)('%s uses the refreshed template list after cleanup and keeps the completed cleanup step', async (action) => {
    const initial = editorData(); const cleared = structuredClone(initial);
    cleared.template!.imageTemplates = cleared.template!.imageTemplates.filter((image) => image.id === '143');
    const cleanup = deferred(); const remaining = deferred();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const request = body(options);
      if (url === overviewEndpoint && request.action === 'clear-images') return cleanup.promise;
      if (url === overviewEndpoint && request.action === 'images') {
        if (request.imageTemplateId !== 143) throw new Error('A deleted template image must not be rendered.');
        return remaining.promise;
      }
      if (url === overviewEndpoint || url === downloadsEndpoint || url === dropboxEndpoint) return json({ data: cleared });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const originalTotal = action === 'Generate Images' ? 3 : 1 + 2 + 1 + PRINTABLE_DOWNLOAD_SPECS.length + 1 + 1 + 1 + 1;
    expect(progress().max).toBe(originalTotal); expect(progress().value).toBe(0);
    expect(body(fetchMock.mock.calls[0][1]).action).toBe('clear-images');
    await finish(cleanup, json({ data: cleared }));
    await waitFor(() => expect(within(row('Second room')).getByText('Running')).toBeTruthy());
    expect(screen.queryByRole('row', { name: /First room/ })).toBeNull();
    expect(progress().value).toBe(1); expect(progress().max).toBe(originalTotal - 1);
    expect(fetchMock.mock.calls.filter(([, options]) => body(options).action === 'images').map(([, options]) => body(options).imageTemplateId)).toEqual([143]);
    await finish(remaining, json({ data: cleared }));
    await screen.findByText('Generation complete');
    expect(progress().value).toBe(progress().max);
    expect(fetchMock.mock.calls.some(([, options]) => body(options).imageTemplateId === 142)).toBe(false);
  });

  it.each([
    { action: 'Generate Images', initiallyEmpty: false }, { action: 'Generate', initiallyEmpty: false },
    { action: 'Generate Images', initiallyEmpty: true }, { action: 'Generate', initiallyEmpty: true },
  ])('$action cleans up an empty remaining scene set (initially empty: $initiallyEmpty)', async ({ action, initiallyEmpty }) => {
    const initial = editorData();
    initial.images = [{ id: 'old-image', fileName: 'template-142.png', originalFileName: 'Deleted scene output.png', rank: 1,
      updatedAt: '2026-11-19T12:00:00.000Z', ourCategoryImageTemplateId: '142' }];
    if (initiallyEmpty) initial.template!.imageTemplates = [];
    const cleared = structuredClone(initial); cleared.images = []; cleared.template!.imageTemplates = [];
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (body(options).action !== 'clear-images') throw new Error('An empty scene set needs cleanup only.');
      return json({ data: cleared });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: action }));
    await screen.findByText('Generation complete');
    expect(progress().max).toBe(1); expect(progress().value).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('No image templates configured.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    if (action === 'Generate') expect(screen.getByText('Existing listing images removed. No template images remain to generate.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Images' }));
    expect(screen.queryByAltText('Deleted scene output.png')).toBeNull();
  });

  it.each(['Generate Images', 'Generate'] as const)('%s never renders an image or starts a later stage when cleanup fails', async (action) => {
    const cleanup = deferred();
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (body(options).action !== 'clear-images') throw new Error('Rendering must wait for successful cleanup.');
      return cleanup.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={editorData()} />);
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(progress().value).toBe(0);
    await finish(cleanup, json({ error: 'Old image files could not be removed.' }, 500));
    await screen.findByText('Old image files could not be removed.');
    const dialog = screen.queryByRole('dialog');
    if (dialog) fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Stopped: Removing existing listing images')).toBeTruthy();
    expect(progress().value).toBe(0);
    expect(within(row('First room')).getByText('Not run')).toBeTruthy();
    expect(within(row('Second room')).getByText('Not run')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to fall back to stale template IDs when cleanup returns no refreshed listing', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={editorData()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' }));
    await screen.findByText('The existing images were removed, but the current listing template could not be reloaded.');
    expect(progress().value).toBe(0);
    expect(screen.getByText('Stopped: Removing existing listing images')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runs image templates sequentially and keeps confirmed rows completed while the server marks the whole scene set stale', async () => {
    const initial = editorData(); const first = deferred(); const second = deferred();
    initial.listing.imagesNeedRegeneration = true;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url !== overviewEndpoint) throw new Error(`Unexpected request: ${url}`);
      const request = body(options);
      if (request.action === 'clear-images') return json({ data: initial });
      if (request.action === 'images' && request.imageTemplateId === 142) return first.promise;
      if (request.action === 'images' && request.imageTemplateId === 143) return second.promise;
      throw new Error(`Unexpected generation request: ${JSON.stringify(request)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' }));
    await waitFor(() => expect(within(row('First room')).getByText('Running')).toBeTruthy());
    expect(within(row('Second room')).getByText('Waiting')).toBeTruthy();
    expect(progress().max).toBe(3); expect(progress().value).toBe(1);
    expect(screen.getByText(/1 of 3 steps completed/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, options]) => body(options).action === 'images').map(([, options]) => body(options).imageTemplateId)).toEqual([142]);

    // A local scene revision remains stale until every image succeeds, so the
    // real first-image response can still report every generated flag as false.
    const firstDone = structuredClone(initial);
    await finish(first, json({ data: firstDone }));
    await waitFor(() => expect(within(row('Second room')).getByText('Running')).toBeTruthy());
    expect(within(row('First room')).queryByText('Running')).toBeNull();
    expect(within(row('First room')).getByText('Completed')).toBeTruthy();
    expect(within(row('First room')).getByLabelText('Created')).toBeTruthy();
    expect(progress().value).toBe(2); expect(screen.getByText(/2 of 3 steps completed/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, options]) => body(options).action === 'images').map(([, options]) => body(options).imageTemplateId)).toEqual([142, 143]);

    const allDone = structuredClone(firstDone);
    allDone.template!.imageTemplates.forEach((image) => { image.generated = true; });
    allDone.listing.imagesNeedRegeneration = false;
    await finish(second, json({ data: allDone }));
    await screen.findByText('Generation complete');
    expect(progress().value).toBe(3); expect(screen.getByText(/3 of 3 steps completed/)).toBeTruthy();
    expect(within(row('Second room')).getByLabelText('Created')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Generate Images' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('stops on a failed image, leaves later rows unrun, and resets progress for a successful retry', async () => {
    const initial = editorData(); const failed = deferred(); const retriedFirst = deferred(); const retriedSecond = deferred();
    let firstAttempts = 0;
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      const request = body(options);
      if (request.action === 'clear-images') return json({ data: initial });
      if (request.imageTemplateId === 142) return firstAttempts++ === 0 ? failed.promise : retriedFirst.promise;
      if (request.imageTemplateId === 143) return retriedSecond.promise;
      throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' }));
    await waitFor(() => expect(within(row('First room')).getByText('Running')).toBeTruthy());
    await finish(failed, json({ error: 'The first room could not be rendered.' }, 500));
    await waitFor(() => expect(within(row('First room')).getByText('Failed')).toBeTruthy());
    expect(within(row('Second room')).getByText('Not run')).toBeTruthy();
    expect(progress().value).toBe(1);
    expect(screen.getByText(/Stopped:.*First room/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, options]) => body(options).imageTemplateId === 143)).toBe(false);

    // Close the existing generation failure dialog if this action exposes one.
    const dialog = screen.queryByRole('dialog');
    if (dialog) { const close = within(dialog).queryAllByRole('button', { name: /close/i })[0]; if (close) fireEvent.click(close); }
    fireEvent.click(screen.getByRole('button', { name: 'Generate Images' }));
    await waitFor(() => expect(within(row('First room')).getByText('Running')).toBeTruthy());
    expect(progress().value).toBe(1); expect(within(row('Second room')).getByText('Waiting')).toBeTruthy();
    await finish(retriedFirst, json({ data: initial }));
    await waitFor(() => expect(within(row('Second room')).getByText('Running')).toBeTruthy());
    await finish(retriedSecond, json({ data: initial }));
    await screen.findByText('Generation complete');
    expect(progress().value).toBe(3);
    expect(fetchMock.mock.calls.filter(([, options]) => body(options).action === 'clear-images')).toHaveLength(2);
  });

  it('tracks the full Generate through details, downloads, Dropbox and final status saving', async () => {
    const initial = editorData(); initial.template!.imageTemplates = initial.template!.imageTemplates.slice(0, 1);
    const details = deferred(); const firstDownload = deferred(); const dropbox = deferred(); const instructions = deferred(); const finalSave = deferred();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const request = body(options);
      if (url === overviewEndpoint) {
        if (request.action === 'clear-images' || request.action === 'images') return json({ data: initial });
        if (request.action === 'details') return details.promise;
        if (request.action === 'mark-current') return finalSave.promise;
      }
      if (url === downloadsEndpoint) return request.ratio === PRINTABLE_DOWNLOAD_SPECS[0].key ? firstDownload.promise : json({ data: initial });
      if (url === dropboxEndpoint && request.action === 'dropbox') return dropbox.promise;
      if (url === dropboxEndpoint && request.action === 'pdf') return instructions.promise;
      throw new Error(`Unexpected request: ${url} ${JSON.stringify(request)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(within(row('Create details')).getByText('Running')).toBeTruthy());
    const total = 1 + initial.template!.imageTemplates.length + 1 + PRINTABLE_DOWNLOAD_SPECS.length + 1 + 1 + 1 + 1;
    expect(progress().max).toBe(total); expect(progress().value).toBe(2);
    const stages = screen.getByRole('list', { name: 'Listing generation progress' });
    expect(within(stages).getByText(/image.*created/i)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url === downloadsEndpoint)).toBe(false);

    await finish(details, json({ data: initial }));
    await waitFor(() => expect(within(row(PRINTABLE_DOWNLOAD_SPECS[0].label)).getByText('Running')).toBeTruthy());
    expect(progress().value).toBe(3);
    await finish(firstDownload, json({ data: initial }));
    await waitFor(() => expect(within(row('Create Dropbox / Upload files / Create download instructions PDF')).getByText('Running')).toBeTruthy());
    expect(progress().value).toBe(3 + PRINTABLE_DOWNLOAD_SPECS.length + 1);
    expect(fetchMock.mock.calls.filter(([url]) => url === downloadsEndpoint).map(([, options]) => body(options).ratio)).toEqual([...PRINTABLE_DOWNLOAD_SPECS.map((spec) => spec.key), 'guide']);

    await finish(dropbox, json({ data: initial }));
    await waitFor(() => expect(within(row('Download Instructions')).getByText('Running')).toBeTruthy());
    expect(progress().value).toBe(total - 2);
    await finish(instructions, json({ data: initial }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => body(options).action === 'mark-current')).toBe(true));
    expect(progress().value).toBe(total - 1);
    expect(screen.queryByText('Generation complete')).toBeNull();
    await finish(finalSave, json({ data: initial }));
    await screen.findByText('Generation complete');
    expect(progress().value).toBe(total);
  });

  it('shows a direct image Run as Running even when that image was already generated', async () => {
    const initial = editorData(); initial.template!.imageTemplates[0].generated = true;
    const generated = deferred();
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (body(options).action === 'images') return generated.promise;
      throw new Error('Direct image Run should not clear all images.');
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(within(row('First room')).getByRole('button', { name: 'Run' }));
    expect(within(row('First room')).getByText('Running')).toBeTruthy();
    expect(within(row('First room')).queryByLabelText('Created')).toBeNull();
    expect((within(row('Second room')).getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
    await finish(generated, json({ data: initial }));
    await waitFor(() => expect(within(row('First room')).getByLabelText('Created')).toBeTruthy());
    expect(fetchMock.mock.calls.map(([, options]) => body(options))).toEqual([expect.objectContaining({ action: 'images', imageTemplateId: 142 })]);
  });

  it('tracks grouped generation through its instruction PDF without standalone downloads or a Dropbox stage', async () => {
    const initial = multipleData();
    const pdf = deferred(); const finalSave = deferred();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url !== overviewEndpoint) throw new Error(`Grouped generation must use the overview workflow: ${url}`);
      const request = body(options);
      if (request.action === 'grouped-pdf') return pdf.promise;
      if (request.action === 'mark-current') return finalSave.promise;
      if (['clear-images', 'images', 'details'].includes(request.action ?? '')) return json({ data: initial });
      throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(within(row('Download Instructions')).getByText('Running')).toBeTruthy());
    expect(progress().max).toBe(6); expect(progress().value).toBe(4);
    expect(screen.getByText(/4 of 6 steps completed/)).toBeTruthy();
    const stages = screen.getByRole('list', { name: 'Listing generation progress' });
    expect(within(stages).queryByText('Dropbox')).toBeNull();
    expect(within(stages).getAllByRole('listitem')).toHaveLength(3);
    expect(fetchMock.mock.calls.every(([url]) => url === overviewEndpoint)).toBe(true);
    await finish(pdf, json({ data: initial }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => body(options).action === 'mark-current')).toBe(true));
    expect(progress().value).toBe(5);
    expect(screen.queryByText('Generation complete')).toBeNull();
    await finish(finalSave, json({ data: initial }));
    await screen.findByText('Generation complete');
    expect(progress().value).toBe(6);
    expect(fetchMock.mock.calls.map(([, options]) => body(options).action)).toEqual(['clear-images', 'images', 'images', 'details', 'grouped-pdf', 'mark-current']);
  });

  it.each([
    { type: 'single', disabledBy: 'template' }, { type: 'single', disabledBy: 'listing override' },
    { type: 'multiple', disabledBy: 'template' }, { type: 'multiple', disabledBy: 'listing override' },
  ] as const)('finishes physical $type generation without Dropbox or instruction PDFs when disabled by $disabledBy', async ({ type, disabledBy }) => {
    const initial = type === 'multiple' ? multipleData() : editorData();
    if (disabledBy === 'template') initial.template!.digitalDownload = false;
    else initial.etsyProducts.config.digitalDownloadOverride = false;
    // A stale/legacy raw flag must not override the effective template settings.
    expect(initial.etsyProducts.config.digitalDownload).toBe(true);
    const finalSave = deferred();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const request = body(options);
      if (url === overviewEndpoint && request.action === 'mark-current') return finalSave.promise;
      if (url === overviewEndpoint && ['clear-images', 'images', 'details'].includes(request.action ?? '')) return json({ data: initial });
      if (url === downloadsEndpoint && type === 'single') return json({ data: initial });
      throw new Error(`Physical generation must not create Dropbox files or instruction PDFs: ${url} ${JSON.stringify(request)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    expect(screen.queryByRole('row', { name: /Download Instructions/ })).toBeNull();
    expect(screen.queryByRole('row', { name: /Create Dropbox/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => body(options).action === 'mark-current')).toBe(true));
    const total = 1 + initial.template!.imageTemplates.length + 1 + (type === 'single' ? PRINTABLE_DOWNLOAD_SPECS.length + 1 : 0) + 1;
    expect(progress().max).toBe(total); expect(progress().value).toBe(total - 1);
    const stages = screen.getByRole('list', { name: 'Listing generation progress' });
    expect(within(stages).queryByText('Dropbox')).toBeNull();
    expect(within(stages).getAllByRole('listitem')).toHaveLength(type === 'single' ? 3 : 2);
    expect(screen.queryByRole('row', { name: /Download Instructions/ })).toBeNull();
    expect(screen.queryByRole('row', { name: /Create Dropbox/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url === dropboxEndpoint)).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => url === overviewEndpoint).map(([, options]) => body(options).action)).toEqual(['clear-images', 'images', 'images', 'details', 'mark-current']);
    expect(fetchMock.mock.calls.filter(([url]) => url === downloadsEndpoint).map(([, options]) => body(options).ratio)).toEqual(type === 'single' ? [...PRINTABLE_DOWNLOAD_SPECS.map(spec => spec.key), 'guide'] : []);
    if (type === 'single') expect(within(row('How to print guide')).getByText('Completed')).toBeTruthy();
    await finish(finalSave, json({ data: initial }));
    await screen.findByText('Generation complete');
    expect(progress().value).toBe(total);
  });

  it.each(['single', 'multiple'] as const)('removes pending Dropbox/PDF work when refreshed %s settings disable digital downloads after details', async type => {
    const initial = type === 'multiple' ? multipleData() : editorData();
    const physical = structuredClone(initial); physical.etsyProducts.config.digitalDownloadOverride = false;
    const details = deferred(), finalSave = deferred();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const request = body(options);
      if (url === overviewEndpoint && request.action === 'details') return details.promise;
      if (url === overviewEndpoint && request.action === 'mark-current') return finalSave.promise;
      if (url === overviewEndpoint && ['clear-images', 'images'].includes(request.action ?? '')) return json({ data: initial });
      if (url === downloadsEndpoint && type === 'single') return json({ data: physical });
      throw new Error(`Refreshed physical settings must prevent later Dropbox/PDF work: ${url} ${JSON.stringify(request)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(within(row('Create details')).getByText('Running')).toBeTruthy());
    const completedBeforeDetails = 1 + initial.template!.imageTemplates.length;
    const physicalTotal = completedBeforeDetails + 1 + (type === 'single' ? PRINTABLE_DOWNLOAD_SPECS.length + 1 : 0) + 1;
    expect(progress().max).toBe(physicalTotal + (type === 'single' ? 2 : 1));
    expect(progress().value).toBe(completedBeforeDetails);
    await finish(details, json({ data: physical }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => body(options).action === 'mark-current')).toBe(true));
    expect(progress().max).toBe(physicalTotal); expect(progress().value).toBe(physicalTotal - 1);
    expect(within(screen.getByRole('list', { name: 'Listing generation progress' })).queryByText('Dropbox')).toBeNull();
    expect(screen.queryByRole('row', { name: /Download Instructions/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url === dropboxEndpoint)).toBe(false);
    expect(fetchMock.mock.calls.some(([, options]) => body(options).action === 'grouped-pdf')).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => url === downloadsEndpoint).map(([, options]) => body(options).ratio)).toEqual(type === 'single' ? [...PRINTABLE_DOWNLOAD_SPECS.map(spec => spec.key), 'guide'] : []);
    await finish(finalSave, json({ data: physical }));
    await screen.findByText('Generation complete');
    expect(progress().value).toBe(physicalTotal);
  });

  it('drops pending Dropbox/PDF steps when the completed print guide refresh disables digital downloads', async () => {
    const initial = editorData(), physical = structuredClone(initial);
    physical.etsyProducts.config.digitalDownloadOverride = false;
    const guide = deferred(), finalSave = deferred();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const request = body(options);
      if (url === overviewEndpoint && request.action === 'mark-current') return finalSave.promise;
      if (url === overviewEndpoint && ['clear-images', 'images', 'details'].includes(request.action ?? '')) return json({ data: initial });
      if (url === downloadsEndpoint) return request.ratio === 'guide' ? guide.promise : json({ data: initial });
      throw new Error(`The refreshed print-guide settings must prevent Dropbox/PDF work: ${url} ${JSON.stringify(request)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(within(row('How to print guide')).getByText('Running')).toBeTruthy());
    const physicalTotal = 1 + initial.template!.imageTemplates.length + 1 + PRINTABLE_DOWNLOAD_SPECS.length + 1 + 1;
    expect(progress().max).toBe(physicalTotal + 2); expect(progress().value).toBe(physicalTotal - 2);
    await finish(guide, json({ data: physical }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => body(options).action === 'mark-current')).toBe(true));
    expect(progress().max).toBe(physicalTotal); expect(progress().value).toBe(physicalTotal - 1);
    expect(within(row('How to print guide')).getByText('Completed')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Listing generation progress' })).queryByText('Dropbox')).toBeNull();
    expect(screen.queryByRole('row', { name: /Download Instructions/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url === dropboxEndpoint)).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => url === downloadsEndpoint).map(([, options]) => body(options).ratio)).toEqual([...PRINTABLE_DOWNLOAD_SPECS.map(spec => spec.key), 'guide']);
    await finish(finalSave, json({ data: physical }));
    await screen.findByText('Generation complete');
    expect(progress().value).toBe(physicalTotal); expect(progress().value).toBe(progress().max);
  });

  it('preserves completed stages when a full-generation download fails and never starts later stages', async () => {
    const initial = editorData(); initial.template!.imageTemplates = initial.template!.imageTemplates.slice(0, 1);
    const download = deferred();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const request = body(options);
      if (url === downloadsEndpoint) return download.promise;
      if (url === overviewEndpoint && ['clear-images', 'images', 'details'].includes(request.action ?? '')) return json({ data: initial });
      throw new Error(`No later work should begin after the download failure: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(within(row(PRINTABLE_DOWNLOAD_SPECS[0].label)).getByText('Running')).toBeTruthy());
    expect(progress().value).toBe(3);
    await finish(download, json({ error: 'The printable artwork could not be created.' }, 500));
    const dialog = await screen.findByRole('dialog', { name: 'Listing generation stopped' });
    expect(within(dialog).getByText('The printable artwork could not be created.')).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row(PRINTABLE_DOWNLOAD_SPECS[0].label)).getByText('Failed')).toBeTruthy();
    expect(within(row('How to print guide')).getByText('Not run')).toBeTruthy();
    expect(progress().value).toBe(3); expect(progress().value).toBeLessThan(progress().max);
    const stages = screen.getByRole('list', { name: 'Listing generation progress' });
    expect(within(stages).getByText(/image.*created/i)).toBeTruthy();
    expect(within(stages).getByText('Listing details and tags created')).toBeTruthy();
    expect(within(stages).getByText('Create Digital Downloads').closest('li')?.textContent).toContain('Stopped because an error occurred');
    expect(within(stages).getByText('Dropbox').closest('li')?.textContent).toContain('Waiting');
    expect(fetchMock.mock.calls.filter(([url]) => url === downloadsEndpoint)).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url === dropboxEndpoint)).toBe(false);
    expect(fetchMock.mock.calls.some(([, options]) => body(options).action === 'mark-current')).toBe(false);
  });

  it('reports final status-save failure below 100% without changing the completed generation stages', async () => {
    const initial = editorData(); initial.template!.imageTemplates = initial.template!.imageTemplates.slice(0, 1);
    const finalSave = deferred();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const request = body(options);
      if (url === overviewEndpoint && request.action === 'mark-current') return finalSave.promise;
      if (url === overviewEndpoint || url === downloadsEndpoint || url === dropboxEndpoint) return json({ data: initial });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => body(options).action === 'mark-current')).toBe(true));
    expect(progress().value).toBe(progress().max - 1);
    expect(screen.getByText('Running: Saving generation status')).toBeTruthy();
    const stages = screen.getByRole('list', { name: 'Listing generation progress' });
    const completedStages = within(stages).getAllByRole('listitem').map((stage) => stage.textContent);
    expect(completedStages).toHaveLength(4);
    expect(completedStages.every((stage) => !/Waiting|Stopped/.test(stage ?? ''))).toBe(true);
    await finish(finalSave, json({ error: 'The generation revision could not be saved.' }, 500));
    const dialog = await screen.findByRole('dialog', { name: 'Listing generation stopped' });
    expect(within(dialog).getByText(/Saving generation status could not be completed/)).toBeTruthy();
    expect(within(dialog).getByText('The generation revision could not be saved.')).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(progress().value).toBe(progress().max - 1);
    expect(progress().value).toBeLessThan(progress().max);
    expect(screen.getByText('Stopped: Saving generation status')).toBeTruthy();
    expect(screen.queryByText('Generation complete')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Listing generation progress' })).getAllByRole('listitem').map((stage) => stage.textContent)).toEqual(completedStages);
  });
});
