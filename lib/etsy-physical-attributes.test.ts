import { describe, expect, it, vi } from 'vitest';
import {
  buildPhysicalAttributePlan,
  derivePhysicalAttributeLabels,
  resolveArtworkOrientation,
  syncEtsyPhysicalListingAttributes,
  type EtsyListingProperty,
  type EtsyTaxonomyProperty,
  type PhysicalAttributeLabels,
} from './etsy-physical-attributes';

const property = (id: number, name: string, values: string[]): EtsyTaxonomyProperty => ({
  property_id: id,
  display_name: name,
  possible_values: values.map((value, index) => ({ value_id: id * 100 + index + 1, name: value })),
});

const taxonomy = [
  property(1, 'Framing', ['Framed', 'Unframed']),
  property(2, 'Orientation', ['Portrait', 'Landscape']),
  property(3, 'Frame Color', ['Black', 'White', 'Natural Oak']),
  property(4, 'Home style', ['Scandinavian', 'Modern']),
  property(5, 'Occasion', ['Birthday']),
  property(6, 'Celebration', ['Baby shower']),
  property(7, 'Room', ['Nursery', 'Bedroom', 'Playroom']),
];

const baseInput = {
  artwork: [{ widthPixels: 1446, heightPixels: 2048 }],
  roomTheme: 'Scandinavian ocean nursery',
  sectionTitle: 'Sea Creatures Wall Art',
  listingTitle: 'Green Sea Turtle Nursery Print',
};

function emptyCurrent(): EtsyListingProperty[] {
  return [];
}

function planFor(labels: PhysicalAttributeLabels, current = emptyCurrent()) {
  return buildPhysicalAttributePlan(labels, taxonomy, current);
}

describe('Etsy physical listing attributes', () => {
  it('derives Framed and every selected PrintShrimp frame colour', () => {
    const labels = derivePhysicalAttributeLabels({
      ...baseInput,
      frameOptions: [
        { frameKey: 'black', enabled: true },
        { frameKey: 'white', enabled: true },
        { frameKey: 'oak', enabled: true },
        { frameKey: 'no_frame', enabled: false },
      ],
    });
    expect(labels.Framing).toEqual(['Framed']);
    expect(labels['Frame colour']).toEqual(['Black', 'White', 'Natural Oak']);
    expect(planFor(labels).updates.find(({ propertyName }) => propertyName === 'Frame colour')).toMatchObject({
      values: ['Black', 'White', 'Natural Oak'],
    });
  });

  it('derives Unframed without a frame colour for an unframed-only listing', () => {
    const labels = derivePhysicalAttributeLabels({
      ...baseInput,
      frameOptions: [{ frameKey: 'no_frame', enabled: true }, { frameKey: 'black', enabled: false }],
    });
    expect(labels.Framing).toEqual(['Unframed']);
    expect(labels['Frame colour']).toEqual([]);
  });

  it('derives both framing values for mixed framed and unframed options', () => {
    const labels = derivePhysicalAttributeLabels({
      ...baseInput,
      frameOptions: [{ frameKey: 'no_frame', enabled: true }, { frameKey: 'oak', enabled: true }],
    });
    expect(labels.Framing).toEqual(['Framed', 'Unframed']);
  });

  it('uses Etsy exact Natural Oak spelling and omits disabled frame options', () => {
    const labels = derivePhysicalAttributeLabels({
      ...baseInput,
      frameOptions: [
        { frameKey: 'black', enabled: false },
        { frameKey: 'white', enabled: false },
        { frameKey: 'oak', enabled: true },
      ],
    });
    expect(planFor(labels).updates.find(({ propertyName }) => propertyName === 'Frame colour')).toMatchObject({
      valueIds: ['303'],
      values: ['Natural Oak'],
    });
  });

  it('resolves portrait, landscape, and the explicit portrait fallback', () => {
    expect(resolveArtworkOrientation([{ widthPixels: 1446, heightPixels: 2048 }])).toBe('Portrait');
    expect(resolveArtworkOrientation([{ widthPixels: 2048, heightPixels: 1446 }])).toBe('Landscape');
    expect(resolveArtworkOrientation([])).toBe('Portrait');
    expect(resolveArtworkOrientation([{ widthPixels: 2000, heightPixels: 2000 }])).toBe('Portrait');
  });

  it('leaves Occasion and Celebration unset for ordinary nursery art', () => {
    const labels = derivePhysicalAttributeLabels({ ...baseInput, frameOptions: [] });
    expect(labels.Occasion).toEqual([]);
    expect(labels.Celebration).toEqual([]);
  });

  it('skips unavailable optional taxonomy values without throwing', () => {
    const labels = derivePhysicalAttributeLabels({
      ...baseInput,
      roomTheme: 'Victorian nursery',
      frameOptions: [],
    });
    labels['Home style'] = ['Victorian'];
    expect(() => planFor(labels)).not.toThrow();
    expect(planFor(labels).updates.some(({ propertyName }) => propertyName === 'Home style')).toBe(false);
  });

  it('replaces stale frame selections and clears a stale frame colour', () => {
    const current: EtsyListingProperty[] = [
      { property_id: 1, property_name: 'Framing', value_ids: [101], values: ['Framed'] },
      { property_id: 3, property_name: 'Frame colour', value_ids: [301], values: ['Black'] },
    ];
    const labels = derivePhysicalAttributeLabels({
      ...baseInput,
      frameOptions: [{ frameKey: 'no_frame', enabled: true }],
    });
    const plan = planFor(labels, current);
    expect(plan.updates.find(({ propertyName }) => propertyName === 'Framing')).toMatchObject({ values: ['Unframed'] });
    expect(plan.deletes).toContainEqual({ propertyId: '3', propertyName: 'Frame colour' });
  });

  it('is idempotent when Etsy already has the desired values', () => {
    const labels = derivePhysicalAttributeLabels({
      ...baseInput,
      frameOptions: [{ frameKey: 'black', enabled: true }, { frameKey: 'oak', enabled: true }],
    });
    const first = planFor(labels);
    const current = first.updates.map(({ propertyId, propertyName, valueIds, values }) => ({
      property_id: propertyId,
      property_name: propertyName,
      value_ids: valueIds,
      values,
    }));
    expect(planFor(labels, current)).toEqual({ updates: [], deletes: [] });
  });

  it('does not call physical property endpoints for a digital-only sync', async () => {
    const request = vi.fn();
    const labels = derivePhysicalAttributeLabels({ ...baseInput, frameOptions: [] });
    await expect(syncEtsyPhysicalListingAttributes({
      variant: 'download',
      shopId: '66615491',
      listingId: '123',
      taxonomyId: 121,
      labels,
    }, request)).resolves.toEqual({ updates: 0, deletes: 0 });
    expect(request).not.toHaveBeenCalled();
  });

  it('sends changed values and deletes stale managed properties with Etsy form payloads', async () => {
    const labels: PhysicalAttributeLabels = {
      Framing: ['Unframed'],
      Orientation: ['Portrait'],
      'Frame colour': [],
      'Home style': [],
      Occasion: [],
      Celebration: [],
      Room: [],
    };
    const current: EtsyListingProperty[] = [
      { property_id: 1, property_name: 'Framing', value_ids: [101], values: ['Framed'] },
      { property_id: 2, property_name: 'Orientation', value_ids: [201], values: ['Portrait'] },
      { property_id: 3, property_name: 'Frame colour', value_ids: [301], values: ['Black'] },
    ];
    const request = vi.fn()
      .mockResolvedValueOnce({ results: taxonomy })
      .mockResolvedValueOnce({ results: current })
      .mockResolvedValue({});

    await expect(syncEtsyPhysicalListingAttributes({
      variant: 'print',
      shopId: '66615491',
      listingId: '123',
      taxonomyId: 121,
      labels,
    }, request)).resolves.toEqual({ updates: 1, deletes: 1 });

    expect(request).toHaveBeenCalledWith(
      '/shops/66615491/listings/123/properties/3',
      { method: 'DELETE' },
    );
    const putCall = request.mock.calls.find(([, init]) => init.method === 'PUT');
    expect(putCall?.[0]).toBe('/shops/66615491/listings/123/properties/1');
    expect((putCall?.[1].body as URLSearchParams).get('value_ids')).toBe('102');
    expect((putCall?.[1].body as URLSearchParams).get('values')).toBe('Unframed');
  });
});
