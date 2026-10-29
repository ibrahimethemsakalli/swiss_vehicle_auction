import { recordQuery } from '../../../lib/admin-queue-rules';
import { requireUser, apiError } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { db } from '../../../lib/db';
import { openDispute, reviewDispute } from '../../../lib/disputes';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const id = await requireUser();
    const query = recordQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    if (user.suspendedAt) throw new Error('FORBIDDEN');
    const disputes = await db.dispute.findMany({
      where: {
        ...(query.id ? { id: query.id } : {}),
        ...(user.role === 'ADMIN'
          ? {}
          : { settlement: { OR: [{ vehicle: { userId: id } }, { bid: { userId: id } }] } }),
      },
      include: {
        settlement: {
          select: {
            vehicle: { select: { make: true, model: true, userId: true } },
            bid: { select: { userId: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.id ? 1 : user.role === 'ADMIN' ? 20 : 100,
      skip: query.id ? 0 : (query.page - 1) * (user.role === 'ADMIN' ? 20 : 100),
    });
    return Response.json(
      {
        disputes: disputes.map((d) => ({
          id: d.id,
          category: d.category,
          message: d.message,
          status: d.status,
          resolution: d.resolution,
          resolutionNote: d.resolutionNote,
          createdAt: d.createdAt,
          vehicle: `${d.settlement.vehicle.make} ${d.settlement.vehicle.model}`,
          canReview:
            user.role === 'ADMIN' &&
            ![d.settlement.vehicle.userId, d.settlement.bid.userId].includes(id),
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
    return Response.json(await openDispute(await requireUser(), await request.json()), {
      status: 201,
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    await reviewDispute(await requireUser(), await request.json());
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
