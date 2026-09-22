import { NextResponse } from 'next/server';

import { createManualFinancialEntry, getAccountsData } from '@/lib/accounts';

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    return NextResponse.json({
      data: await getAccountsData({
        view: search.get('view'),
        month: search.get('month'),
        type: search.get('type'),
        source: search.get('source'),
        category: search.get('category'),
        page: search.get('page'),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load accounts data.';
    const status = /invalid|must|month|page|filter|too long/i.test(message) ? 400 : 500;
    console.error('Failed to load accounts data:', error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const entry = await createManualFinancialEntry(body);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save the manual entry.';
    const status = /date|type|amount|currency|category|description|required|positive/i.test(message) ? 400 : 500;
    console.error('Failed to save manual account entry:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
