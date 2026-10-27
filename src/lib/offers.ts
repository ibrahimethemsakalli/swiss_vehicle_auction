import { Prisma } from '../generated/prisma/client';
import { db } from './db';
import { bidInput } from './bidding';
import { syncHold, stripeGateway, type PaymentGateway } from './payments';
import { queueRelease } from './settlement-state';
import { requireCurrentLegal } from './legal';
export async function makeOffer(
  userId: string,
  raw: unknown,
  gateway: PaymentGateway = stripeGateway,
) {
  const input = bidInput.parse(raw);
  const previous = await db.bid.findUnique({
    where: { userId_requestId: { userId, requestId: input.requestId } },
  });
  if (!previous) {
    await requireCurrentLegal(userId);
    await syncHold(input.holdId, userId, gateway);
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${input.vehicleId} FOR UPDATE`;
    const prior = await tx.bid.findUnique({
      where: { userId_requestId: { userId, requestId: input.requestId } },
    });
    if (prior) {
      if (
        prior.vehicleId !== input.vehicleId ||
        prior.holdId !== input.holdId ||
        !prior.amount.equals(input.amount) ||
        !prior.offerExpiresAt
      )
        throw new Error('CONFLICT');
      return { id: prior.id };
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const legal = await requireCurrentLegal(userId, tx);
    const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
    if (
      user.suspendedAt ||
      user.isSample ||
      !user.phoneVerifiedAt ||
      !user.emailVerifiedAt ||
      !user.isIdentityVerified
    )
      throw new Error('VERIFICATION_REQUIRED');
    if (
      vehicle.isSample ||
      vehicle.status !== 'ACTIVE' ||
      vehicle.listingType !== 'FIXED_PRICE_OFFERS' ||
      vehicle.userId === userId
    )
      throw new Error('FORBIDDEN');
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lte(0) || amount.gt(vehicle.buyNowPrice ?? vehicle.startPrice))
      throw new Error('INVALID_PRICE');
    const hold = await tx.paymentHold.findUniqueOrThrow({
      where: { id: input.holdId },
      include: { bid: true },
    });
    if (
      hold.userId !== userId ||
      hold.vehicleId !== vehicle.id ||
      hold.bid ||
      hold.status !== 'AUTHORIZED' ||
      hold.expiresAt <= new Date() ||
      !hold.amount.equals(30) ||
      hold.currency !== 'CHF'
    )
      throw new Error('INVALID_HOLD');
    if (
      await tx.bid.findFirst({ where: { userId, vehicleId: vehicle.id, status: 'OFFER_PENDING' } })
    )
      throw new Error('PENDING_OFFER_EXISTS');
    const offer = await tx.bid.create({
      data: {
        ...input,
        legalAcceptanceId: legal?.id,
        userId,
        amount,
        status: 'OFFER_PENDING',
        offerExpiresAt: new Date(Math.min(Date.now() + 48 * 3600000, hold.expiresAt.getTime())),
      },
    });
    return { id: offer.id };
  });
}
export async function decideOffer(
  actorId: string,
  bidId: string,
  action: 'accept' | 'reject' | 'withdraw',
  gateway: PaymentGateway = stripeGateway,
) {
  const initial = await db.bid.findUniqueOrThrow({
    where: { id: bidId },
    include: { vehicle: true },
  });
  if (action === 'accept') {
    if (initial.vehicle.userId !== actorId) throw new Error('FORBIDDEN');
    if (initial.status === 'OFFER_PENDING') await syncHold(initial.holdId, undefined, gateway);
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${initial.vehicleId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const offer = await tx.bid.findUniqueOrThrow({
      where: { id: bidId },
      include: { vehicle: true, hold: true },
    });
    if (
      user.suspendedAt ||
      (action === 'withdraw' ? offer.userId !== actorId : offer.vehicle.userId !== actorId) ||
      offer.vehicle.listingType !== 'FIXED_PRICE_OFFERS'
    )
      throw new Error('FORBIDDEN');
    const target =
      action === 'accept' ? 'WON' : action === 'reject' ? 'OFFER_REJECTED' : 'OFFER_WITHDRAWN';
    if (offer.status === target) return;
    if (offer.status !== 'OFFER_PENDING') throw new Error('CONFLICT');
    if (action === 'accept') {
      if (
        offer.vehicle.status !== 'ACTIVE' ||
        !offer.offerExpiresAt ||
        offer.offerExpiresAt <= new Date() ||
        offer.hold.status !== 'AUTHORIZED' ||
        offer.hold.expiresAt <= new Date()
      )
        throw new Error('OFFER_EXPIRED');
      const buyer = await tx.user.findUniqueOrThrow({ where: { id: offer.userId } });
      if (
        buyer.suspendedAt ||
        !buyer.phoneVerifiedAt ||
        !buyer.emailVerifiedAt ||
        !buyer.isIdentityVerified
      )
        throw new Error('VERIFICATION_REQUIRED');
      await tx.bid.update({ where: { id: bidId }, data: { status: 'WON' } });
      await tx.settlement.create({ data: { vehicleId: offer.vehicleId, bidId } });
      await tx.vehicle.update({
        where: { id: offer.vehicleId },
        data: { status: 'EXPIRED', currentPrice: offer.amount, version: { increment: 1 } },
      });
      const others = await tx.bid.findMany({
        where: { vehicleId: offer.vehicleId, status: 'OFFER_PENDING' },
      });
      for (const other of others) {
        await tx.bid.update({ where: { id: other.id }, data: { status: 'OFFER_REJECTED' } });
        await queueRelease(tx, other.holdId);
      }
      const unused = await tx.paymentHold.findMany({
        where: { vehicleId: offer.vehicleId, bid: null },
      });
      for (const hold of unused) await queueRelease(tx, hold.id);
    } else {
      await tx.bid.update({ where: { id: bidId }, data: { status: target } });
      await queueRelease(tx, offer.holdId);
    }
    await tx.outboxEvent.create({
      data: {
        kind: 'offer.decision',
        deliveredAt: new Date(),
        payload: { actorId, bidId, action },
      },
    });
  });
}
export async function expireOffers() {
  const expired = await db.bid.findMany({
    where: { status: 'OFFER_PENDING', offerExpiresAt: { lte: new Date() } },
    select: { id: true, vehicleId: true },
    take: 100,
  });
  for (const offer of expired)
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${offer.vehicleId} FOR UPDATE`;
      const current = await tx.bid.findUniqueOrThrow({ where: { id: offer.id } });
      if (
        current.status !== 'OFFER_PENDING' ||
        !current.offerExpiresAt ||
        current.offerExpiresAt > new Date()
      )
        return;
      await tx.bid.update({ where: { id: current.id }, data: { status: 'OFFER_EXPIRED' } });
      await queueRelease(tx, current.holdId);
    });
}
