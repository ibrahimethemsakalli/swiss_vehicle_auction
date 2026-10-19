import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '');
  if (!process.env.TEST_DATABASE_URL) {
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/autoveri')
      throw new Error('Set TEST_DATABASE_URL to an isolated database ending in _test');
    url.pathname = '/autoveri_test';
  }
  if (!url.pathname.endsWith('_test'))
    throw new Error('Integration database name must end in _test');
  process.env.DATABASE_URL = url.toString();
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, stdio: 'pipe' },
  );
  if (migrated.status !== 0) throw new Error('Test database migrations failed');
  const { db } = await import('../src/lib/db');
  const { register } = await import('../src/lib/registration');
  const { sendSms, checkSms } = await import('../src/lib/sms');
  const { approveIdentity } = await import('../src/lib/identity');
  const { createVehicle } = await import('../src/lib/vehicles');
  const { createHold, syncHold, processReleases, reconcileHolds, handlePaymentEvent } =
    await import('../src/lib/payments');
  const { placeBid } = await import('../src/lib/bidding');
  type Intent = import('../src/lib/payments').Intent;
  type Gateway = import('../src/lib/payments').PaymentGateway;
  const run = randomUUID();
  const users: string[] = [];
  const vehicles: string[] = [];
  const intents = new Map<string, Intent>();
  let failRelease = false;
  const gateway: Gateway = {
    async capture(id, key) {
      const intent = intents.get(id)!;
      intent.state = 'captured';
      intent.captureKey = key;
      return { ...intent };
    },
    async create(hold) {
      const id = `pi_${hold.id}`;
      if (!intents.has(id))
        intents.set(id, {
          id,
          clientSecret: `secret_${hold.id}`,
          holdId: hold.id,
          userId: hold.userId,
          vehicleId: hold.vehicleId,
          valid: true,
          state: 'pending',
        });
      return { ...intents.get(id)! };
    },
    async retrieve(id) {
      const intent = intents.get(id);
      if (!intent) throw new Error('Missing test intent');
      return { ...intent };
    },
    async release(id) {
      if (failRelease) throw new Error('Simulated provider failure');
      const intent = intents.get(id)!;
      intent.state = 'released';
      return { ...intent };
    },
  };
  const sms = {
    async send() {
      return 'VE' + 'a'.repeat(32);
    },
    async check(_sid: string, code: string) {
      return code === '123456';
    },
  };
  let count = 0;
  const pass = (label: string) => {
    count++;
    console.log(`PASS ${label}`);
  };
  async function account(index: number) {
    const phone = '+417' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
    const user = await register({
      email: `${run}-${index}@example.test`,
      password: 'Long-test-password-123!',
      phone,
      language: 'en',
      role: 'PRIVATE_USER',
    });
    users.push(user.id);
    return user.id;
  }
  async function authorize(userId: string, vehicleId: string, replacementBidId?: string) {
    const hold = await createHold(userId, vehicleId, replacementBidId, gateway);
    Object.assign(intents.get(`pi_${hold.holdId}`)!, {
      state: 'authorized',
      expiresAt: new Date(Date.now() + 86400000),
    });
    await syncHold(hold.holdId, userId, gateway);
    return hold.holdId;
  }
  try {
    const admin = await account(0);
    const seller = await account(1);
    const buyer = await account(2);
    const rival = await account(3);
    await assert.rejects(() =>
      register({
        email: 'bad@example.test',
        password: 'Long-test-password-123!',
        phone: '+41791234567',
        language: 'en',
        role: 'ADMIN',
      }),
    );
    await assert.rejects(() =>
      register({
        email: `${run}-1@example.test`,
        password: 'Long-test-password-123!',
        phone: '+41791234567',
        language: 'en',
        role: 'PRIVATE_USER',
      }),
    );
    pass('registration validates roles and prevents duplicate accounts');
    await db.user.update({ where: { id: admin }, data: { role: 'ADMIN' } });
    for (const id of [seller, buyer, rival]) {
      await sendSms(id, sms);
      await assert.rejects(() => sendSms(id, sms), /RATE_LIMITED/);
      await assert.rejects(() => checkSms(id, '000000', sms));
      await checkSms(id, '123456', sms);
      await assert.rejects(() => checkSms(id, '123456', sms));
      assert.equal((await db.user.findUniqueOrThrow({ where: { id } })).isIdentityVerified, false);
      await approveIdentity(admin, id, `test-evidence:${run}`);
    }
    await assert.rejects(() => approveIdentity(buyer, admin, `test-evidence:${run}`), /FORBIDDEN/);
    pass('SMS cooldown, incorrect code and replay protection; separate admin identity approval');
    const input = {
      stammnummer: '123456789',
      vinChassis:
        'WBA' +
        run
          .replace(/[^0-9]/g, '')
          .padEnd(14, '0')
          .slice(0, 14),
      firstRegistration: '2020-01-01',
      make: 'Test',
      model: 'Alpine',
      mileage: 50000,
      canton: 'ZH',
      mfkDate: '2026-01-01',
      serviceHistory: 'FULL',
      tireCondition: 'Good',
      description: 'Integration fixture',
      images: ['https://example.test/car.jpg'],
      listingType: 'AUCTION_7_DAYS',
      startPrice: '1000',
    };
    await assert.rejects(() => createVehicle(admin, input), /VERIFICATION_REQUIRED/);
    const vehicle = await createVehicle(seller, input);
    vehicles.push(vehicle.id);
    const pending = await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    assert.equal(pending.status, 'PENDING_VERIFICATION');
    assert.equal(
      pending.auctionEndsAt!.getTime() - pending.auctionStartAt!.getTime(),
      7 * 86400000,
    );
    // Listing review endpoint owns activation; fixture activates to isolate the bidding tests.
    const end = new Date(Date.now() + 100000);
    await db.vehicle.update({
      where: { id: vehicle.id },
      data: { status: 'ACTIVE', auctionStartAt: new Date(Date.now() - 10000), auctionEndsAt: end },
    });
    pass('verified seller creates pending listing with exactly seven days');
    await assert.rejects(() => createHold(seller, vehicle.id, undefined, gateway));
    const pendingHold = await createHold(buyer, vehicle.id, undefined, gateway);
    const repeated = await createHold(buyer, vehicle.id, undefined, gateway);
    assert.equal(pendingHold.holdId, repeated.holdId);
    await assert.rejects(() =>
      placeBid(
        buyer,
        {
          vehicleId: vehicle.id,
          holdId: pendingHold.holdId,
          requestId: randomUUID(),
          amount: '1000',
        },
        gateway,
      ),
    );
    const buyerHold = await authorize(buyer, vehicle.id);
    const rivalHold = await authorize(rival, vehicle.id);
    await assert.rejects(
      () =>
        placeBid(
          rival,
          { vehicleId: vehicle.id, holdId: buyerHold, requestId: randomUUID(), amount: '1000' },
          gateway,
        ),
      /FORBIDDEN/,
    );
    pass('pending and foreign holds rejected; checkout retries reuse one intent');
    const requests = [buyer, rival].map((userId, i) => ({
      userId,
      input: {
        vehicleId: vehicle.id,
        holdId: [buyerHold, rivalHold][i],
        requestId: randomUUID(),
        amount: '1000',
      },
    }));
    const results = await Promise.allSettled(
      requests.map((r) => placeBid(r.userId, r.input, gateway)),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const winnerIndex = results.findIndex((r) => r.status === 'fulfilled');
    const winning = requests[winnerIndex];
    const losing = requests[1 - winnerIndex];
    assert.equal(
      (await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).auctionEndsAt!.getTime(),
      end.getTime() + 120000,
    );
    const repeat = await placeBid(winning.userId, winning.input, gateway);
    assert.equal(await db.bid.count({ where: { vehicleId: vehicle.id } }), 1);
    await assert.rejects(
      () => placeBid(winning.userId, { ...winning.input, amount: '1001' }, gateway),
      /IDEMPOTENCY_CONFLICT/,
    );
    pass(
      'concurrent minimum bids serialize; anti-sniping adds 120 seconds; retries do not duplicate',
    );
    await placeBid(losing.userId, { ...losing.input, amount: '1100' }, gateway);
    failRelease = true;
    await processReleases(gateway);
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: winning.input.holdId } })).status,
      'RELEASE_PENDING',
    );
    failRelease = false;
    await db.transaction.updateMany({
      where: { holdId: winning.input.holdId },
      data: { nextAttemptAt: new Date(0) },
    });
    await processReleases(gateway);
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: winning.input.holdId } })).status,
      'RELEASED',
    );
    await syncHold(winning.input.holdId, winning.userId, gateway);
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: winning.input.holdId } })).status,
      'RELEASED',
    );
    pass('outbid release survives provider failure and duplicate reconciliation');
    const webhookId = `evt_${run}`;
    const oldEvent = {
      id: webhookId,
      type: 'payment_intent.amount_capturable_updated',
      data: {
        object: {
          id: `pi_${winning.input.holdId}`,
          metadata: { holdId: winning.input.holdId },
          status: 'requires_capture',
        },
      },
    } as unknown as Stripe.Event;
    await handlePaymentEvent(oldEvent, gateway);
    await handlePaymentEvent(oldEvent, gateway);
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: winning.input.holdId } })).status,
      'RELEASED',
    );
    assert.ok((await db.webhookEvent.findUniqueOrThrow({ where: { id: webhookId } })).processedAt);
    await db.webhookEvent.delete({ where: { id: webhookId } });
    const stripe = new Stripe('sk_test_local_signature_only');
    const payload = JSON.stringify(oldEvent);
    const secret = 'whsec_local_test_only';
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    assert.equal(stripe.webhooks.constructEvent(payload, header, secret).id, webhookId);
    assert.throws(() => stripe.webhooks.constructEvent(payload + ' ', header, secret));
    pass(
      'signed webhook validation, duplicate delivery and stale events cannot resurrect a released hold',
    );
    const activeBid = await db.bid.findFirstOrThrow({
      where: { vehicleId: vehicle.id, status: 'ACTIVE' },
    });
    const renewed = await authorize(losing.userId, vehicle.id, activeBid.id);
    assert.equal((await db.bid.findUniqueOrThrow({ where: { id: activeBid.id } })).holdId, renewed);
    await processReleases(gateway);
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: losing.input.holdId } })).status,
      'RELEASED',
    );
    pass('authorization renewal swaps the active bid hold and releases the previous hold');
    const expiring = await createHold(winning.userId, vehicle.id, undefined, gateway);
    Object.assign(intents.get(`pi_${expiring.holdId}`)!, {
      state: 'authorized',
      expiresAt: new Date(Date.now() - 1000),
    });
    await syncHold(expiring.holdId, winning.userId, gateway);
    await assert.rejects(() =>
      placeBid(
        winning.userId,
        { ...winning.input, requestId: randomUUID(), holdId: expiring.holdId, amount: '1200' },
        gateway,
      ),
    );
    pass('expired Stripe authorization cannot back a bid');
    const abandoned = await createHold(winning.userId, vehicle.id, undefined, gateway);
    await db.paymentHold.update({
      where: { id: abandoned.holdId },
      data: { createdAt: new Date(Date.now() - 16 * 60000) },
    });
    await reconcileHolds(gateway);
    await processReleases(gateway);
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: abandoned.holdId } })).status,
      'RELEASED',
    );
    pass('abandoned checkout cancellation');
    assert.ok(repeat.bidId);
    console.log(
      `${count} integration scenarios passed using real PostgreSQL and injected SMS/payment simulators.`,
    );
  } finally {
    await db.settlement.deleteMany({ where: { vehicleId: { in: vehicles } } });
    // Only this run's fixtures are removed, never application data or a database reset.
    await db.transaction.deleteMany({ where: { hold: { userId: { in: users } } } });
    await db.bid.deleteMany({ where: { userId: { in: users } } });
    await db.paymentHold.deleteMany({ where: { userId: { in: users } } });
    await db.auctionLog.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.vehicle.deleteMany({ where: { id: { in: vehicles } } });
    await db.smsVerification.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
