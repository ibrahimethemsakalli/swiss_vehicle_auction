import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { demoVehicles } from '../../../lib/demo';
import { publicVehicle, publicVehicleInclude } from '../../../lib/public-vehicle';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!process.env.DATABASE_URL) {
    const cars = demoVehicles();
    return Response.json({
      demo: true,
      user: { role: 'PRIVATE_USER', verified: false },
      vehicles: cars.slice(2, 4),
      bids: [
        { id: 'sample-bid', amount: cars[0].price, status: 'ACTIVE', vehicle: cars[0] },
        { id: 'sample-outbid', amount: 23000, status: 'OUTBID', vehicle: cars[1] },
      ],
      holds: [
        {
          id: 'sample-hold',
          amount: 30,
          status: 'AUTHORIZED',
          vehicle: `${cars[0].make} ${cars[0].model}`,
        },
        {
          id: 'sample-released',
          amount: 30,
          status: 'RELEASED',
          vehicle: `${cars[1].make} ${cars[1].model}`,
        },
      ],
      offers: [],
    });
  }
  try {
    const id = await requireUser();
    const user = await db.user.findUnique({
      where: { id },
      select: { role: true, isIdentityVerified: true, phoneVerifiedAt: true, suspendedAt: true },
    });
    if (!user || user.suspendedAt) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const [vehicles, bids, holds, offers] = await Promise.all([
      db.vehicle.findMany({
        where: { userId: id },
        include: publicVehicleInclude,
        orderBy: { createdAt: 'desc' },
      }),
      db.bid.findMany({
        where: { userId: id },
        include: {
          vehicle: { include: publicVehicleInclude },
          hold: { select: { status: true, expiresAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.paymentHold.findMany({
        where: { userId: id },
        select: {
          id: true,
          amount: true,
          status: true,
          vehicle: { select: { make: true, model: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.bid.findMany({
        where: { vehicle: { userId: id }, status: { in: ['ACTIVE', 'WON'] } },
        select: {
          id: true,
          amount: true,
          status: true,
          vehicle: { select: { make: true, model: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return Response.json(
      {
        demo: false,
        user: { role: user.role, verified: user.isIdentityVerified && !!user.phoneVerifiedAt },
        vehicles: vehicles.map(publicVehicle),
        bids: bids.map((b) => ({
          id: b.id,
          amount: Number(b.amount),
          status: b.status,
          hold: b.hold,
          vehicle: publicVehicle(b.vehicle),
        })),
        holds: holds.map((h) => ({
          ...h,
          amount: Number(h.amount),
          vehicle: `${h.vehicle.make} ${h.vehicle.model}`,
        })),
        offers: offers.map((b) => ({
          ...b,
          amount: Number(b.amount),
          vehicle: `${b.vehicle.make} ${b.vehicle.model}`,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: 'UNAVAILABLE' },
      { status: error instanceof Error && error.message === 'UNAUTHORIZED' ? 401 : 503 },
    );
  }
}
