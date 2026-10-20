import { NextResponse } from 'next/server';

import {
  createManagedEtsyCategory,
  deleteManagedEtsyCategory,
  updateManagedEtsyCategory,
} from '@/lib/local-shop-sections';
import type { EtsySectionUsage } from '@/lib/local-shop-sections';

type EtsyCategoryRequest = {
  shopId?: string;
  categoryId?: string;
  title?: string;
  usages?: EtsySectionUsage[];
};

function validForm(body: EtsyCategoryRequest): body is EtsyCategoryRequest & {
  shopId: string;
  title: string;
  usages: EtsySectionUsage[];
} {
  return typeof body.shopId === 'string'
    && typeof body.title === 'string'
    && Array.isArray(body.usages);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as EtsyCategoryRequest;
    if (!validForm(body)) return NextResponse.json({ error: 'Enter the Etsy category details.' }, { status: 400 });
    return NextResponse.json({ data: await createManagedEtsyCategory(body.shopId, body.title, body.usages) });
  } catch (error) {
    console.error('Failed to create an Etsy category:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create the Etsy category.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as EtsyCategoryRequest;
    if (!validForm(body) || typeof body.categoryId !== 'string') {
      return NextResponse.json({ error: 'Enter the Etsy category details.' }, { status: 400 });
    }
    return NextResponse.json({
      data: await updateManagedEtsyCategory(body.shopId, body.categoryId, body.title, body.usages),
    });
  } catch (error) {
    console.error('Failed to update an Etsy category:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update the Etsy category.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as EtsyCategoryRequest;
    if (typeof body.shopId !== 'string' || typeof body.categoryId !== 'string') {
      return NextResponse.json({ error: 'Choose an Etsy category to delete.' }, { status: 400 });
    }
    return NextResponse.json({ data: await deleteManagedEtsyCategory(body.shopId, body.categoryId) });
  } catch (error) {
    console.error('Failed to delete an Etsy category:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete the Etsy category.' }, { status: 500 });
  }
}
