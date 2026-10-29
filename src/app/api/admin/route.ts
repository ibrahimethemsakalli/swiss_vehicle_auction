import { adminQueueHandlers } from '../../../lib/admin-queue-http';
import { reviewListing } from '../../../lib/listing-review';
import { z } from 'zod';
import { publicValidation } from '../../../lib/validation-errors';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
export const dynamic = 'force-dynamic';
async function adminUser() {
  const id = await requireUser();
  const user = await db.user.findUnique({ where: { id } });
  if (!user || user.role !== 'ADMIN' || user.suspendedAt) throw new Error('FORBIDDEN');
  return id;
}
export const GET = adminQueueHandlers(db, requireUser).GET;
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const adminId = await adminUser();
    await reviewListing(db, adminId, await request.json());
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error: 'REVIEW_REJECTED',
        ...(error instanceof z.ZodError ? { validation: publicValidation(error) } : {}),
      },
      {
        status:
          error instanceof Error && error.message === 'UNAUTHORIZED'
            ? 401
            : error instanceof Error && error.message === 'FORBIDDEN'
              ? 403
              : 400,
      },
    );
  }
}
