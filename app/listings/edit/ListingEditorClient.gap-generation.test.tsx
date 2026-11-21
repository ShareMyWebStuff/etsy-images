import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingEditorData } from '@/lib/listing-editor';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';
import { defaultListingPersonalisationTextAreaSettings } from '@/lib/personalisation-text-areas';

vi.mock('@/components/MarketsDeliverySettings', () => ({ MarketsDeliverySettings: () => null }));
vi.mock('./ListingPrintCropDialog', () => ({ ListingPrintCropDialog: () => null }));
vi.mock('./ListingTextAreasDialog', () => ({ ListingTextAreasDialog: () => null }));
vi.mock('./ListingPersonalisationPreviewDialog', () => ({ ListingPersonalisationPreviewDialog: () => null }));
vi.mock('./ListingMockupTesterDialog', () => ({ ListingMockupTesterDialog: () => null }));
vi.mock('./ListingTemplateSelector', () => ({ ListingTemplateSelector: () => null }));

import { ListingEditorClient } from './ListingEditorClient';

function editorData(ready: boolean, fileName = 'thumbnail.png', updatedAt = '2026-11-17T12:00:00.000Z'): ListingEditorData {
  const cropSource = { fileName, updatedAt, width: 1120, height: 1400 };
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
      personalisationTextAreas: ready ? defaultListingPersonalisationTextAreaSettings() : null,
      printCropSettings: ready ? createListingPrintCropSettings(defaultNativeListingPrintCropDraft(1120, 1400), cropSource) : null,
      status: 'active', quantity: 99, priceAmount: 1599, priceDivisor: 100, priceCurrencyCode: 'GBP',
      taxonomyId: 1, shopSectionId: 1, whoMade: 'i_did', whenMade: '2020_2026', isSupply: false,
      shouldAutoRenew: true, isPersonalizable: true, language: 'en-GB', primaryColour: 'Orange', secondaryColour: 'White',
      listingType: 'physical', etsySku: 'FOX-194', numberOfItems: 1, includeAllItems: false, thumbnailUpdatedAt: updatedAt,
    },
    template: {
      id: 8, name: 'Woodland Animals Kids', templateType: 'single', itemCount: 1, followedTemplateId: null,
      printsFrames: true, customisePrints: true, customTop: true, customBottom: true, digitalDownload: true,
      backgroundColour: '#F5F0E8', downloadSection: { title: 'Digital downloads', etsyShopSectionId: 2 },
      imageTemplates: [{ id: '142', name: 'Listing Image', position: 0, generated: false }],
    },
    groupCandidates: [], groupItems: [], sales: { itemsSold: 0, orderCount: 0, lastSoldAt: null },
    thumbnail: { fileName, originalFileName: 'Fox source.png', updatedAt, widthPixels: 1120, heightPixels: 1400, ratio: '4x5' },
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

function json(value: unknown) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
afterEach(() => vi.unstubAllGlobals());

describe('listing generation after adjusting the thumbnail gap', () => {
  it.each([
    { scenario: 'preserves a ready listing', initiallyReady: true },
    { scenario: 'recovers a listing whose previous gap adjustment cleared its preparation', initiallyReady: false },
  ])('$scenario and updates the preview without leaving Generate controls disabled', async ({ initiallyReady }) => {
    const initial = editorData(initiallyReady);
    const adjusted = editorData(true, 'thumbnail-gap-adjusted.png', '2026-11-17T13:00:00.000Z');
    let serverData = initial;
    let finishAdjustment!: (response: Response) => void;
    const adjustment = new Promise<Response>((resolve) => { finishAdjustment = resolve; });
    const endpoint = '/api/shops/listings/editor/thumbnail-gap';
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === endpoint && options?.method === 'POST') return adjustment;
      if (url.startsWith(`${endpoint}?`)) return json({
        analysis: { eligible: true, reason: null },
        thumbnailVersion: serverData === initial ? 'initial-version' : 'adjusted-version',
        thumbnailIdentity: { fileName: serverData.thumbnail!.fileName, updatedAt: serverData.thumbnail!.updatedAt },
      });
      throw new Error(`Unexpected request during the gap integration test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ListingEditorClient initialData={initial} />);
    const generateImages = screen.getByRole('button', { name: 'Generate Images' }) as HTMLButtonElement;
    const generate = screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement;
    expect(generateImages.disabled).toBe(!initiallyReady);
    expect(generate.disabled).toBe(!initiallyReady);
    const initialPreview = screen.getByAltText('Fox source.png').getAttribute('src');
    const gapButton = screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement;
    await waitFor(() => expect(gapButton.disabled).toBe(false));

    fireEvent.click(gapButton);

    expect(generateImages.disabled).toBe(true);
    expect(generate.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Adjusting...' })).toBeTruthy();
    serverData = adjusted;
    await act(async () => finishAdjustment(json({
      changed: true, analysis: { eligible: true, reason: null }, thumbnailVersion: 'adjusted-version', data: adjusted,
    })));

    await waitFor(() => {
      expect(generateImages.disabled).toBe(false);
      expect(generate.disabled).toBe(false);
    });
    const updatedPreview = screen.getByAltText('Fox source.png').getAttribute('src');
    expect(updatedPreview).not.toBe(initialPreview);
    expect(new URL(updatedPreview!, 'http://localhost').searchParams.get('v')).toBe(adjusted.listing.thumbnailUpdatedAt);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')[0][0]).toBe(endpoint);
  });
});
