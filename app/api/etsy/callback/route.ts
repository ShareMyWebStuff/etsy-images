import { NextResponse } from 'next/server';
import { exchangeAuthorizationCode } from '@/lib/etsy-oauth';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const cookies = request.headers.get('cookie') ?? '';
  const cookieMap = new Map(
    cookies
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separatorIndex = cookie.indexOf('=');
        return [cookie.slice(0, separatorIndex), decodeURIComponent(cookie.slice(separatorIndex + 1))];
      })
  );

  if (error) {
    return NextResponse.json({ error, errorDescription }, { status: 400 });
  }

  if (!code || !returnedState) {
    return NextResponse.json({ error: 'Missing Etsy OAuth code or state.' }, { status: 400 });
  }

  const expectedState = cookieMap.get('etsy_oauth_state');
  const codeVerifier = cookieMap.get('etsy_code_verifier');
  const redirectUri = cookieMap.get('etsy_redirect_uri');

  if (!expectedState || expectedState !== returnedState) {
    return NextResponse.json({ error: 'Invalid Etsy OAuth state. Please try connecting Etsy again.' }, { status: 400 });
  }

  if (!codeVerifier || !redirectUri) {
    return NextResponse.json({ error: 'Missing Etsy OAuth verifier. Please try connecting Etsy again.' }, { status: 400 });
  }

  try {
    await exchangeAuthorizationCode({
      code,
      codeVerifier,
      redirectUri,
    });

    const response = NextResponse.redirect(new URL('/sync-to-etsy?etsy=connected', request.url));
    response.cookies.delete('etsy_oauth_state');
    response.cookies.delete('etsy_code_verifier');
    response.cookies.delete('etsy_redirect_uri');

    return response;
  } catch (caughtError) {
    return NextResponse.json(
      { error: caughtError instanceof Error ? caughtError.message : 'Unable to finish Etsy OAuth.' },
      { status: 500 }
    );
  }
}
