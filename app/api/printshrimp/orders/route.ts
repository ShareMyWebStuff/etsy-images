import { NextResponse } from 'next/server';

import { PrintShrimpConfigurationError } from '@/lib/printshrimp/client';
import {
  retrievePrintShrimpOrders,
  PrintShrimpOrderSubmissionError,
  submitPrintShrimpOrder,
  type PrintShrimpOrderPreviewInput,
} from '@/lib/printshrimp/orders';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await retrievePrintShrimpOrders());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to retrieve PrintShrimp orders.';
    const upstreamStatus = Number(message.match(/PrintShrimp API returned (\d{3})/)?.[1] ?? 0);
    const status = error instanceof PrintShrimpConfigurationError
      ? 503
      : upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as PrintShrimpOrderPreviewInput;
    return NextResponse.json(await submitPrintShrimpOrder(input), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create the PrintShrimp order.';
    const upstreamStatus = Number(message.match(/PrintShrimp API returned (\d{3})/)?.[1] ?? 0);
    const status = error instanceof PrintShrimpConfigurationError
      ? 503
      : error instanceof PrintShrimpOrderSubmissionError && error.httpStatus
        ? error.httpStatus >= 400 && error.httpStatus < 500 ? error.httpStatus : 502
      : upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 502;
    if (error instanceof PrintShrimpOrderSubmissionError) {
      return NextResponse.json({
        error: message,
        custom: error.prepared.custom,
        folderUrl: error.prepared.folderUrl,
        artworkUrl: error.prepared.artworkUrl,
        fileName: error.prepared.fileName,
        payload: error.prepared.payload,
        response: error.response,
      }, { status });
    }
    return NextResponse.json({ error: message }, { status });
  }
}
