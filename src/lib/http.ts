import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { LegalError } from './legal-policy';
import { z } from 'zod';
import { publicValidation } from './validation-errors';
export async function requireUser() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) throw new Error('UNAUTHORIZED');
  return id;
}
export function apiError(error: unknown) {
  if (error instanceof z.ZodError)
    return Response.json(
      { error: 'REQUEST_REJECTED', validation: publicValidation(error) },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  if (error instanceof LegalError)
    return Response.json({ error: error.code }, { status: error.status });
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
