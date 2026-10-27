import Stripe from 'stripe';
import { db } from './db';
import { rateLimit } from './rate-limit';
import { recordCapture } from './settlement-state';
import { requireCurrentLegal } from './legal';
import { paymentRoute } from './provider-isolation';
import {
  localGateway,
  localPaymentsEnabled,
  assertLocalAccount,
  assertLocalVehicle,
} from './local-payment';

export function stripeClient() {
  if (process.env.LOCAL_TEST_PAYMENTS === 'true') throw new Error('PROVIDER_UNAVAILABLE');
  const key = process.env.STRIPE_SECRET_KEY;
  if (
    !key ||
    !/^(sk|rk)_(test|live)_/.test(key) ||
    (key.includes('_live_') && process.env.STRIPE_ALLOW_LIVE !== 'true')
  )
    throw new Error('PROVIDER_UNAVAILABLE');
  return new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
}
export type Intent = {
  id: string;
  clientSecret: string | null;
  state: 'pending' | 'authorized' | 'released' | 'captured' | 'failed';
  expiresAt?: Date;
  holdId: string;
  userId: string;
  vehicleId: string;
  valid: boolean;
  captureKey?: string;
};
export interface PaymentGateway {
  create(hold: { id: string; userId: string; vehicleId: string }): Promise<Intent>;
  retrieve(id: string): Promise<Intent>;
  release(id: string, key: string): Promise<Intent>;
  capture(id: string, key: string): Promise<Intent>;
}
export function normalizeStripeIntent(intent: Stripe.PaymentIntent): Intent {
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const captureBefore = charge?.payment_method_details?.card?.capture_before;
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    holdId: intent.metadata.holdId,
    userId: intent.metadata.userId,
    vehicleId: intent.metadata.vehicleId,
    captureKey: intent.metadata.captureKey,
    valid:
      intent.amount === 3000 &&
      intent.currency === 'chf' &&
      intent.capture_method === 'manual' &&
      (!intent.livemode || process.env.STRIPE_ALLOW_LIVE === 'true') &&
      (intent.status !== 'requires_capture' || intent.amount_capturable === 3000) &&
      (intent.status !== 'succeeded' || intent.amount_received === 3000),
    state:
      intent.status === 'requires_capture'
        ? 'authorized'
        : intent.status === 'canceled'
          ? 'released'
          : intent.status === 'succeeded'
            ? 'captured'
            : intent.status === 'requires_payment_method' && intent.last_payment_error
              ? 'failed'
              : 'pending',
    expiresAt: captureBefore ? new Date(captureBefore * 1000) : undefined,
  };
}
const realStripeGateway: PaymentGateway = {
  async capture(id, key) {
    return normalizeStripeIntent(
      await stripeClient().paymentIntents.capture(
        id,
        { amount_to_capture: 3000, metadata: { captureKey: key }, expand: ['latest_charge'] },
        { idempotencyKey: key },
      ),
    );
  },
  async create(hold) {
    return normalizeStripeIntent(
      await stripeClient().paymentIntents.create(
        {
          amount: 3000,
          currency: 'chf',
          capture_method: 'manual',
          allowed_payment_method_types: ['card'],
          metadata: { holdId: hold.id, userId: hold.userId, vehicleId: hold.vehicleId },
          expand: ['latest_charge'],
        },
        { idempotencyKey: `authorize:${hold.id}` },
      ),
    );
  },
  async retrieve(id) {
    return normalizeStripeIntent(
      await stripeClient().paymentIntents.retrieve(id, { expand: ['latest_charge'] }),
    );
  },
  async release(id, key) {
    const current = await this.retrieve(id);
    if (current.state === 'released') return current;
    return normalizeStripeIntent(
      await stripeClient().paymentIntents.cancel(id, {}, { idempotencyKey: key }),
    );
  },
};
// Never send local fixture IDs to Stripe, even if the mode has subsequently been disabled.
function selectedGateway(id?: string, storedGateway?: string) {
  return paymentRoute(
    { requested: process.env.LOCAL_TEST_PAYMENTS === 'true', enabled: localPaymentsEnabled() },
    id,
    storedGateway,
  ) === 'local'
    ? localGateway
    : realStripeGateway;
}
export const stripeGateway: PaymentGateway = {
  create: (hold) => selectedGateway(undefined, (hold as { gateway?: string }).gateway).create(hold),
  retrieve: (id) => selectedGateway(id).retrieve(id),
  release: (id, key) => selectedGateway(id).release(id, key),
  capture: (id, key) => selectedGateway(id).capture(id, key),
};
export async function createHold(
  userId: string,
  vehicleId: string,
  replacementBidId?: string,
  gateway: PaymentGateway = stripeGateway,
) {
  const local = gateway === stripeGateway && localPaymentsEnabled();
  if (local) {
    await assertLocalAccount(userId);
    await assertLocalVehicle(vehicleId);
  }
  await rateLimit(`hold:${userId}`, 20, 3600);
  const hold = await db.$transaction(async (tx) => {
    const legal = replacementBidId ? null : await requireCurrentLegal(userId, tx);
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      user.suspendedAt ||
      !user.phoneVerifiedAt ||
      !user.emailVerifiedAt ||
      !user.isIdentityVerified
    )
      throw new Error('VERIFICATION_REQUIRED');
    const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    if (vehicle.isSample || user.isSample) throw new Error('SAMPLE_READ_ONLY');
    const renewal = replacementBidId
      ? await tx.settlement.findFirst({
          where: {
            vehicleId,
            bidId: replacementBidId,
            bid: { userId, status: 'WON' },
            status: { in: ['AWAITING_CONFIRMATION', 'DEFAULT_REVIEW', 'PAYMENT_FAILED'] },
          },
        })
      : null;
    if (
      vehicle.userId === userId ||
      (!renewal && vehicle.status !== 'ACTIVE') ||
      (vehicle.listingType === 'AUCTION_7_DAYS' &&
        (!vehicle.auctionEndsAt ||
          (!renewal && vehicle.auctionEndsAt <= new Date()) ||
          !vehicle.auctionStartAt ||
          vehicle.auctionStartAt > new Date()))
    )
      throw new Error('AUCTION_NOT_ACTIVE');
    if (
      replacementBidId &&
      !(await tx.bid.findFirst({
        where: { id: replacementBidId, userId, vehicleId, status: renewal ? 'WON' : 'ACTIVE' },
      }))
    )
      throw new Error('INVALID_BID');
    const existing = await tx.paymentHold.findFirst({
      where: {
        userId,
        vehicleId,
        replacementBidId: replacementBidId ?? null,
        bid: null,
        status: { in: ['PENDING_AUTHORIZATION', 'AUTHORIZED'] },
        createdAt: { gt: new Date(Date.now() - 15 * 60000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    return (
      existing ??
      tx.paymentHold.create({
        data: {
          userId,
          vehicleId,
          replacementBidId,
          legalAcceptanceId: legal?.id,
          gateway: local ? 'local-test' : 'stripe',
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
      })
    );
  });
  // Persist before returning a client secret. Retries recover the same intent with Stripe's idempotency key.
  const intent = hold.gatewayTransactionId
    ? await gateway.retrieve(hold.gatewayTransactionId)
    : await gateway.create(hold);
  if (
    !intent.valid ||
    intent.holdId !== hold.id ||
    intent.userId !== userId ||
    intent.vehicleId !== vehicleId
  )
    throw new Error('INVALID_HOLD');
  await db.paymentHold.update({
    where: { id: hold.id },
    data: { gatewayTransactionId: intent.id },
  });
  return { holdId: hold.id, clientSecret: intent.clientSecret };
}
export async function syncHold(
  holdId: string,
  userId?: string,
  gateway: PaymentGateway = stripeGateway,
) {
  const initial = await db.paymentHold.findUniqueOrThrow({ where: { id: holdId } });
  if (userId && initial.userId !== userId) throw new Error('FORBIDDEN');
  if (!initial.gatewayTransactionId || !['stripe', 'local-test'].includes(initial.gateway))
    throw new Error('INVALID_HOLD');
  return db.$transaction(
    async (tx) => {
      // Same lock order as bidding. Retrieve inside the lock so delayed webhooks cannot resurrect a canceled hold.
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${initial.vehicleId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PaymentHold" WHERE id = ${holdId} FOR UPDATE`;
      const hold = await tx.paymentHold.findUniqueOrThrow({
        where: { id: holdId },
        include: { bid: true },
      });
      const intent = await gateway.retrieve(hold.gatewayTransactionId!);
      if (
        !intent.valid ||
        intent.holdId !== hold.id ||
        intent.userId !== hold.userId ||
        intent.vehicleId !== hold.vehicleId
      )
        throw new Error('INVALID_HOLD');
      let status = hold.status;
      if (
        intent.state === 'released' &&
        !['CAPTURED_FEE', 'CAPTURED_COMPENSATION', 'CAPTURED_UNEXPECTED'].includes(status)
      )
        status = 'RELEASED';
      else if (
        intent.state === 'captured' &&
        !['CAPTURED_FEE', 'CAPTURED_COMPENSATION'].includes(status)
      ) {
        await recordCapture(tx, holdId, intent.captureKey);
        return tx.paymentHold.findUniqueOrThrow({ where: { id: holdId } });
      } else if (['PENDING_AUTHORIZATION', 'AUTHORIZED'].includes(status)) {
        if (intent.state === 'failed') status = 'FAILED';
        else if (intent.state === 'authorized' && intent.expiresAt && intent.expiresAt > new Date())
          status = 'AUTHORIZED';
        else if (intent.state === 'authorized' || hold.expiresAt <= new Date()) status = 'EXPIRED';
        else status = 'PENDING_AUTHORIZATION';
      }
      const updated = await tx.paymentHold.update({
        where: { id: holdId },
        data: { status, ...(intent.expiresAt ? { expiresAt: intent.expiresAt } : {}) },
      });
      if (status === 'AUTHORIZED' && hold.replacementBidId && !hold.bid) {
        const bid = await tx.bid.findFirst({
          where: {
            id: hold.replacementBidId,
            userId: hold.userId,
            vehicleId: hold.vehicleId,
            OR: [
              { status: 'ACTIVE' },
              {
                status: 'WON',
                settlement: {
                  status: { in: ['AWAITING_CONFIRMATION', 'DEFAULT_REVIEW', 'PAYMENT_FAILED'] },
                },
              },
            ],
          },
          include: { hold: true },
        });
        if (bid) {
          await tx.bid.update({ where: { id: bid.id }, data: { holdId } });
          if (['AUTHORIZED', 'EXPIRED'].includes(bid.hold.status)) {
            await tx.paymentHold.update({
              where: { id: bid.holdId },
              data: { status: 'RELEASE_PENDING' },
            });
            await tx.transaction.upsert({
              where: { idempotencyKey: `release:${bid.holdId}` },
              create: {
                holdId: bid.holdId,
                operation: 'RELEASE',
                idempotencyKey: `release:${bid.holdId}`,
              },
              update: {},
            });
          }
        } else {
          await tx.paymentHold.update({
            where: { id: holdId },
            data: { status: 'RELEASE_PENDING' },
          });
          await tx.transaction.upsert({
            where: { idempotencyKey: `release:${holdId}` },
            create: { holdId, operation: 'RELEASE', idempotencyKey: `release:${holdId}` },
            update: {},
          });
          return { ...updated, status: 'RELEASE_PENDING' as const };
        }
      }
      return updated;
    },
    { timeout: 30000 },
  );
}
export async function processReleases(gateway: PaymentGateway = stripeGateway) {
  const jobs = await db.$queryRaw<
    { id: string; holdId: string; idempotencyKey: string; attempts: number }[]
  >`
    UPDATE "Transaction" SET status = 'PROCESSING', "lockedAt" = NOW(), attempts = attempts + 1
    WHERE id IN (SELECT id FROM "Transaction" WHERE operation = 'RELEASE' AND "nextAttemptAt" <= NOW()
      AND (status = 'PENDING' OR (status = 'PROCESSING' AND "lockedAt" < NOW() - INTERVAL '2 minutes'))
      ORDER BY "createdAt" LIMIT 10 FOR UPDATE SKIP LOCKED)
    RETURNING id, "holdId", "idempotencyKey", attempts`;
  for (const job of jobs) {
    try {
      const hold = await db.paymentHold.findUniqueOrThrow({ where: { id: job.holdId } });
      if (!hold.gatewayTransactionId) {
        if (Date.now() - hold.createdAt.getTime() > 23 * 3600000) {
          await db.transaction.update({
            where: { id: job.id },
            data: { status: 'FAILED', lockedAt: null },
          });
          await db.paymentHold.update({ where: { id: hold.id }, data: { status: 'FAILED' } });
          continue;
        }
        const recovered = await gateway.create(hold);
        if (
          !recovered.valid ||
          recovered.holdId !== hold.id ||
          recovered.userId !== hold.userId ||
          recovered.vehicleId !== hold.vehicleId
        )
          throw new Error('INVALID_HOLD');
        hold.gatewayTransactionId = recovered.id;
        await db.paymentHold.update({
          where: { id: hold.id },
          data: { gatewayTransactionId: recovered.id },
        });
      }
      const intent = await gateway.release(hold.gatewayTransactionId, job.idempotencyKey);
      if (intent.state !== 'released' || intent.holdId !== hold.id)
        throw new Error('RELEASE_NOT_CONFIRMED');
      await db.$transaction([
        db.paymentHold.updateMany({
          where: { id: hold.id, status: { in: ['RELEASE_PENDING', 'EXPIRED', 'RELEASED'] } },
          data: { status: 'RELEASED' },
        }),
        db.transaction.update({
          where: { id: job.id },
          data: { status: 'SUCCEEDED', lockedAt: null },
        }),
      ]);
    } catch {
      await db.transaction.update({
        where: { id: job.id },
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
export async function reconcileHolds(gateway: PaymentGateway = stripeGateway) {
  const holds = await db.paymentHold.findMany({
    where: {
      status: { in: ['AUTHORIZED', 'PENDING_AUTHORIZATION'] },
      OR: [
        { expiresAt: { lte: new Date() } },
        { bid: null, createdAt: { lt: new Date(Date.now() - 15 * 60000) } },
      ],
    },
    take: 20,
    orderBy: { createdAt: 'asc' },
  });
  for (const hold of holds) {
    // Recover ambiguous intent creation before expiring an abandoned checkout.
    if (!hold.gatewayTransactionId) {
      if (Date.now() - hold.createdAt.getTime() > 23 * 3600000) {
        await db.paymentHold.update({ where: { id: hold.id }, data: { status: 'FAILED' } });
        continue;
      }
      const intent = await gateway.create(hold);
      await db.paymentHold.update({
        where: { id: hold.id },
        data: { gatewayTransactionId: intent.id },
      });
    }
    await syncHold(hold.id, undefined, gateway);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${hold.vehicleId} FOR UPDATE`;
      const current = await tx.paymentHold.findUniqueOrThrow({
        where: { id: hold.id },
        include: { bid: true },
      });
      if (
        !current.bid &&
        ['PENDING_AUTHORIZATION', 'AUTHORIZED', 'EXPIRED'].includes(current.status)
      ) {
        await tx.paymentHold.update({
          where: { id: hold.id },
          data: { status: 'RELEASE_PENDING' },
        });
        await tx.transaction.upsert({
          where: { idempotencyKey: `release:${hold.id}` },
          create: { holdId: hold.id, operation: 'RELEASE', idempotencyKey: `release:${hold.id}` },
          update: {},
        });
      }
    });
  }
  await db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } });
}

export async function handlePaymentEvent(
  event: Stripe.Event,
  gateway: PaymentGateway = stripeGateway,
) {
  if (
    ![
      'payment_intent.amount_capturable_updated',
      'payment_intent.canceled',
      'payment_intent.payment_failed',
      'payment_intent.succeeded',
    ].includes(event.type)
  )
    return;
  const receipt = await db.webhookEvent.upsert({
    where: { id: event.id },
    create: { id: event.id },
    update: {},
  });
  if (receipt.processedAt) return;
  const intent = event.data.object as { id: string; metadata?: Record<string, string> };
  const hold = await db.paymentHold.findUnique({ where: { gatewayTransactionId: intent.id } });
  if (!hold && intent.metadata?.holdId) throw new Error('HOLD_NOT_PERSISTED');
  if (hold) await syncHold(hold.id, undefined, gateway);
  await db.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
}
