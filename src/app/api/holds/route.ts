import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const userId = await requireUser();
    const vehicleId = new URL(request.url).searchParams.get('vehicleId');
    if (!vehicleId) return Response.json({ holds: [] });
    const holds = await db.paymentHold.findMany({
      where: {
        userId,
        vehicleId,
        status: 'AUTHORIZED',
        expiresAt: { gt: new Date() },
        bid: null,
        amount: 30,
        currency: 'CHF',
      },
      select: { id: true, expiresAt: true },
    });
    return Response.json({ holds }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ holds: [] }, { status: 401 });
  }
}
