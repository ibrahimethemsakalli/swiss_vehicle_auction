import { z } from 'zod';
import { requireUser, apiError } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import {
  assertLocalAccount,
  assertLocalVehicle,
  assertLocalRequest,
  localPaymentsEnabled,
} from '../../../lib/local-payment';
import { db } from '../../../lib/db';
import { closeAuction, processCaptures } from '../../../lib/settlement';
import { processReleases } from '../../../lib/payments';
export async function GET(request: Request) {
  let enabled = false;
  let canClose = false;
  try {
    assertLocalRequest(request);
    const user = await assertLocalAccount(await requireUser());
    enabled = true;
    const vehicleId = new URL(request.url).searchParams.get('vehicleId');
    if (vehicleId) {
      const vehicle = await assertLocalVehicle(vehicleId);
      canClose =
        vehicle.status === 'ACTIVE' && (user.role === 'ADMIN' || user.id === vehicle.userId);
    }
  } catch {}
  return Response.json({ enabled, canClose }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  if (!localPaymentsEnabled()) return new Response(null, { status: 404 });
  try {
    assertSameOrigin(request);
    assertLocalRequest(request);
    const user = await assertLocalAccount(await requireUser());
    const { vehicleId } = z
      .object({ vehicleId: z.uuid() })
      .strict()
      .parse(await request.json());
    const vehicle = await assertLocalVehicle(vehicleId);
    if (user.id !== vehicle.userId && user.role !== 'ADMIN') throw new Error('FORBIDDEN');
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId} FOR UPDATE`;
      await tx.vehicle.updateMany({
        where: { id: vehicleId, status: 'ACTIVE', listingType: 'AUCTION_7_DAYS' },
        data: { auctionEndsAt: new Date(Date.now() - 1000) },
      });
    });
    await closeAuction(vehicleId);
    await processReleases();
    await processCaptures();
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
