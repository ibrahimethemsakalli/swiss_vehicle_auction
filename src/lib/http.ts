import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
export async function requireUser() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) throw new Error('UNAUTHORIZED');
  return id;
}
export function apiError(error: unknown) {
  if (
    error instanceof Error &&
    ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'FORBIDDEN', 'VERIFICATION_REQUIRED'].includes(
      error.message,
    )
  )
    return Response.json(
      { error: error.message },
      {
        status:
          error.message === 'RATE_LIMITED'
            ? 429
            : error.message === 'PROVIDER_UNAVAILABLE'
              ? 503
              : 403,
      },
    );
  if (error instanceof Error && error.message === 'UNAUTHORIZED')
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  // Do not leak database errors, document data, or internal identifiers.
  return Response.json({ error: 'REQUEST_REJECTED' }, { status: 400 });
}
