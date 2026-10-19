export function assertSameOrigin(request: Request) {
  const allowed = new URL(process.env.NEXTAUTH_URL ?? request.url).origin;
  if (request.headers.get('origin') !== allowed) throw new Error('FORBIDDEN');
}
