import { NextResponse } from 'next/server';
import { openChatGptSignInBrowser } from '@/lib/chatgpt-thumbnail-automation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await openChatGptSignInBrowser();
    return NextResponse.json({
      message: 'A normal browser has opened. Sign in to ChatGPT, then close that browser before generating the thumbnail.',
    });
  } catch (error) {
    console.error('Failed to open the ChatGPT sign-in browser:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to open the ChatGPT sign-in browser.' },
      { status: 500 },
    );
  }
}
