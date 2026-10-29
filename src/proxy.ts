import { NextRequest, NextResponse } from 'next/server';
import { indexingEnabled, publicSeoPath, seoLocale } from './lib/seo';

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const languages = request.nextUrl.searchParams.getAll('lang');
  headers.set('x-autoveri-locale', seoLocale(languages.length === 1 ? languages[0] : undefined));
  const response = NextResponse.next({ request: { headers } });
  if (!indexingEnabled() || !publicSeoPath(request.nextUrl.pathname))
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
