import { recordQuery } from '../../../lib/admin-queue-rules';
import { z } from 'zod';
import { db } from '../../../lib/db';
import { requireUser, apiError } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { actOnSettlement } from '../../../lib/settlement';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const id = await requireUser();
    const query = recordQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    if (user.suspendedAt) throw new Error('FORBIDDEN');
    const admin = user.role === 'ADMIN';
    const rows = await db.settlement.findMany({
      where: {
        ...(query.id ? { id: query.id } : {}),
        ...(admin ? {} : { OR: [{ vehicle: { userId: id } }, { bid: { userId: id } }] }),
      },
      include: {
        _count: {
          select: { disputes: { where: { status: { in: ['OPEN', 'ACTION_REQUIRED'] } } } },
        },
        vehicle: { select: { id: true, make: true, model: true, userId: true } },
        bid: {
          select: {
            id: true,
            userId: true,
            amount: true,
            hold: { select: { status: true, expiresAt: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.id ? 1 : admin ? 20 : 100,
      skip: query.id ? 0 : (query.page - 1) * (admin ? 20 : 100),
    });
    return Response.json(
      {
        settlements: rows.map((s) => ({
          id: s.id,
          vehicleId: s.vehicleId,
          vehicle: `${s.vehicle.make} ${s.vehicle.model}`,
          bidId: s.bidId,
          amount: Number(s.bid.amount),
          status: s.status,
          openDisputes: s._count.disputes,
          outcome: s.outcome,
          hold: s.bid.hold,
          seller: s.vehicle.userId === id,
          buyer: s.bid.userId === id,
          canReview: admin && s.vehicle.userId !== id && s.bid.userId !== id,
          audit: undefined,
        })),
        ...(admin
          ? {
              audits: await db.outboxEvent.findMany({
                where: {
                  kind: 'settlement.action',
                  ...(query.id ? { payload: { path: ['settlementId'], equals: query.id } } : {}),
                },
                select: { id: true, payload: true, createdAt: true },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 100,
              }),
            }
          : {}),
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
    const userId = await requireUser();
    const input = z
      .object({
        id: z.uuid(),
        action: z.enum([
          'confirm',
          'report_default',
          'approve_default',
          'dismiss_default',
          'cancel',
          'retry',
        ]),
        note: z.string().trim().min(10).max(2000),
      })
      .strict()
      .parse(await request.json());
    await actOnSettlement(userId, input.id, input.action, input.note);
    return Response.json({ ok: true });
  } catch (e) {
    if (
      e instanceof Error &&
      ['CONFLICT', 'HOLD_RENEWAL_REQUIRED', 'DISPUTE_OPEN'].includes(e.message)
    )
      return Response.json({ error: e.message }, { status: 409 });
    return apiError(e);
  }
}
