import { describe, expect, it } from 'vitest';
import {
  composeDeliveryDescription, composeManagedDeliveryDescription, MANAGED_DELIVERY_START,
  MAX_ETSY_DESCRIPTION_LENGTH, renderManagedDeliveryDescription, stripManagedDeliverySection,
  validateEtsyDescription,
} from './delivery-description';

describe('delivery description composition', () => {
  const base = 'Artwork details\n\nDelivery\nA manually written delivery paragraph.\n  Formatting stays.\n';

  it('preserves base formatting and sends a plain clearly labelled section without internal markers', () => {
    expect(composeDeliveryDescription(base, 'Dispatched after production.\nContact the shop with questions.', true))
      .toBe(`${base}\n\nDelivery\nDispatched after production.\nContact the shop with questions.`);
    expect(composeDeliveryDescription(base, 'Customer information', true)).not.toContain('<!--');
  });

  it('replaces exactly its owned section during repeated composition', () => {
    const first = composeManagedDeliveryDescription(base, 'First wording', true);
    const second = composeManagedDeliveryDescription(first, 'Updated wording', true);
    expect(stripManagedDeliverySection(second)).toBe(base);
    expect(renderManagedDeliveryDescription(second)).toBe(`${base}\n\nDelivery\nUpdated wording`);
    expect(second.split(MANAGED_DELIVERY_START)).toHaveLength(2);
  });

  it('disabling removes only its managed section and preserves manually written Delivery text', () => {
    const managed = composeManagedDeliveryDescription(base, 'App wording', true);
    expect(composeDeliveryDescription(managed, '', false)).toBe(base);
    expect(composeDeliveryDescription(base, 'Ignored', false)).toBe(base);
    expect(composeDeliveryDescription(base, '   ', true)).toBe(base);
  });

  it('preserves incomplete markers instead of removing uncertain content', () => {
    const incomplete = `${base}${MANAGED_DELIVERY_START}Some unfinished text`;
    expect(stripManagedDeliverySection(incomplete)).toBe(incomplete);
    expect(composeDeliveryDescription(incomplete, '', false)).toBe(incomplete);
  });

  it('is deterministic across syncs which always use the separately stored base', () => {
    const first = composeDeliveryDescription(base, 'Profile wording', true);
    expect(composeDeliveryDescription(base, 'Profile wording', true)).toBe(first);
    expect(base).toContain('A manually written delivery paragraph.');
  });

  it('validates the complete composed description, including wording and heading', () => {
    const atLimit = composeDeliveryDescription('x'.repeat(MAX_ETSY_DESCRIPTION_LENGTH - 13), 'ok', true);
    expect(() => validateEtsyDescription(atLimit)).not.toThrow();
    expect(() => validateEtsyDescription(`${atLimit}!`)).toThrow('complete description');
    expect(() => validateEtsyDescription('😀'.repeat(MAX_ETSY_DESCRIPTION_LENGTH))).not.toThrow();
  });
});
