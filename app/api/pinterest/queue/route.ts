import { NextResponse } from 'next/server'; import { processDuePins } from '@/lib/pinterest/pins';
function authorized(request: Request) { const secret = process.env.PINTEREST_CRON_SECRET; if (!secret) return false; const url = new URL(request.url); return request.headers.get('authorization') === `Bearer ${secret}` || url.searchParams.get('secret') === secret; }
export async function POST(request: Request) { if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); return NextResponse.json({ data: await processDuePins() }); }
export async function GET(request: Request) { return POST(request); }
