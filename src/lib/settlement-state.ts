import type { Prisma } from '../generated/prisma/client';

export async function queueRelease(tx: Prisma.TransactionClient, holdId: string) {
  const hold = await tx.paymentHold.findUniqueOrThrow({ where: { id: holdId } });
  if (!['AUTHORIZED', 'PENDING_AUTHORIZATION', 'EXPIRED', 'RELEASE_PENDING'].includes(hold.status))
    return;
  await tx.paymentHold.update({ where: { id: holdId }, data: { status: 'RELEASE_PENDING' } });
  await tx.transaction.upsert({
    where: { idempotencyKey: `release:${holdId}` },
    create: { holdId, operation: 'RELEASE', idempotencyKey: `release:${holdId}` },
    update: {},
  });
}

// Caller holds the vehicle lock. Both worker responses and webhooks use this transition.
export async function recordCapture(
  tx: Prisma.TransactionClient,
  holdId: string,
  captureKey?: string,
) {
  const job = await tx.transaction.findFirst({
    where: {
      holdId,
      operation: { in: ['CAPTURE_FEE', 'CAPTURE_COMPENSATION'] },
      status: { in: ['PENDING', 'PROCESSING', 'SUCCEEDED'] },
    },
  });
  const settlement = await tx.settlement.findFirst({ where: { bid: { holdId } } });
  if (
    !job ||
    !captureKey ||
    captureKey !== job.idempotencyKey ||
    !settlement ||
    !['CAPTURE_PENDING', 'COMPLETED', 'DEFAULTED'].includes(settlement.status)
  ) {
    if (job && job.status !== 'SUCCEEDED')
      await tx.transaction.update({
        where: { id: job.id },
        data: { status: 'FAILED', lockedAt: null },
      });
    await tx.paymentHold.update({ where: { id: holdId }, data: { status: 'CAPTURED_UNEXPECTED' } });
    if (settlement && settlement.status === 'CAPTURE_PENDING')
      await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: 'PAYMENT_FAILED' },
      });
    return false;
  }
  if (job.status === 'SUCCEEDED' && ['COMPLETED', 'DEFAULTED'].includes(settlement.status))
    return true;
  const fee = job.operation === 'CAPTURE_FEE';
  await tx.paymentHold.update({
    where: { id: holdId },
    data: { status: fee ? 'CAPTURED_FEE' : 'CAPTURED_COMPENSATION' },
  });
  await tx.transaction.update({
    where: { id: job.id },
    data: { status: 'SUCCEEDED', lockedAt: null },
  });
  await tx.settlement.update({
    where: { id: settlement.id },
    data: { status: fee ? 'COMPLETED' : 'DEFAULTED', resolvedAt: new Date() },
  });
  await tx.bid.update({
    where: { id: settlement.bidId },
    data: { status: fee ? 'WON' : 'DEFAULTED_PENALIZED' },
  });
  const vehicle = await tx.vehicle.update({
    where: { id: settlement.vehicleId },
    data: { status: fee ? 'SOLD' : 'EXPIRED', version: { increment: 1 } },
  });
  await tx.outboxEvent.create({
    data: {
      kind: 'auction.updated',
      payload: {
        vehicleId: vehicle.id,
        status: vehicle.status,
        amount: vehicle.currentPrice?.toString() ?? null,
        auctionEndsAt: vehicle.auctionEndsAt?.toISOString() ?? null,
        version: vehicle.version,
      },
    },
  });
  return true;
}
