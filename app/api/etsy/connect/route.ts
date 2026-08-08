import { NextResponse } from 'next/server';
import { createPkcePair, createState, getEtsyAuthorizationUrl, getRedirectUri } from '@/lib/etsy-oauth';

export async function GET(request: Request) {
  try {
    const state = createState();
    const { verifier, challenge } = createPkcePair();
    const response = NextResponse.redirect(
      getEtsyAuthorizationUrl({
        request,
        state,
        codeChallenge: challenge,
      })
    );

    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: false,
      path: '/',
      maxAge: 10 * 60,
    };

    response.cookies.set('etsy_oauth_state', state, cookieOptions);
    response.cookies.set('etsy_code_verifier', verifier, cookieOptions);
    response.cookies.set('etsy_redirect_uri', getRedirectUri(request), cookieOptions);

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start Etsy OAuth.' },
      { status: 500 }
    );
  }
}
