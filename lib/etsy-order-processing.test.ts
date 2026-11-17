import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), queue: vi.fn(), updateItem: vi.fn(), render: vi.fn(), stage: vi.fn(), submit: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyOrder: { findUnique: mocks.find, findMany: mocks.queue }, etsyOrderItem: { update: mocks.updateItem },
} }));
vi.mock('@/lib/printshrimp/orders', () => ({ generatePrintShrimpCustomArtworkPreview: mocks.render, submitPreparedPrintShrimpOrder: mocks.submit }));
vi.mock('@/lib/printshrimp/s3-staging', () => ({ stagePrintShrimpArtwork: mocks.stage }));
import { generateEtsyOrderArtwork, getEtsyOrderDetails, getEtsyOrdersForProcessing } from './etsy-orders';

function order(border = 'No', font: string | null = 'No Customisation', topText = '', bottomText = '', fontQuestion = 'Font Style') {
  return {
    id: 1, etsyShopId: 66615491n, etsyReceiptId: 1001n, name: 'Buyer Name',
    address1: '1 Main Road', city: 'London', postcode: 'SW1A 1AA', countryIso: 'GB', isPaid: true,
    etsyStatus: 'paid', processingStatus: 'UNPROCESSED', attempts: [], rawJson: {},
    items: [{ id: 10, etsyTransactionId: 100n, listingId: 12, sku: 'PRINT-1', title: 'Ant', quantity: 1,
      size: 'A4', productType: 'Print', fontId: 'nunito-semibold', topText, bottomText, artworkUrl: null,
      rawJson: { variations: [
        { formatted_name: 'Border', formatted_value: border },
        ...(font === null ? [] : [{ formatted_name: fontQuestion, formatted_value: font }]),
      ] },
    }],
  };
}
beforeEach(() => vi.resetAllMocks());

describe('Etsy order processing preparation', () => {
  it('loads every unattempted paid order newest first without the table pagination limit', async () => {
    mocks.queue.mockResolvedValue([{ id: 2, etsyReceiptId: 1002n, name: 'Newest', orderedAt: new Date('2026-10-27') }]);
    expect(await getEtsyOrdersForProcessing()).toMatchObject([{ id: '2', etsyReceiptId: '1002', name: 'Newest' }]);
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({
      where: { processingStatus: 'UNPROCESSED', isPaid: true, isShipped: false, isCanceled: false, attempts: { none: {} } },
      orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }],
    }));
    expect(mocks.queue.mock.calls[0][0]).not.toHaveProperty('take');
  });

  it.each(['No Customisation', 'None', 'Unknown font'])('blocks wording with an explicit unsupported font in details and artwork generation: %s', async (font) => {
    mocks.find.mockResolvedValue(order('No', font, 'Oliver'));
    const details = await getEtsyOrderDetails('1');
    expect(details.orderType).toBe('In Error');
    expect(details.canCreate).toBe(false);
    expect(details.missing.join(' ')).toContain('Message the buyer on Etsy');
    await expect(generateEtsyOrderArtwork('1')).rejects.toThrow('Message the buyer on Etsy');
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    { font: null, topText: 'Oliver', bottomText: '' },
    { font: '', topText: '', bottomText: 'Bedroom' },
    { font: '  ', topText: 'Oliver', bottomText: 'Bedroom' },
  ])('uses and displays Nunito for missing or blank fonts with wording: $font', async ({ font, topText, bottomText }) => {
    const current = order('No', font, topText, bottomText, 'Font Style (default: Nunito)');
    current.items[0].fontId = 'fredoka-bold';
    mocks.find.mockImplementation(async () => current);
    mocks.render.mockResolvedValue({ buffer: Buffer.from('artwork'), fileName: 'custom.jpg' });
    mocks.stage.mockResolvedValue('https://example.com/staged.jpg');
    mocks.updateItem.mockImplementation(async ({ data }) => Object.assign(current.items[0], data));

    const initial = await getEtsyOrderDetails('1');
    expect(initial.orderType).toBe('Customised');
    expect(initial.order.items[0]).toMatchObject({ fontStyle: 'Nunito', fontId: 'nunito-semibold', error: null });
    expect(initial.missing.join(' ')).not.toContain('Message the buyer');

    const result = await generateEtsyOrderArtwork('1');
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({
      fontId: 'nunito-semibold', topText, bottomText, borderEnabled: false,
    }));
    expect(result.details.canCreate).toBe(true);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('renders the selected font under the new label even when its persisted font differs', async () => {
    const current = order('No', 'Fredoka', 'Oliver', '', 'Font Style (default: Nunito)');
    mocks.find.mockImplementation(async () => current);
    mocks.render.mockResolvedValue({ buffer: Buffer.from('artwork'), fileName: 'custom.jpg' });
    mocks.stage.mockResolvedValue('https://example.com/staged.jpg');
    mocks.updateItem.mockImplementation(async ({ data }) => Object.assign(current.items[0], data));

    const result = await generateEtsyOrderArtwork('1');

    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ fontId: 'fredoka-bold' }));
    expect(result.details.order.items[0]).toMatchObject({ fontStyle: 'Fredoka', fontId: 'fredoka-bold' });
    expect(result.details.canCreate).toBe(true);
  });

  it('stages border-only artwork and uses that same URL in the PrintShrimp payload', async () => {
    const current = order('Yes');
    mocks.find.mockImplementation(async () => current);
    mocks.render.mockResolvedValue({ buffer: Buffer.from('artwork'), fileName: 'custom.jpg' });
    mocks.stage.mockResolvedValue('https://example.com/staged.jpg');
    mocks.updateItem.mockImplementation(async ({ data }) => Object.assign(current.items[0], data));
    const result = await generateEtsyOrderArtwork('1');
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ size: 'A4', borderEnabled: true, topText: '', bottomText: '' }));
    expect(result.details.canCreate).toBe(true);
    expect(result.details.payload.products).toEqual([expect.objectContaining({ size: 'A4', image: { artwork_url: 'https://example.com/staged.jpg' } })]);
    expect(result.details.payload.products[0]).not.toHaveProperty('sku');
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('keeps normal orders on the existing SKU submission path', async () => {
    mocks.find.mockResolvedValue(order());
    const result = await getEtsyOrderDetails('1');
    expect(result.orderType).toBe('Normal');
    expect(result.canCreate).toBe(true);
    expect(result.payload.products).toEqual([expect.objectContaining({ sku: 'PRINT-1', size: 'A4' })]);
  });

  it('keeps a selected font with blank wording on the normal SKU path', async () => {
    mocks.find.mockResolvedValue(order('No', 'Fredoka', '', '', 'Font Style (default: Nunito)'));

    const result = await getEtsyOrderDetails('1');

    expect(result.orderType).toBe('Normal');
    expect(result.canCreate).toBe(true);
    expect(result.payload.products).toEqual([expect.objectContaining({ sku: 'PRINT-1', size: 'A4' })]);
    await expect(generateEtsyOrderArtwork('1')).rejects.toThrow('no customised items');
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it('never regenerates artwork after an order has been attempted', async () => {
    mocks.find.mockResolvedValue({ ...order('Yes'), attempts: [{ id: 1 }] });
    await expect(generateEtsyOrderArtwork('1')).rejects.toThrow('no longer available');
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
