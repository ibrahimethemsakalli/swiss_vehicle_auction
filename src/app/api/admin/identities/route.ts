import { z } from 'zod';
import { db } from '../../../../lib/db';
import { requireUser, apiError } from '../../../../lib/http';
import { assertSameOrigin } from '../../../../lib/mutation';
import { approveIdentity } from '../../../../lib/identity';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const id = await requireUser();
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    if (user.role !== 'ADMIN' || user.suspendedAt) throw new Error('FORBIDDEN');
    return Response.json(
      {
        users: await db.user.findMany({
          where: { phoneVerifiedAt: { not: null }, isIdentityVerified: false, suspendedAt: null },
          select: { id: true, email: true, role: true, companyName: true, handelsregisterNr: true },
          take: 100,
          orderBy: { createdAt: 'asc' },
        }),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const id = await requireUser();
    const input = z
      .object({ userId: z.string().uuid(), evidenceReference: z.string().trim().min(10).max(500) })
      .strict()
      .parse(await request.json());
    await approveIdentity(id, input.userId, input.evidenceReference);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
