import { db } from './db';
import { stripeGateway, type PaymentGateway } from './payments';
import { queueRelease, recordCapture } from './settlement-state';
import { blockingDisputes } from './disputes';
import { notify } from './notifications';

export async function closeAuction(vehicleId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId} FOR UPDATE`;
    const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (
      vehicle.status !== 'ACTIVE' ||
      vehicle.listingType !== 'AUCTION_7_DAYS' ||
      !vehicle.auctionEndsAt ||
      vehicle.auctionEndsAt > now
    )
      return;
    const bids = await tx.bid.findMany({
      where: { vehicleId, status: 'ACTIVE' },
      orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const winner =
      bids[0] && (!vehicle.reservePrice || bids[0].amount.gte(vehicle.reservePrice))
        ? bids[0]
        : undefined;
    for (const bid of bids) {
      await tx.bid.update({
        where: { id: bid.id },
        data: { status: bid.id === winner?.id ? 'WON' : 'RELEASED' },
      });
    }
    if (winner) await tx.settlement.create({ data: { vehicleId, bidId: winner.id } });
    // EXPIRED means bidding is closed. A settlement distinguishes a pending sale from no sale.
    const updated = await tx.vehicle.update({
      where: { id: vehicleId },
      data: { status: 'EXPIRED', version: { increment: 1 } },
    });
    const holds = await tx.paymentHold.findMany({
      where: {
        vehicleId,
        id: { not: winner?.holdId },
        status: { in: ['AUTHORIZED', 'PENDING_AUTHORIZATION', 'EXPIRED'] },
      },
    });
    for (const hold of holds) await queueRelease(tx, hold.id);
    const participants = await tx.bid.findMany({
      where: { vehicleId },
      distinct: ['userId'],
      select: { userId: true },
    });
    await notify(tx, {
      type: 'closed',
      version: updated.version,
      vehicle,
      winnerId: winner?.userId,
      participantIds: participants.map((bid) => bid.userId),
    });
    await tx.outboxEvent.create({
      data: {
        kind: 'auction.updated',
        payload: {
          vehicleId,
          status: updated.status,
          amount: updated.currentPrice?.toString() ?? null,
          auctionEndsAt: updated.auctionEndsAt!.toISOString(),
          version: updated.version,
        },
      },
    });
    await tx.outboxEvent.create({
      data: {
        kind: 'auction.closed',
        deliveredAt: now,
        payload: {
          vehicleId,
          winnerBidId: winner?.id ?? null,
          reason: winner ? 'WINNER' : bids.length ? 'RESERVE_NOT_MET' : 'NO_BIDS',
        },
      },
    });
  });
}
export async function closeDueAuctions() {
  const vehicles = await db.vehicle.findMany({
    where: { status: 'ACTIVE', listingType: 'AUCTION_7_DAYS', auctionEndsAt: { lte: new Date() } },
    select: { id: true },
    take: 100,
    orderBy: { auctionEndsAt: 'asc' },
  });
  for (const vehicle of vehicles) await closeAuction(vehicle.id);
}
export type SettlementAction =
  | 'confirm'
  | 'report_default'
  | 'approve_default'
  | 'dismiss_default'
  | 'cancel'
  | 'retry';
export async function actOnSettlement(
  actorId: string,
  settlementId: string,
  action: SettlementAction,
  note: string,
) {
  if (note.trim().length < 10 || note.length > 2000) throw new Error('REASON_REQUIRED');
  const initial = await db.settlement.findUniqueOrThrow({ where: { id: settlementId } });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${initial.vehicleId} FOR UPDATE`;
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const s = await tx.settlement.findUniqueOrThrow({
      where: { id: settlementId },
      include: { vehicle: true, bid: { include: { hold: true } } },
    });
    if (actor.suspendedAt) throw new Error('FORBIDDEN');
    if (
      ['confirm', 'approve_default', 'retry'].includes(action) &&
      (await tx.dispute.count({ where: { settlementId, status: { in: blockingDisputes } } }))
    )
      throw new Error('DISPUTE_OPEN');
    const sellerAction = ['confirm', 'report_default'].includes(action);
    if (
      sellerAction
        ? s.vehicle.userId !== actorId
        : actor.role !== 'ADMIN' || [s.vehicle.userId, s.bid.userId].includes(actorId)
    )
      throw new Error('FORBIDDEN');
    if (
      action === 'confirm' &&
      ['CAPTURE_PENDING', 'COMPLETED'].includes(s.status) &&
      s.outcome === 'FEE'
    )
      return;
    if (action === 'report_default' && s.status === 'DEFAULT_REVIEW') return;
    if (
      action === 'approve_default' &&
      ['CAPTURE_PENDING', 'DEFAULTED'].includes(s.status) &&
      s.outcome === 'COMPENSATION'
    )
      return;
    if (action === 'cancel' && s.status === 'CANCELLED') return;
    if (action === 'report_default') {
      if (s.status !== 'AWAITING_CONFIRMATION') throw new Error('CONFLICT');
      await tx.settlement.update({
        where: { id: s.id },
        data: { status: 'DEFAULT_REVIEW', defaultReportedAt: new Date() },
      });
    } else if (action === 'dismiss_default') {
      if (s.status !== 'DEFAULT_REVIEW') throw new Error('CONFLICT');
      await tx.settlement.update({
        where: { id: s.id },
        data: { status: 'AWAITING_CONFIRMATION' },
      });
    } else if (action === 'cancel') {
      if (
        !['AWAITING_CONFIRMATION', 'DEFAULT_REVIEW', 'PAYMENT_FAILED'].includes(s.status) ||
        [
          'CAPTURED_UNEXPECTED',
          'CAPTURED_FEE',
          'CAPTURED_COMPENSATION',
          'CAPTURE_PENDING',
        ].includes(s.bid.hold.status)
      )
        throw new Error('CONFLICT');
      await queueRelease(tx, s.bid.holdId);
      await tx.settlement.update({
        where: { id: s.id },
        data: { status: 'CANCELLED', outcome: 'RELEASE', resolvedAt: new Date() },
      });
      await tx.bid.update({ where: { id: s.bidId }, data: { status: 'RELEASED' } });
    } else {
      if (
        (action === 'confirm' && s.status !== 'AWAITING_CONFIRMATION') ||
        (action === 'approve_default' && s.status !== 'DEFAULT_REVIEW') ||
        (action === 'retry' && s.status !== 'PAYMENT_FAILED')
      )
        throw new Error('CONFLICT');
      const outcome =
        action === 'retry' ? s.outcome : action === 'confirm' ? 'FEE' : 'COMPENSATION';
      if (!['FEE', 'COMPENSATION'].includes(outcome ?? '')) throw new Error('CONFLICT');
      if (s.bid.hold.status !== 'AUTHORIZED' || s.bid.hold.expiresAt <= new Date())
        throw new Error('HOLD_RENEWAL_REQUIRED');
      const operation = outcome === 'FEE' ? 'CAPTURE_FEE' : 'CAPTURE_COMPENSATION';
      await tx.paymentHold.update({
        where: { id: s.bid.holdId },
        data: { status: 'CAPTURE_PENDING' },
      });
      await tx.transaction.upsert({
        where: { idempotencyKey: `capture:${s.bid.holdId}` },
        create: { holdId: s.bid.holdId, operation, idempotencyKey: `capture:${s.bid.holdId}` },
        update: { status: 'PENDING', nextAttemptAt: new Date(), lockedAt: null },
      });
      await tx.settlement.update({
        where: { id: s.id },
        data: {
          status: 'CAPTURE_PENDING',
          outcome,
          ...(action === 'confirm' ? { sellerConfirmedAt: new Date() } : {}),
        },
      });
    }
    await tx.outboxEvent.create({
      data: {
        kind: 'settlement.action',
        deliveredAt: new Date(),
        payload: { actorId, settlementId, action, note, previousStatus: s.status },
      },
    });
  });
}

export async function processCaptures(gateway: PaymentGateway = stripeGateway) {
  const jobs = await db.$queryRaw<
    { id: string; holdId: string; idempotencyKey: string; attempts: number }[]
  >`
    UPDATE "Transaction" SET status = 'PROCESSING', "lockedAt" = NOW(), attempts = attempts + 1
    WHERE id IN (SELECT id FROM "Transaction" WHERE operation IN ('CAPTURE_FEE', 'CAPTURE_COMPENSATION') AND "nextAttemptAt" <= NOW()
      AND (status = 'PENDING' OR (status = 'PROCESSING' AND "lockedAt" < NOW() - INTERVAL '2 minutes'))
      ORDER BY "createdAt" LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING id, "holdId", "idempotencyKey", attempts`;
  for (const job of jobs) {
    try {
      const initial = await db.paymentHold.findUniqueOrThrow({ where: { id: job.holdId } });
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${initial.vehicleId} FOR UPDATE`;
          const hold = await tx.paymentHold.findUniqueOrThrow({ where: { id: job.holdId } });
          const currentJob = await tx.transaction.findUniqueOrThrow({ where: { id: job.id } });
          if (currentJob.status === 'SUCCEEDED') return;
          const settlement = await tx.settlement.findFirst({ where: { bid: { holdId: hold.id } } });
          if (!settlement || settlement.status !== 'CAPTURE_PENDING' || !hold.gatewayTransactionId)
            throw new Error('INVALID_SETTLEMENT');
          if (
            await tx.dispute.count({
              where: { settlementId: settlement.id, status: { in: blockingDisputes } },
            })
          )
            throw new Error('DISPUTE_OPEN');
          let intent = await gateway.retrieve(hold.gatewayTransactionId);
          const valid = () =>
            intent.valid &&
            intent.id === hold.gatewayTransactionId &&
            intent.holdId === hold.id &&
            intent.userId === hold.userId &&
            intent.vehicleId === hold.vehicleId;
          if (!valid()) throw new Error('INVALID_HOLD');
          if (intent.state !== 'captured') {
            if (
              intent.state === 'released' ||
              intent.state === 'failed' ||
              (intent.expiresAt && intent.expiresAt <= new Date())
            ) {
              await tx.transaction.update({
                where: { id: job.id },
                data: { status: 'FAILED', lockedAt: null },
              });
              await tx.paymentHold.update({
                where: { id: hold.id },
                data: { status: intent.state === 'released' ? 'RELEASED' : 'EXPIRED' },
              });
              await tx.settlement.update({
                where: { id: settlement.id },
                data: { status: 'PAYMENT_FAILED' },
              });
              return;
            }
            if (intent.state !== 'authorized' || !intent.expiresAt)
              throw new Error('CAPTURE_NOT_READY');
            intent = await gateway.capture(hold.gatewayTransactionId, job.idempotencyKey);
          }
          if (!valid() || intent.state !== 'captured') throw new Error('CAPTURE_NOT_CONFIRMED');
          await recordCapture(tx, hold.id, intent.captureKey);
        },
        { timeout: 60000 },
      );
    } catch {
      // Ambiguous network errors remain retryable. Retrieve before every retry avoids double capture.
      await db.transaction.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: {
          status: 'PENDING',
          lockedAt: null,
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600, 2 ** Math.min(job.attempts, 12)) * 1000,
          ),
        },
      });
    }
  }
}
