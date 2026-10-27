import { describe, expect, it, vi } from 'vitest';
import { parseGeneratedListingDetails } from '@/lib/combined-listing-details-prompt';
import { parseGeneratedMultipleListingDetails } from '@/lib/multiple-listing-details-prompt';
import {
  GeneratedEtsyTagLengthError,
  generateValidatedListingResponse,
  validateGeneratedEtsyTagLengths,
} from '@/lib/generated-etsy-tags';

function listingResponse(tags: string[], multiple = false) {
  const marker = multiple ? 'ETSY_MULTIPLE_LISTING_DATA' : 'ETSY_LISTING_DATA';
  return `<${marker}>${JSON.stringify({
    printTitle: 'Blue Morpho Butterfly Print', printDescription: 'Physical print description',
    digitalTitle: 'Blue Morpho Butterfly Printable', digitalDescription: 'Digital download description',
    tags, primaryColour: 'blue', secondaryColour: 'black',
  })}</${marker}>`;
}

describe('generated Etsy tag validation', () => {
  it('accepts exactly 20 characters and rejects the 21-character phrase from the failed batch', () => {
    expect(() => validateGeneratedEtsyTagLengths(['blue butterfly print'])).not.toThrow();
    expect(() => validateGeneratedEtsyTagLengths(['blue morpho butterfly'])).toThrow(GeneratedEtsyTagLengthError);
    expect(() => validateGeneratedEtsyTagLengths(['blue morpho butterfly'])).toThrow('21, including spaces');
  });

  it('counts Unicode characters rather than UTF-16 code units', () => {
    expect(() => validateGeneratedEtsyTagLengths(['𐐀'.repeat(20)])).not.toThrow();
    expect(() => validateGeneratedEtsyTagLengths(['𐐀'.repeat(21)])).toThrow(GeneratedEtsyTagLengthError);
  });
});

describe('automatic tag-length correction', () => {
  it('returns a valid first response without another model request', async () => {
    const send = vi.fn().mockResolvedValue(listingResponse(['butterfly art']));
    const result = await generateValidatedListingResponse('Original prompt', send, parseGeneratedListingDetails);
    expect(result.tags).toEqual(['butterfly art']);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries the failed butterfly tag with its actual length and accepts only the validated correction', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(listingResponse(['blue morpho butterfly']))
      .mockResolvedValueOnce(listingResponse(['blue morpho', 'butterfly art']));
    const result = await generateValidatedListingResponse('Original prompt', send, parseGeneratedListingDetails);
    expect(result.tags).toEqual(['blue morpho', 'butterfly art']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toContain('Original prompt');
    expect(send.mock.calls[1][0]).toContain('"blue morpho butterfly": 21 characters');
    expect(send.mock.calls[1][0]).toContain('including spaces');
  });

  it('also corrects grouped listing tags while retaining strict grouped validation', async () => {
    const otherTags = Array.from({ length: 12 }, (_, index) => `butterfly tag ${index + 1}`);
    const send = vi.fn()
      .mockResolvedValueOnce(listingResponse(['blue morpho butterfly', ...otherTags], true))
      .mockResolvedValueOnce(listingResponse(['blue morpho', ...otherTags], true));
    const result = await generateValidatedListingResponse('Group prompt', send, parseGeneratedMultipleListingDetails);
    expect(result.tags).toHaveLength(13);
    expect(result.tags[0]).toBe('blue morpho');
    expect(result.primaryColour).toBe('blue');
  });

  it('stops after one correction attempt if the model still returns an overlong tag', async () => {
    const send = vi.fn().mockResolvedValue(listingResponse(['blue morpho butterfly']));
    await expect(generateValidatedListingResponse('Prompt', send, parseGeneratedListingDetails)).rejects.toThrow(GeneratedEtsyTagLengthError);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry malformed listing data or network failures', async () => {
    const send = vi.fn().mockResolvedValue('<ETSY_LISTING_DATA>invalid JSON</ETSY_LISTING_DATA>');
    await expect(generateValidatedListingResponse('Prompt', send, parseGeneratedListingDetails)).rejects.toThrow('not valid JSON');
    expect(send).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn().mockRejectedValue(new Error('AWS unavailable'));
    await expect(generateValidatedListingResponse('Prompt', unavailable, parseGeneratedListingDetails)).rejects.toThrow('AWS unavailable');
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
});
