import { cache } from 'react';
import { db } from './db';
import { demoVehicles, demoHistory } from './demo';
import { publicVehicle, publicVehicleInclude } from './public-vehicle';
import type { Prisma } from '../generated/prisma/client';

export function indexableVehicles(now = new Date()): Prisma.VehicleWhereInput {
  return {
    status: 'ACTIVE',
    isSample: false,
    user: {
      isSample: false,
      suspendedAt: null,
      NOT: ['.test', '.invalid', '.example', '@localhost'].map((suffix) => ({
        email: { endsWith: suffix, mode: 'insensitive' as const },
      })),
    },
    NOT: [
      { make: { startsWith: 'LOCAL', mode: 'insensitive' } },
      { settlement: { status: 'CANCELLED' } },
    ],
    OR: [
      { listingType: 'FIXED_PRICE_OFFERS' },
      { listingType: 'AUCTION_7_DAYS', auctionEndsAt: { gt: now } },
    ],
  };
}
export const readPublicDetail = cache(async (id: string) => {
  if (!process.env.DATABASE_URL) {
    const vehicle = demoVehicles().find((v) => v.id === id);
    return vehicle
      ? { detail: { demo: true, vehicle, history: demoHistory(vehicle) }, eligible: false }
      : null;
  }
  const row = await db.vehicle.findFirst({
    where: { id, status: { in: ['ACTIVE', 'SOLD', 'EXPIRED'] } },
    include: { ...publicVehicleInclude, settlement: { select: { status: true } } },
  });
  if (!row) return null;
  const eligible = !!(await db.vehicle.findFirst({
    where: { id, ...indexableVehicles() },
    select: { id: true },
  }));
  const history =
    row.listingType === 'FIXED_PRICE_OFFERS'
      ? []
      : await db.bid.findMany({
          where: { vehicleId: id },
          select: { id: true, amount: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
  return {
    eligible,
    detail: {
      demo: false,
      vehicle: { ...publicVehicle(row), saleCancelled: row.settlement?.status === 'CANCELLED' },
      history: history.map((b) => ({
        id: b.id,
        amount: Number(b.amount),
        createdAt: b.createdAt.toISOString(),
      })),
    },
  };
});
