import { z } from 'zod';
import { db } from '../../../lib/db';
import { requireUser, apiError } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { makeOffer, decideOffer } from '../../../lib/offers';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const userId = await requireUser();
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.suspendedAt) throw new Error('FORBIDDEN');
    const offers = await db.bid.findMany({
      where: { offerExpiresAt: { not: null }, OR: [{ userId }, { vehicle: { userId } }] },
      include: { vehicle: { select: { id: true, make: true, model: true, userId: true } } },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
    return Response.json(
      {
        offers: offers.map((o) => ({
          id: o.id,
          vehicleId: o.vehicleId,
          vehicle: `${o.vehicle.make} ${o.vehicle.model}`,
          amount: Number(o.amount),
          status: o.status,
          expiresAt: o.offerExpiresAt,
          seller: o.vehicle.userId === userId,
        })),
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
    return Response.json(await makeOffer(await requireUser(), await request.json()), {
      status: 201,
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const userId = await requireUser();
    const input = z
      .object({ id: z.uuid(), action: z.enum(['accept', 'reject', 'withdraw']) })
      .strict()
      .parse(await request.json());
    await decideOffer(userId, input.id, input.action);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
