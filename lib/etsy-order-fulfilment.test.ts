import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), find: vi.fn(), update: vi.fn(), transaction: vi.fn(), remote: vi.fn(), receipt: vi.fn(), ship: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyOrder: { findMany: mocks.list, findUniqueOrThrow: mocks.find, update: mocks.update }, $transaction: mocks.transaction,
} }));
vi.mock('@/lib/etsy-oauth', () => ({ getEtsyOrderAccessToken: async () => 'token' }));
vi.mock('@/lib/printshrimp/orders', () => ({ retrievePrintShrimpOrder: mocks.remote }));
vi.mock('@/lib/etsy-accounting-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/etsy-accounting-api')>(),
  getEtsyReceipt: mocks.receipt, createEtsyReceiptShipment: mocks.ship,
}));
import { refreshPrintShrimpFulfilment, printShrimpFulfilmentDetails } from './etsy-order-fulfilment';
import { EtsyShipmentError } from './etsy-accounting-api';

let stored: {
  id: number; etsyShopId: bigint; etsyReceiptId: bigint; printShrimpOrderId: string;
  printShrimpPayload: unknown; printShrimpResponse: unknown; processingStatus: string;
};
beforeEach(() => {
  vi.resetAllMocks();
  stored = { id: 6, etsyShopId: 1n, etsyReceiptId: 123n, printShrimpOrderId: 'ps-1',
    printShrimpPayload: { external_order_number: 'ETSY-123' }, printShrimpResponse: { order: { status: 'Pending' } }, processingStatus: 'SUBMITTED' };
  mocks.list.mockImplementation(async () => [stored]);
  mocks.find.mockImplementation(async () => stored);
  mocks.update.mockImplementation(async ({ data }) => { stored = { ...stored, ...data }; return stored; });
  mocks.transaction.mockImplementation(async (operation) => operation({ etsyOrder: { findUniqueOrThrow: mocks.find, update: mocks.update } }));
  mocks.remote.mockResolvedValue({ order_id: 'ps-1', external_order_number: 'ETSY-123', status: 'Shipped', tracking: 'AB123GB', tracking_courier: 'Royal Mail' });
  mocks.receipt.mockResolvedValue({ receipt_id: 123, status: 'paid', is_shipped: false, shipments: [] });
});

describe('PrintShrimp fulfilment refresh', () => {
  it.each(['Pending', 'Paid', 'In Production', 'Reshipping', 'Unexpected'])('refreshes %s without marking the Etsy order dispatched', async (status) => {
    mocks.remote.mockResolvedValue({ order_id: 'ps-1', status, tracking: 'AB123GB' });
    const refresh = vi.fn();
    const summary = await refreshPrintShrimpFulfilment(refresh);
    expect(summary.printShrimpRefreshed).toBe(1);
    expect(printShrimpFulfilmentDetails(stored.printShrimpResponse).printShrimpStatus).toBe(status);
    expect(stored.processingStatus).toBe('SUBMITTED');
    expect(mocks.ship).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('submits confirmed dispatch and tracking, then verifies Etsy before recording completion', async () => {
    const refresh = vi.fn(async () => { stored.processingStatus = 'COMPLETED'; });
    const summary = await refreshPrintShrimpFulfilment(refresh);
    expect(mocks.remote).toHaveBeenCalledWith({ orderId: 'ps-1', externalOrderNumber: 'ETSY-123' });
    expect(mocks.ship).toHaveBeenCalledWith({ accessToken: 'token', shopId: '1', receiptId: '123', trackingCode: 'AB123GB', carrierName: 'royal-mail' });
    expect(refresh).toHaveBeenCalledWith(6);
    expect(summary.etsyDispatchesUpdated).toBe(1);
    expect(stored.processingStatus).toBe('COMPLETED');
    expect(printShrimpFulfilmentDetails(stored.printShrimpResponse)).toMatchObject({ printShrimpTracking: 'AB123GB', printShrimpCourier: 'Royal Mail', printShrimpSyncError: null });
  });

  it('does not notify the buyer again when Etsy already has the shipment', async () => {
    mocks.receipt.mockResolvedValue({ is_shipped: true, shipments: [{ tracking_code: 'AB123GB' }] });
    const refresh = vi.fn();
    await refreshPrintShrimpFulfilment(refresh);
    await refreshPrintShrimpFulfilment(refresh);
    expect(mocks.ship).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('records permission failures without pretending the Etsy order is complete', async () => {
    mocks.ship.mockRejectedValue(new EtsyShipmentError('Etsy rejected dispatch: 403', 403));
    const refresh = vi.fn();
    const summary = await refreshPrintShrimpFulfilment(refresh);
    expect(summary.fulfilmentWarnings[0]).toContain('403');
    expect(stored.processingStatus).toBe('SUBMITTED');
    expect(refresh).not.toHaveBeenCalled();
    expect(printShrimpFulfilmentDetails(stored.printShrimpResponse).printShrimpSyncError).toContain('403');
  });

  it('does not repeat a notification after an uncertain timeout; reconciles it when Etsy confirms', async () => {
    mocks.ship.mockRejectedValueOnce(new EtsyShipmentError('Timeout: outcome uncertain', null));
    const refresh = vi.fn();
    await refreshPrintShrimpFulfilment(refresh);
    await refreshPrintShrimpFulfilment(refresh);
    expect(mocks.ship).toHaveBeenCalledTimes(1);
    mocks.receipt.mockResolvedValue({ is_shipped: true, shipments: [{ tracking_code: 'AB123GB' }] });
    await refreshPrintShrimpFulfilment(refresh);
    expect(mocks.ship).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledOnce();
    expect(printShrimpFulfilmentDetails(stored.printShrimpResponse).printShrimpSyncError).toBeNull();
  });

  it('keeps checking confirmation without repeating a dispatch already accepted by Etsy', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('Etsy receipt temporarily unavailable'));
    await refreshPrintShrimpFulfilment(refresh);
    await refreshPrintShrimpFulfilment(refresh);
    expect(mocks.ship).toHaveBeenCalledTimes(1);
  });

  it('does not mark a canceled Etsy order as dispatched', async () => {
    mocks.receipt.mockResolvedValue({ status: 'Canceled', is_canceled: true });
    const summary = await refreshPrintShrimpFulfilment(vi.fn());
    expect(mocks.ship).not.toHaveBeenCalled();
    expect(summary.fulfilmentWarnings[0]).toContain('canceled Etsy order');
  });

  it('shows provider errors without changing the last confirmed PrintShrimp status', async () => {
    mocks.remote.mockRejectedValue(new Error('PrintShrimp temporarily unavailable'));
    const summary = await refreshPrintShrimpFulfilment(vi.fn());
    expect(summary.printShrimpRefreshed).toBe(0);
    expect(printShrimpFulfilmentDetails(stored.printShrimpResponse)).toMatchObject({ printShrimpStatus: 'Pending', printShrimpSyncError: 'PrintShrimp temporarily unavailable' });
    expect(mocks.ship).not.toHaveBeenCalled();
  });
});
