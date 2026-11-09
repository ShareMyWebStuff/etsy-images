import { NextResponse } from 'next/server';
import { getListingMarketsDelivery, saveListingMarketsDelivery } from '@/lib/markets-delivery';
import { deliveryHttpError, deliveryListingContext, deliveryMutationBody } from '@/lib/markets-delivery-http';

export async function GET(request: Request) {
  try {
    const context = deliveryListingContext(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json({ data: await getListingMarketsDelivery(context) });
  } catch (error) { return deliveryHttpError(error); }
}
export async function PUT(request: Request) {
  try {
    const body = await deliveryMutationBody(request);
    const context = deliveryListingContext(body);
    return NextResponse.json({ data: await saveListingMarketsDelivery(context, body.settings, { confirmDescriptionOverwrite: body.confirmDescriptionOverwrite === true }) });
  } catch (error) { return deliveryHttpError(error); }
}
