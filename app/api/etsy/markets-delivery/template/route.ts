import { NextResponse } from 'next/server';
import { getTemplateMarketsDelivery, saveTemplateMarketsDelivery } from '@/lib/markets-delivery';
import { deliveryHttpError, deliveryMutationBody, deliveryParameter } from '@/lib/markets-delivery-http';

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    return NextResponse.json({ data: await getTemplateMarketsDelivery(deliveryParameter(query.get('templateId'), 'template'), deliveryParameter(query.get('shopId'), 'shop')) });
  } catch (error) { return deliveryHttpError(error); }
}
export async function PUT(request: Request) {
  try {
    const body = await deliveryMutationBody(request);
    return NextResponse.json({ data: await saveTemplateMarketsDelivery(deliveryParameter(body.templateId, 'template'), body.settings, deliveryParameter(body.shopId, 'shop')) });
  } catch (error) { return deliveryHttpError(error); }
}
