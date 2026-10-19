import { getToken } from 'next-auth/jwt';
import type { IncomingHttpHeaders } from 'node:http';
export function socketOriginAllowed(headers: IncomingHttpHeaders, allowed: string) {
  let origin = headers.origin;
  if (!origin && headers.referer) {
    try {
      origin = new URL(headers.referer).origin;
    } catch {}
  }
  return origin === allowed;
}
export function socketToken(
  headers: IncomingHttpHeaders,
  origin: string,
  secret: string | undefined,
) {
  // Socket.IO receives a raw IncomingMessage, not a Next.js request with parsed cookies.
  const cookies: Record<string, string> = {};
  for (const part of (headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {}
  }
  return getToken({
    req: { headers, cookies } as never,
    secret,
    secureCookie: origin.startsWith('https:'),
  });
}
