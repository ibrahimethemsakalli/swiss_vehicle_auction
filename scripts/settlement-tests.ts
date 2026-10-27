import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '');
  if (
    !process.env.TEST_DATABASE_URL &&
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.pathname === '/autoveri'
  )
    url.pathname = '/autoveri_test';
  if (!url.pathname.endsWith('_test')) throw new Error('Isolated _test database required');
  process.env.DATABASE_URL = url.toString();
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, stdio: 'pipe' },
  );
  if (migration.status !== 0) throw new Error('Migration failed');
  const { db } = await import('../src/lib/db');
  const { closeAuction, actOnSettlement, processCaptures } = await import('../src/lib/settlement');
  const { createHold, syncHold, processReleases, handlePaymentEvent } = await import(
    '../src/lib/payments'
  );
  const { placeBid } = await import('../src/lib/bidding');
  type Intent = import('../src/lib/payments').Intent;
  type Gateway = import('../src/lib/payments').PaymentGateway;
  const run = randomUUID();
  const users: string[] = [];
  const vehicles: string[] = [];
  const events: string[] = [];
  const intents = new Map<string, Intent>();
  let captures = 0;
  let loseResponse = false;
  const gateway: Gateway = {
    async create(h) {
      const id = `pi_${h.id}`;
      if (!intents.has(id))
        intents.set(id, {
          id,
          holdId: h.id,
          userId: h.userId,
          vehicleId: h.vehicleId,
          state: 'pending',
          valid: true,
          clientSecret: 'test-only',
        });
      return { ...intents.get(id)! };
    },
    async retrieve(id) {
      return { ...intents.get(id)! };
    },
    async release(id) {
      const i = intents.get(id)!;
      if (i.state === 'captured') throw new Error('Already captured');
      i.state = 'released';
      return { ...i };
    },
    async capture(id, key) {
      const i = intents.get(id)!;
      assert.equal(i.state, 'authorized');
      captures++;
      i.state = 'captured';
      i.captureKey = key;
      if (loseResponse) {
        loseResponse = false;
        throw new Error('Response lost after capture');
      }
      return { ...i };
    },
  };
  async function user(role: 'PRIVATE_USER' | 'ADMIN' = 'PRIVATE_USER') {
    const id = randomUUID();
    users.push(id);
    return db.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        phone: `+41${id}`,
        passwordHash: 'fixture-disabled',
        role,
        phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(),
        isIdentityVerified: true,
      },
    });
  }
  async function auction(sellerId: string, buyerId?: string, reservePrice?: string) {
    const id = randomUUID();
    vehicles.push(id);
    await db.vehicle.create({
      data: {
        id,
        userId: sellerId,
        stammnummer: '123456789',
        vinChassis: id,
        firstRegistration: new Date('2020-01-01'),
        make: 'Settlement',
        model: 'Test',
        mileage: 100,
        canton: 'ZH',
        mfkDate: new Date('2026-01-01'),
        serviceHistory: 'FULL',
        tireCondition: 'Good',
        description: 'Test fixture',
        images: [],
        listingType: 'AUCTION_7_DAYS',
        status: 'ACTIVE',
        startPrice: '1000',
        reservePrice,
        auctionStartAt: new Date(Date.now() - 100000),
        auctionEndsAt: new Date(Date.now() + 600000),
      },
    });
    if (buyerId) {
      const { holdId } = await createHold(buyerId, id, undefined, gateway);
      Object.assign(intents.get(`pi_${holdId}`)!, {
        state: 'authorized',
        expiresAt: new Date(Date.now() + 86400000),
      });
      await placeBid(
        buyerId,
        { vehicleId: id, holdId, amount: '1000', requestId: randomUUID() },
        gateway,
      );
    }
    return id;
  }
  async function end(id: string) {
    await db.vehicle.update({
      where: { id },
      data: { auctionEndsAt: new Date(Date.now() - 1000) },
    });
    await Promise.all([closeAuction(id), closeAuction(id)]);
    return db.settlement.findUnique({ where: { vehicleId: id }, include: { bid: true } });
  }
  const reason = `Reviewed evidence ${run}`;
  try {
    const seller = await user();
    const buyer = await user();
    const admin = await user('ADMIN');
    const outsider = await user();
    const empty = await auction(seller.id);
    assert.equal(await end(empty), null);
    assert.equal((await db.vehicle.findUniqueOrThrow({ where: { id: empty } })).status, 'EXPIRED');
    const reserve = await auction(seller.id, buyer.id, '2000');
    assert.equal(await end(reserve), null);
    await processReleases(gateway);
    assert.equal(
      (await db.paymentHold.findFirstOrThrow({ where: { vehicleId: reserve } })).status,
      'RELEASED',
    );
    console.log(
      'PASS no-bid and reserve-not-met auctions expire and release holds without capture',
    );
    const id = await auction(seller.id, buyer.id, '1000');
    await closeAuction(id);
    assert.equal(await db.settlement.count({ where: { vehicleId: id } }), 0);
    const sale = (await end(id))!;
    assert.equal(sale.bid.status, 'WON');
    assert.equal(await db.settlement.count({ where: { vehicleId: id } }), 1);
    await assert.rejects(() =>
      placeBid(
        buyer.id,
        { vehicleId: id, holdId: sale.bid.holdId, amount: '1200', requestId: randomUUID() },
        gateway,
      ),
    );
    await assert.rejects(
      () => actOnSettlement(outsider.id, sale.id, 'confirm', reason),
      /FORBIDDEN/,
    );
    await assert.rejects(
      () => actOnSettlement(buyer.id, sale.id, 'approve_default', reason),
      /FORBIDDEN/,
    );
    console.log(
      'PASS closer rechecks deadline under lock, closes once, selects reserve-equal winner and rejects late bids/unauthorized decisions',
    );
    await Promise.all([
      actOnSettlement(seller.id, sale.id, 'confirm', reason),
      actOnSettlement(seller.id, sale.id, 'confirm', reason),
    ]);
    assert.equal(
      await db.transaction.count({ where: { holdId: sale.bid.holdId, operation: 'CAPTURE_FEE' } }),
      1,
    );
    assert.equal((await db.vehicle.findUniqueOrThrow({ where: { id } })).status, 'EXPIRED');
    await assert.rejects(() => actOnSettlement(admin.id, sale.id, 'cancel', reason), /CONFLICT/);
    loseResponse = true;
    await processCaptures(gateway);
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: sale.id } })).status,
      'CAPTURE_PENDING',
    );
    await db.transaction.updateMany({
      where: { holdId: sale.bid.holdId },
      data: { nextAttemptAt: new Date(0) },
    });
    await processCaptures(gateway);
    await processCaptures(gateway);
    assert.equal(captures, 1);
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: sale.id } })).status,
      'COMPLETED',
    );
    assert.equal((await db.vehicle.findUniqueOrThrow({ where: { id } })).status, 'SOLD');
    await actOnSettlement(seller.id, sale.id, 'confirm', reason);
    console.log(
      'PASS duplicate sale confirmations capture once; lost response recovers without double charging; sale marked sold only after confirmation',
    );
    const defaultId = await auction(seller.id, buyer.id);
    const defaultSale = (await end(defaultId))!;
    await actOnSettlement(seller.id, defaultSale.id, 'report_default', reason);
    assert.equal(captures, 1);
    await assert.rejects(
      () => actOnSettlement(seller.id, defaultSale.id, 'approve_default', reason),
      /FORBIDDEN/,
    );
    await actOnSettlement(admin.id, defaultSale.id, 'dismiss_default', reason);
    await actOnSettlement(seller.id, defaultSale.id, 'report_default', reason);
    await actOnSettlement(admin.id, defaultSale.id, 'approve_default', reason);
    await processCaptures(gateway);
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: defaultSale.id } })).status,
      'DEFAULTED',
    );
    assert.equal(
      (await db.bid.findUniqueOrThrow({ where: { id: defaultSale.bidId } })).status,
      'DEFAULTED_PENALIZED',
    );
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: defaultSale.bid.holdId } })).status,
      'CAPTURED_COMPENSATION',
    );
    console.log(
      'PASS default report requires independent admin review; dismissal and compensation capture transitions',
    );
    const cancelId = await auction(seller.id, buyer.id);
    const cancelSale = (await end(cancelId))!;
    await actOnSettlement(admin.id, cancelSale.id, 'cancel', reason);
    await actOnSettlement(admin.id, cancelSale.id, 'cancel', reason);
    await processReleases(gateway);
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: cancelSale.bid.holdId } })).status,
      'RELEASED',
    );
    await assert.rejects(
      () => actOnSettlement(seller.id, cancelSale.id, 'confirm', reason),
      /CONFLICT/,
    );
    console.log('PASS cancellation releases winning hold and blocks later fee capture');
    const expiryId = await auction(seller.id, buyer.id);
    const expirySale = (await end(expiryId))!;
    await actOnSettlement(seller.id, expirySale.id, 'confirm', reason);
    intents.get(`pi_${expirySale.bid.holdId}`)!.state = 'pending';
    await processCaptures(gateway);
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: expirySale.id } })).status,
      'CAPTURE_PENDING',
    );
    intents.get(`pi_${expirySale.bid.holdId}`)!.state = 'authorized';
    await db.transaction.updateMany({
      where: { holdId: expirySale.bid.holdId },
      data: { nextAttemptAt: new Date(0) },
    });
    intents.get(`pi_${expirySale.bid.holdId}`)!.expiresAt = new Date(0);
    await processCaptures(gateway);
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: expirySale.id } })).status,
      'PAYMENT_FAILED',
    );
    const replacement = await createHold(buyer.id, expiryId, expirySale.bidId, gateway);
    Object.assign(intents.get(`pi_${replacement.holdId}`)!, {
      state: 'authorized',
      expiresAt: new Date(Date.now() + 86400000),
    });
    await syncHold(replacement.holdId, buyer.id, gateway);
    await processReleases(gateway);
    await actOnSettlement(admin.id, expirySale.id, 'retry', reason);
    await processCaptures(gateway);
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: expirySale.id } })).status,
      'COMPLETED',
    );
    console.log(
      'PASS expired winning authorization fails safely, renews after auction end and retries on replacement hold',
    );
    const hookId = await auction(seller.id, buyer.id);
    const hookSale = (await end(hookId))!;
    await actOnSettlement(seller.id, hookSale.id, 'confirm', reason);
    Object.assign(intents.get(`pi_${hookSale.bid.holdId}`)!, {
      state: 'captured',
      captureKey: `capture:${hookSale.bid.holdId}`,
    });
    const eventId = `evt_${randomUUID()}`;
    events.push(eventId);
    const event = {
      id: eventId,
      type: 'payment_intent.succeeded',
      data: { object: { id: `pi_${hookSale.bid.holdId}` } },
    } as import('stripe').default.Event;
    await handlePaymentEvent(event, gateway);
    await handlePaymentEvent(event, gateway);
    await processCaptures(gateway);
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: hookSale.id } })).status,
      'COMPLETED',
    );
    const badId = await auction(seller.id, buyer.id);
    const badSale = (await end(badId))!;
    await actOnSettlement(seller.id, badSale.id, 'confirm', reason);
    intents.get(`pi_${badSale.bid.holdId}`)!.state = 'captured';
    await processCaptures(gateway);
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: badSale.bid.holdId } })).status,
      'CAPTURED_UNEXPECTED',
    );
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: badSale.id } })).status,
      'PAYMENT_FAILED',
    );
    console.log(
      'PASS webhook recovery and duplicate delivery; unrecognized captures require manual review',
    );
    // One continuous two-buyer journey through the actual application services.
    const journeyId = await auction(seller.id, buyer.id);
    const losingHold = await db.paymentHold.findFirstOrThrow({
      where: { vehicleId: journeyId, userId: buyer.id },
    });
    const challenger = await user();
    const { holdId: winningHoldId } = await createHold(
      challenger.id,
      journeyId,
      undefined,
      gateway,
    );
    Object.assign(intents.get(`pi_${winningHoldId}`)!, {
      state: 'authorized',
      expiresAt: new Date(Date.now() + 86400000),
    });
    const deadline = new Date(Date.now() + 120000);
    await db.vehicle.update({ where: { id: journeyId }, data: { auctionEndsAt: deadline } });
    await placeBid(
      challenger.id,
      { vehicleId: journeyId, holdId: winningHoldId, amount: '1100', requestId: randomUUID() },
      gateway,
    );
    assert.equal(
      (await db.vehicle.findUniqueOrThrow({ where: { id: journeyId } })).auctionEndsAt!.getTime(),
      deadline.getTime() + 120000,
    );
    await processReleases(gateway);
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: losingHold.id } })).status,
      'RELEASED',
    );
    const journeySale = (await end(journeyId))!;
    assert.equal(journeySale.bid.userId, challenger.id);
    assert.equal(journeySale.bid.amount.toString(), '1100');
    assert.equal(journeySale.status, 'AWAITING_CONFIRMATION');
    const capturesBeforeJourney = captures;
    await actOnSettlement(seller.id, journeySale.id, 'confirm', reason);
    await processCaptures(gateway);
    await processCaptures(gateway);
    const finalHold = await db.paymentHold.findUniqueOrThrow({ where: { id: winningHoldId } });
    assert.equal(finalHold.amount.toString(), '30');
    assert.equal(finalHold.currency, 'CHF');
    assert.equal(finalHold.status, 'CAPTURED_FEE');
    assert.equal(captures, capturesBeforeJourney + 1);
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: journeySale.id } })).status,
      'COMPLETED',
    );
    assert.equal((await db.vehicle.findUniqueOrThrow({ where: { id: journeyId } })).status, 'SOLD');
    console.log(
      'PASS continuous journey: two buyers → anti-sniping → losing hold released → winner selected → seller confirmation → one CHF 30 fee → SOLD/COMPLETED',
    );
  } finally {
    await db.webhookEvent.deleteMany({ where: { id: { in: events } } });
    await db.settlement.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.transaction.deleteMany({ where: { hold: { vehicleId: { in: vehicles } } } });
    await db.bid.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.paymentHold.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.auctionLog.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.vehicle.deleteMany({ where: { id: { in: vehicles } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
