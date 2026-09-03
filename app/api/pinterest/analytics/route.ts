import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { pinterestRequest } from '@/lib/pinterest/client';

const METRICS = 'IMPRESSION,PIN_CLICK,OUTBOUND_CLICK,SAVE';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const end = url.searchParams.get('end') ? new Date(url.searchParams.get('end')!) : new Date();
  const start = url.searchParams.get('start') ? new Date(url.searchParams.get('start')!) : new Date(end.getTime() - 29 * 86400000);
  const cached = !url.searchParams.has('refresh') && await prisma.pinterestAnalyticsSnapshot.findFirst({ where: { rangeStart: start, rangeEnd: end, fetchedAt: { gte: new Date(Date.now() - 6 * 3600000) } }, orderBy: { fetchedAt: 'desc' } });
  if (cached) return NextResponse.json({ data: cached, cached: true });
  try {
    const query = new URLSearchParams({ start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), metric_types: METRICS, granularity: 'DAY' });
    const account = await pinterestRequest<unknown>(`/user_account/analytics?${query}`);
    const pins = await pinterestRequest<unknown>(`/user_account/analytics/top_pins?${query}&sort_by=IMPRESSION&num_of_pins=25`);
    const saved = await prisma.pinterestAnalyticsSnapshot.create({ data: { rangeStart: start, rangeEnd: end, accountMetrics: JSON.parse(JSON.stringify(account)), pinMetrics: JSON.parse(JSON.stringify(pins)) } });
    return NextResponse.json({ data: saved, cached: false });
  } catch (error) {
    const fallback = await prisma.pinterestAnalyticsSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } });
    if (fallback) return NextResponse.json({ data: fallback, cached: true, warning: error instanceof Error ? error.message : 'Refresh failed.' });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Analytics unavailable.' }, { status: 502 });
  }
}
