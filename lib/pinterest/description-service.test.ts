import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listing: vi.fn(), board: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyListing: { findUnique: mocks.listing },
  pinterestBoard: { findUnique: mocks.board },
} }));

import { buildPinterestDescriptionSource, loadPinterestDescriptionSource } from './description-service';

type DescriptionListing = Parameters<typeof buildPinterestDescriptionSource>[0];

function listing(overrides: Partial<DescriptionListing> = {}): DescriptionListing {
  return {
    id: 194,
    title: 'Local fox print title',
    digitalTitle: 'Local fox printable title',
    listingItem: '  Red Fox  ',
    localDirectoryName: 'Fox',
    listingDescription: '  A russet fox with a white-tipped tail beside soft ferns.  ',
    url: 'https://www.etsy.com/listing/111/original-fox-print',
    etsyDownloadUrl: 'https://www.etsy.com/listing/333/fox-digital-download',
    etsyCustomisedUrl: 'https://www.etsy.com/listing/222/custom-fox',
    etsyId: '111',
    etsyCustomisedId: '222',
    etsyDownloadId: '333',
    rawJson: { listing_type: 'physical', title: 'Fox Physical Nursery Print' },
    etsyCustomisedRawJson: { listing_type: 'physical', title: 'Fox Customised Nursery Print' },
    etsyDownloadRawJson: { listing_type: 'download', title: 'Fox Printable Nursery Art' },
    etsyProductType: 'physical',
    products: [{ productType: 'physical' }, { productType: 'digital' }],
    productConfig: { digitalDownload: true, printsFrames: true },
    priceMappings: [
      { fulfilmentProvider: 'Etsy inventory:print', productKey: 'framed_a4' },
      { fulfilmentProvider: 'Etsy inventory:print', productKey: 'unframed_a3' },
      { fulfilmentProvider: 'Etsy inventory:customised', productKey: 'framed_a2' },
    ],
    ...overrides,
  };
}

function unsyncedListing(overrides: Partial<DescriptionListing> = {}) {
  return listing({
    url: null, etsyDownloadUrl: null, etsyCustomisedUrl: null,
    etsyId: null, etsyDownloadId: null, etsyCustomisedId: null,
    rawJson: null, etsyDownloadRawJson: null, etsyCustomisedRawJson: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listing.mockResolvedValue(listing());
  mocks.board.mockResolvedValue({ name: 'Woodland Nursery Prints & Decor' });
});

describe('Pinterest product description context', () => {
  it('uses a genuine digital URL when the primary URL is absent, despite stale local physical settings', () => {
    const source = listing({ url: null, products: [{ productType: 'physical' }], etsyProductType: 'physical' });
    const result = buildPinterestDescriptionSource(source, 'Woodland Art');

    expect(result.destinationUrl).toBe('https://www.etsy.com/listing/333/fox-digital-download');
    expect(result.context).toMatchObject({ destinationType: 'digital', listingTitle: 'Fox Printable Nursery Art' });
  });

  it('falls back to a known customised URL when primary and download URLs are absent', () => {
    const result = buildPinterestDescriptionSource(listing({ url: null, etsyDownloadUrl: null }), 'Woodland Art');

    expect(result.destinationUrl).toBe('https://www.etsy.com/listing/222/custom-fox');
    expect(result.context.listingTitle).toBe('Fox Customised Nursery Print');
  });

  it('keeps the valid primary URL ahead of fallback URLs and local intent', () => {
    const result = buildPinterestDescriptionSource(listing({ etsyProductType: 'digital' }), 'Woodland Art');
    expect(result.destinationUrl).toBe('https://www.etsy.com/listing/111/original-fox-print');
    expect(result.context.destinationType).toBe('physical');
  });

  it.each([
    { url: 'https://www.etsy.com/listing/444/unknown-artwork' },
    { etsyDownloadUrl: 'https://example.com/not-etsy' },
    { etsyCustomisedUrl: '' },
  ])('does not overlook an invalid configured link in favour of a valid fallback: %j', (overrides) => {
    expect(() => buildPinterestDescriptionSource(listing(overrides), 'Woodland Art')).toThrow();
    expect(() => buildPinterestDescriptionSource(listing(overrides), 'Woodland Art', undefined, 'STANDARD', true)).toThrow();
  });

  it('does not create scheduled or publishable reference data without a URL', () => {
    expect(() => buildPinterestDescriptionSource(unsyncedListing(), 'Woodland Art')).toThrow('real Etsy listing URL');
  });

  it.each([
    { productType: 'digital', intent: 'physical', expected: 'digital' },
    { productType: 'physical', intent: 'digital', expected: 'physical' },
  ])('allows URL-less draft context from an unambiguous local $productType product', ({ productType, intent, expected }) => {
    const result = buildPinterestDescriptionSource(unsyncedListing({
      products: [{ productType }], etsyProductType: intent,
    }), 'Woodland Art', undefined, 'STANDARD', true);

    expect(result.destinationUrl).toBeNull();
    expect(result.context.destinationType).toBe(expected);
    expect(result.context.physicalOptions).toEqual({ framed: false, unframed: false });
    expect(result.context.listingTitle).toBe(expected === 'digital' ? 'Local fox printable title' : 'Local fox print title');
  });

  it.each([
    { digitalDownload: true, printsFrames: false, expected: 'digital' },
    { digitalDownload: false, printsFrames: true, expected: 'physical' },
  ])('uses unambiguous configuration when no product rows exist: $expected', ({ expected, ...config }) => {
    const result = buildPinterestDescriptionSource(unsyncedListing({ products: [], productConfig: config }), 'Woodland Art', undefined, 'STANDARD', true);
    expect(result.destinationUrl).toBeNull();
    expect(result.context.destinationType).toBe(expected);
  });

  it.each(['digital', 'physical'])('uses primary %s intent when both local product types exist', (etsyProductType) => {
    const result = buildPinterestDescriptionSource(unsyncedListing({ etsyProductType }), 'Woodland Art', undefined, 'STANDARD', true);
    expect(result.context.destinationType).toBe(etsyProductType);
    expect(result.context.physicalOptions).toEqual({ framed: false, unframed: false });
  });

  it('preserves an explicitly null saved draft destination instead of switching to a configured URL', () => {
    const result = buildPinterestDescriptionSource(listing(), 'Woodland Art', null, 'room_inspiration', true);
    expect(result.destinationUrl).toBeNull();
    expect(result.context).toMatchObject({ listingTitle: 'Local fox print title', destinationType: 'physical', creativeType: 'room_inspiration', physicalOptions: { framed: false, unframed: false } });
  });

  it('uses the physical destination snapshot, curated subject and brief, board and creative angle', () => {
    const result = buildPinterestDescriptionSource(listing(), 'Woodland Nursery Prints & Decor', undefined, 'product_detail');

    expect(result).toEqual({
      destinationUrl: 'https://www.etsy.com/listing/111/original-fox-print',
      title: 'Fox Physical Nursery Print',
      context: {
        subject: 'Red Fox',
        boardName: 'Woodland Nursery Prints & Decor',
        destinationType: 'physical',
        listingTitle: 'Fox Physical Nursery Print',
        productDescription: 'A russet fox with a white-tipped tail beside soft ferns.',
        creativeType: 'product_detail',
        physicalOptions: { framed: true, unframed: true },
      },
    });
    expect(mocks.listing).not.toHaveBeenCalled();
    expect(mocks.board).not.toHaveBeenCalled();
  });

  it('selects the exact digital listing and never offers its physical finishes', () => {
    const destination = 'https://www.etsy.com/listing/333/fox-digital-download';
    const result = buildPinterestDescriptionSource(listing(), 'Printable Woodland Art', destination, 'digital_download');

    expect(result).toMatchObject({
      destinationUrl: destination,
      title: 'Fox Printable Nursery Art',
      context: {
        destinationType: 'digital',
        listingTitle: 'Fox Printable Nursery Art',
        creativeType: 'digital_download',
        physicalOptions: { framed: false, unframed: false },
      },
    });
  });

  it('selects customised snapshot and only its own mapped finishes', () => {
    const result = buildPinterestDescriptionSource(listing(), 'Woodland Art', 'https://www.etsy.com/listing/222/custom-fox');

    expect(result).toMatchObject({
      title: 'Fox Customised Nursery Print',
      context: {
        destinationType: 'physical',
        listingTitle: 'Fox Customised Nursery Print',
        physicalOptions: { framed: true, unframed: false },
      },
    });
  });

  it.each([
    'https://www.etsy.com/listing/111/a-different-slug',
    'https://etsy.com/listing/111',
    'https://www.etsy.com/uk/listing/111/fox?ref=pin&utm_source=pinterest',
    'https://www.etsy.com/en-gb/listing/111/fox#details',
    'https://WWW.ETSY.COM/listing/111/FOX',
  ])('matches the listing ID independently of locale, slug, query and hostname case: %s', (destination) => {
    const result = buildPinterestDescriptionSource(listing(), 'Woodland Art', destination);
    expect(result.destinationUrl).toBe(destination);
    expect(result.context.destinationType).toBe('physical');
    expect(result.context.listingTitle).toBe('Fox Physical Nursery Print');
  });

  it.each([
    null,
    '',
    'http://www.etsy.com/listing/111/fox',
    'https://example.com/listing/111/fox',
    'https://www.etsy.com.example.com/listing/111/fox',
    'https://www.etsy.com/shop/FoxPrints',
    '/listing/111/fox',
  ])('rejects a missing or invalid Etsy destination: %s', (destination) => {
    expect(() => buildPinterestDescriptionSource(listing(), 'Woodland Art', destination)).toThrow('real Etsy listing URL');
  });

  it('rejects another artwork’s Etsy listing even when its URL looks valid', () => {
    expect(() => buildPinterestDescriptionSource(listing(), 'Woodland Art', 'https://www.etsy.com/listing/444/another-fox'))
      .toThrow('does not identify one');
  });

  it('rejects an ambiguous ID instead of guessing which offer it represents', () => {
    expect(() => buildPinterestDescriptionSource(listing({ etsyDownloadId: '111' }), 'Woodland Art'))
      .toThrow('does not identify one');
  });

  it.each([{ listing_type: 'download' }, { type: 'digital' }])('recognises a digital offer retained in the legacy print-ID slot: %j', (remoteType) => {
    const result = buildPinterestDescriptionSource(listing({
      rawJson: { ...remoteType, title: 'Legacy Fox Digital Artwork' },
    }), 'Woodland Art');

    expect(result).toMatchObject({
      title: 'Legacy Fox Digital Artwork',
      context: { destinationType: 'digital', listingTitle: 'Legacy Fox Digital Artwork', physicalOptions: { framed: false, unframed: false } },
    });
  });

  it('rejects conflicting physical information on the download destination', () => {
    expect(() => buildPinterestDescriptionSource(listing({
      etsyDownloadRawJson: { listing_type: 'physical', title: 'Physical print' },
    }), 'Woodland Art', 'https://www.etsy.com/listing/333/download'))
      .toThrow('conflicting product information');
  });

  it('falls back to the variant’s local title when its remote title is absent', () => {
    expect(buildPinterestDescriptionSource(listing({ rawJson: null }), 'Woodland Art').context.listingTitle)
      .toBe('Local fox print title');
    expect(buildPinterestDescriptionSource(listing({ etsyDownloadRawJson: {} }), 'Woodland Art', 'https://www.etsy.com/listing/333/download').context.listingTitle)
      .toBe('Local fox printable title');
  });

  it('ignores mixed broad descriptions, room-theme metadata and template flags', () => {
    const source = {
      ...listing({ listingDescription: null }),
      description: 'Mixed offers: digital downloads and physical framed prints with unverified delivery promises.',
      roomTheme: 'Sea Creatures',
      ourCategory: { printsFrames: false, digitalDownload: true },
    };
    const result = buildPinterestDescriptionSource(source, 'Woodland Nursery Prints');

    expect(result.context.productDescription).toBe('');
    expect(result.context.destinationType).toBe('physical');
    expect(result.context.boardName).toBe('Woodland Nursery Prints');
    expect(JSON.stringify(result.context)).not.toContain('Mixed offers');
    expect(JSON.stringify(result.context)).not.toContain('Sea Creatures');
  });

  it('uses a readable local directory name, then the first title segment, when no subject is provided', () => {
    expect(buildPinterestDescriptionSource(listing({ listingItem: ' ', localDirectoryName: 'BlueMorphoButterfly' }), 'Bug Art').context.subject)
      .toBe('Blue Morpho Butterfly');
    expect(buildPinterestDescriptionSource(listing({ listingItem: null, localDirectoryName: null, rawJson: { title: 'Red Fox | Nursery Wall Art' } }), 'Woodland Art').context.subject)
      .toBe('Red Fox');
  });

  it('does not infer print finishes from template flags, another variant or unrelated provider mappings', () => {
    const source = {
      ...listing({ priceMappings: [
        { fulfilmentProvider: 'Etsy inventory:customised', productKey: 'framed_a4' },
        { fulfilmentProvider: 'Etsy inventory:customised', productKey: 'unframed_a4' },
        { fulfilmentProvider: 'PrintShrimp', productKey: 'framed_a4' },
        { fulfilmentProvider: 'Etsy inventory', productKey: 'unframed_a4' },
      ] }),
      ourCategory: { frames: { black: true, no_frame: true } },
    };

    expect(buildPinterestDescriptionSource(source, 'Woodland Art').context.physicalOptions)
      .toEqual({ framed: false, unframed: false });
  });

  it('keeps print and customised finish availability independent in both directions', () => {
    const source = listing({ priceMappings: [
      { fulfilmentProvider: 'Etsy inventory:print', productKey: 'framed_a4' },
      { fulfilmentProvider: 'Etsy inventory:customised', productKey: 'unframed_a4' },
    ] });

    expect(buildPinterestDescriptionSource(source, 'Woodland Art').context.physicalOptions)
      .toEqual({ framed: true, unframed: false });
    expect(buildPinterestDescriptionSource(source, 'Woodland Art', 'https://www.etsy.com/listing/222/custom').context.physicalOptions)
      .toEqual({ framed: false, unframed: true });
  });
});

describe('loading Pinterest description reference data', () => {
  it('loads only reference data and defaults to the listing’s saved destination', async () => {
    const result = await loadPinterestDescriptionSource(194, 10);

    expect(result.context.boardName).toBe('Woodland Nursery Prints & Decor');
    expect(result.destinationUrl).toBe('https://www.etsy.com/listing/111/original-fox-print');
    expect(mocks.listing).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 194 } }));
    expect(mocks.board).toHaveBeenCalledWith({ where: { id: 10 }, select: { name: true } });
  });

  it('uses an existing Pin’s exact digital destination and creative type', async () => {
    const destination = 'https://www.etsy.com/uk/listing/333/changed-slug';
    const result = await loadPinterestDescriptionSource(194, 10, destination, 'digital_download');

    expect(result.destinationUrl).toBe(destination);
    expect(result.context).toMatchObject({ destinationType: 'digital', creativeType: 'digital_download', listingTitle: 'Fox Printable Nursery Art' });
  });

  it('reports a missing listing', async () => {
    mocks.listing.mockResolvedValue(null);
    await expect(loadPinterestDescriptionSource(194, 10)).rejects.toThrow('Listing not found.');
  });

  it('reports a missing Pinterest board', async () => {
    mocks.board.mockResolvedValue(null);
    await expect(loadPinterestDescriptionSource(194, 10)).rejects.toThrow('Pinterest board not found.');
  });

  it('does not replace an explicitly missing Pin destination with another offer', async () => {
    await expect(loadPinterestDescriptionSource(194, 10, null)).rejects.toThrow('real Etsy listing URL');
  });

  it('resolves a digital-only listing’s fallback URL before considering stale local physical settings', async () => {
    mocks.listing.mockResolvedValue(listing({ url: null, products: [{ productType: 'physical' }] }));

    const result = await loadPinterestDescriptionSource(194, 10);

    expect(result.destinationUrl).toBe('https://www.etsy.com/listing/333/fox-digital-download');
    expect(result.context.destinationType).toBe('digital');
  });

  it('allows a URL-less draft only when explicitly requested', async () => {
    mocks.listing.mockResolvedValue(unsyncedListing({ products: [], productConfig: null, etsyProductType: 'digital' }));

    await expect(loadPinterestDescriptionSource(194, 10)).rejects.toThrow('real Etsy listing URL');
    const result = await loadPinterestDescriptionSource(194, 10, undefined, 'STANDARD', true);

    expect(result.destinationUrl).toBeNull();
    expect(result.context.destinationType).toBe('digital');
    expect(result.context.physicalOptions).toEqual({ framed: false, unframed: false });
  });

  it('retains a saved draft’s explicitly null destination during regeneration', async () => {
    const result = await loadPinterestDescriptionSource(194, 10, null, 'room_inspiration', true);

    expect(result.destinationUrl).toBeNull();
    expect(result.context).toMatchObject({ listingTitle: 'Local fox print title', creativeType: 'room_inspiration' });
  });

  it('still rejects an explicit unknown destination when URL-less drafts are allowed', async () => {
    await expect(loadPinterestDescriptionSource(194, 10, 'https://www.etsy.com/listing/444/unknown', 'STANDARD', true))
      .rejects.toThrow('does not identify one');
  });
});
