import { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { db } from './db';
import { auctionEndAfterBid } from './auction-rules';
import { syncHold, type PaymentGateway, stripeGateway } from './payments';
import { queueRelease } from './settlement-state';
import { requireCurrentLegal } from './legal';
import { notify } from './notifications';
export const bidInput = z
  .object({
    vehicleId: z.uuid(),
    holdId: z.uuid(),
    requestId: z.uuid(),
    amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
  })
  .strict();
export async function placeBid(
  userId: string,
  raw: unknown,
  gateway: PaymentGateway = stripeGateway,
) {
  const input = bidInput.parse(raw);
  const prior = await db.bid.findUnique({
    where: { userId_requestId: { userId, requestId: input.requestId } },
  });
  if (!prior) {
    await requireCurrentLegal(userId);
    await syncHold(input.holdId, userId, gateway);
  }
  return db.$transaction(
    async (tx) => {
      // All writers to this auction must acquire this same lock before reading state.
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${input.vehicleId} FOR UPDATE`;
      const previousRequest = await tx.bid.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (previousRequest) {
        if (
          previousRequest.vehicleId !== input.vehicleId ||
          previousRequest.holdId !== input.holdId ||
          !previousRequest.amount.equals(input.amount)
        )
          throw new Error('IDEMPOTENCY_CONFLICT');
        return { bidId: previousRequest.id };
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const legal = await requireCurrentLegal(userId, tx);
      if (
        user.suspendedAt ||
        !user.isIdentityVerified ||
        !user.phoneVerifiedAt ||
        !user.emailVerifiedAt
      )
        throw new Error('VERIFICATION_REQUIRED');
      const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
      if (vehicle.isSample || user.isSample) throw new Error('SAMPLE_READ_ONLY');
      if (vehicle.userId === userId) throw new Error('SELF_BID');
      if (
        vehicle.status !== 'ACTIVE' ||
        vehicle.listingType !== 'AUCTION_7_DAYS' ||
        !vehicle.auctionEndsAt
      )
        throw new Error('AUCTION_NOT_ACTIVE');
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      if (!vehicle.auctionStartAt || vehicle.auctionStartAt > now)
        throw new Error('AUCTION_NOT_STARTED');
      const end = auctionEndAfterBid(vehicle.auctionEndsAt, now);
      const amount = new Prisma.Decimal(input.amount);
      const minimum = vehicle.currentPrice
        ? vehicle.currentPrice.plus(vehicle.minimumIncrement)
        : vehicle.startPrice;
      if (amount.lt(minimum)) throw new Error('BID_TOO_LOW');
      await tx.$queryRaw`SELECT id FROM "PaymentHold" WHERE id = ${input.holdId} FOR UPDATE`;
      const hold = await tx.paymentHold.findUniqueOrThrow({
        where: { id: input.holdId },
        include: { bid: true },
      });
      if (
        hold.userId !== userId ||
        hold.vehicleId !== vehicle.id ||
        hold.bid ||
        hold.status !== 'AUTHORIZED' ||
        !hold.amount.equals(30) ||
        hold.currency !== 'CHF' ||
        hold.expiresAt <= now
      )
        throw new Error('INVALID_HOLD');
      const oldBids = await tx.bid.findMany({ where: { vehicleId: vehicle.id, status: 'ACTIVE' } });
      for (const old of oldBids) {
        await tx.bid.update({ where: { id: old.id }, data: { status: 'OUTBID' } });
        await queueRelease(tx, old.holdId);
        if (old.userId !== userId)
          await notify(tx, { type: 'outbid', bidId: old.id, userId: old.userId, vehicle });
      }
      const bid = await tx.bid.create({
        data: {
          userId,
          vehicleId: vehicle.id,
          amount,
          holdId: hold.id,
          requestId: input.requestId,
          legalAcceptanceId: legal?.id,
        },
      });
      const extended = end.getTime() !== vehicle.auctionEndsAt.getTime();
      const updated = await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          currentPrice: amount,
          auctionEndsAt: end,
          version: { increment: 1 },
          antiSnipingCount: { increment: extended ? 1 : 0 },
        },
      });
      if (extended) await tx.auctionLog.create({ data: { vehicleId: vehicle.id } });
      await tx.outboxEvent.create({
        data: {
          kind: 'auction.updated',
          payload: {
            vehicleId: vehicle.id,
            amount: amount.toFixed(2),
            auctionEndsAt: end.toISOString(),
            version: updated.version,
          },
        },
      });
      return { bidId: bid.id, auctionEndsAt: end.toISOString(), amount: amount.toFixed(2) };
    },
    { timeout: 10_000 },
  );
}
