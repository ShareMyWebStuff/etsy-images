import { NextResponse } from 'next/server';
import { getMarketsDeliveryMetadata } from '@/lib/markets-delivery';
import { deliveryHttpError, deliveryParameter } from '@/lib/markets-delivery-http';

export async function GET(request: Request) {
  try {
    const shopId = deliveryParameter(new URL(request.url).searchParams.get('shopId'), 'shop');
    return NextResponse.json(await getMarketsDeliveryMetadata(shopId));
  } catch (error) { return deliveryHttpError(error); }
}
