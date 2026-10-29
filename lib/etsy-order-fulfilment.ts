import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEtsyOrderAccessToken } from '@/lib/etsy-oauth';
import { createEtsyReceiptShipment, EtsyShipmentError, getEtsyReceipt } from '@/lib/etsy-accounting-api';
import { retrievePrintShrimpOrder, type PrintShrimpOrder } from '@/lib/printshrimp/orders';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function json(value: unknown) { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
type Dispatch = { state: 'sending' | 'sent' | 'unknown' | 'rejected'; signature: string; attemptedAt: string };
type Metadata = { checkedAt?: string; error?: string | null; dispatch?: Dispatch };
function metadata(response: unknown): Metadata { return record(record(response)._appFulfilment) as Metadata; }

export function printShrimpFulfilmentDetails(response: unknown) {
  const order = record(record(response).order);
  const meta = metadata(response);
  return {
    printShrimpStatus: text(order.status) || null,
    printShrimpTracking: text(order.tracking) || null,
    printShrimpCourier: text(order.tracking_courier) || null,
    printShrimpLastCheckedAt: meta.checkedAt ?? null,
    printShrimpSyncError: meta.error ?? null,
  };
}

export function etsyCarrierName(courier: string) {
  const names: Record<string, string> = { royalmail: 'royal-mail', usps: 'usps', ups: 'ups', fedex: 'fedex', dpd: 'dpd', evri: 'evri', hermes: 'hermes' };
  return names[courier.toLocaleLowerCase().replace(/[^a-z]/g, '')] ?? 'other';
}

async function saveStatus(orderId: number, patch: Metadata, remote?: PrintShrimpOrder) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.etsyOrder.findUniqueOrThrow({ where: { id: orderId } });
    const response = {
      ...record(latest.printShrimpResponse),
      ...(remote ? { order: remote } : {}),
      _appFulfilment: { ...metadata(latest.printShrimpResponse), ...patch },
    };
    return tx.etsyOrder.update({ where: { id: orderId }, data: {
      printShrimpResponse: json(response),
      ...(remote?.order_id ? { printShrimpOrderId: remote.order_id } : {}),
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function claimDispatch(orderId: number, signature: string) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.etsyOrder.findUniqueOrThrow({ where: { id: orderId } });
    const meta = metadata(latest.printShrimpResponse);
    if (meta.dispatch?.state === 'sending' || meta.dispatch?.state === 'unknown') {
      return 'A previous Etsy dispatch update is pending or uncertain. Check Etsy before sending another notification.';
    }
    if (meta.dispatch?.state === 'sent' && meta.dispatch.signature === signature) {
      return 'Dispatch was already sent to Etsy; waiting for Etsy to confirm it.';
    }
    const dispatch: Dispatch = { state: 'sending', signature, attemptedAt: new Date().toISOString() };
    await tx.etsyOrder.update({ where: { id: orderId }, data: {
      printShrimpResponse: json({ ...record(latest.printShrimpResponse), _appFulfilment: { ...meta, dispatch } }),
    } });
    return null;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Checks existing orders only. No order creation, payment, cancellation or resend. */
export async function refreshPrintShrimpFulfilment(refreshEtsyOrder: (orderId: number) => Promise<unknown>) {
  const summary = { printShrimpRefreshed: 0, etsyDispatchesUpdated: 0, fulfilmentWarnings: [] as string[] };
  const orders = await prisma.etsyOrder.findMany({ where: { OR: [
    { printShrimpSubmittedAt: { not: null } }, { printShrimpOrderId: { not: null } },
  ] } });
  for (const order of orders) {
    let dispatch: Dispatch | undefined;
    try {
      const externalOrderNumber = text(record(order.printShrimpPayload).external_order_number) || `ETSY-${order.etsyReceiptId}`;
      const remote = await retrievePrintShrimpOrder({ orderId: order.printShrimpOrderId, externalOrderNumber });
      await saveStatus(order.id, { checkedAt: new Date().toISOString(), error: null }, remote);
      summary.printShrimpRefreshed += 1;
      // Only the provider's explicit Shipped status is evidence of dispatch.
      // Pending, Paid, In Production, Reshipping and unknown statuses never complete Etsy orders.
      if (remote.status?.trim().toLocaleLowerCase() !== 'shipped') continue;
      const readToken = await getEtsyOrderAccessToken(false);
      const receiptParams = { shopId: order.etsyShopId.toString(), receiptId: order.etsyReceiptId.toString() };
      const receipt = await getEtsyReceipt({ accessToken: readToken, ...receiptParams });
      if (receipt.is_canceled === true || receipt.was_canceled === true || /^cancel[el]+d$/i.test(text(receipt.status))) {
        await refreshEtsyOrder(order.id);
        throw new Error('PrintShrimp has shipped a canceled Etsy order. Review it with PrintShrimp; no Etsy dispatch notification was sent.');
      }
      const tracking = text(remote.tracking);
      const carrier = etsyCarrierName(text(remote.tracking_courier));
      const signature = JSON.stringify([remote.order_id, tracking, tracking ? carrier : '']);
      const shipments = Array.isArray(receipt.shipments) ? receipt.shipments.map(record) : [];
      const alreadyShipped = receipt.is_shipped === true || receipt.was_shipped === true || text(receipt.status).toLocaleLowerCase() === 'completed';
      const trackingIsCurrent = !tracking || shipments.some((shipment) => text(shipment.tracking_code) === tracking);
      if (alreadyShipped && trackingIsCurrent) {
        await saveStatus(order.id, { dispatch: { state: 'sent', signature, attemptedAt: new Date().toISOString() }, error: null });
        await refreshEtsyOrder(order.id);
        continue;
      }
      const writeToken = await getEtsyOrderAccessToken(true);
      const blocked = await claimDispatch(order.id, signature);
      if (blocked) throw new Error(blocked);
      dispatch = { state: 'sending', signature, attemptedAt: new Date().toISOString() };
      await createEtsyReceiptShipment({ accessToken: writeToken, ...receiptParams, trackingCode: tracking, carrierName: carrier });
      dispatch.state = 'sent';
      await saveStatus(order.id, { dispatch, error: null });
      summary.etsyDispatchesUpdated += 1;
      // The existing receipt importer changes the app to Completed only after Etsy confirms shipment.
      await refreshEtsyOrder(order.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh fulfilment status.';
      if (dispatch?.state === 'sending') {
        dispatch.state = error instanceof EtsyShipmentError && error.status !== null && error.status < 500 && error.status !== 408
          ? 'rejected' : 'unknown';
      }
      await saveStatus(order.id, { ...(dispatch ? { dispatch } : {}), error: message });
      summary.fulfilmentWarnings.push(`Etsy order ${order.etsyReceiptId}: ${message}`);
    }
  }
  return summary;
}
