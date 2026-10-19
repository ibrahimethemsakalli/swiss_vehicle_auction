import { db } from '../../../../lib/db';
import { demoVehicles, demoHistory } from '../../../../lib/demo';
import { publicVehicle, publicVehicleInclude } from '../../../../lib/public-vehicle';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) {
    const vehicle = demoVehicles().find((v) => v.id === params.id);
    return vehicle
      ? Response.json({ demo: true, vehicle, history: demoHistory(vehicle) })
      : Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  try {
    const vehicle = await db.vehicle.findFirst({
      where: { id: params.id, status: { in: ['ACTIVE', 'SOLD', 'EXPIRED'] } },
      include: { ...publicVehicleInclude, settlement: { select: { status: true } } },
    });
    if (!vehicle) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    const history =
      vehicle.listingType === 'FIXED_PRICE_OFFERS'
        ? []
        : await db.bid.findMany({
            where: { vehicleId: vehicle.id },
            select: { id: true, amount: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 10,
          });
    return Response.json(
      {
        demo: false,
        vehicle: {
          ...publicVehicle(vehicle),
          saleCancelled: vehicle.settlement?.status === 'CANCELLED',
        },
        history: history.map((b) => ({
          id: b.id,
          amount: Number(b.amount),
          createdAt: b.createdAt,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ error: 'UNAVAILABLE' }, { status: 503 });
  }
}
