import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hash, compare } from 'bcryptjs';
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
  if (
    spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: process.env,
      stdio: 'pipe',
    }).status !== 0
  )
    throw new Error('Migration failed');
  const { db } = await import('../src/lib/db');
  const { generateRecoveryCodes, resetPassword, changePassword } = await import(
    '../src/lib/recovery'
  );
  const { createHold, syncHold, processReleases } = await import('../src/lib/payments');
  const { makeOffer, decideOffer, expireOffers } = await import('../src/lib/offers');
  const { openDispute, reviewDispute } = await import('../src/lib/disputes');
  const { actOnSettlement, processCaptures } = await import('../src/lib/settlement');
  type Intent = import('../src/lib/payments').Intent;
  type Gateway = import('../src/lib/payments').PaymentGateway;
  const users: string[] = [],
    vehicles: string[] = [];
  const intents = new Map<string, Intent>();
  let captures = 0;
  const gateway: Gateway = {
    async create(h) {
      const id = `pi_${h.id}`;
      if (!intents.has(id))
        intents.set(id, {
          id,
          holdId: h.id,
          vehicleId: h.vehicleId,
          userId: h.userId,
          clientSecret: 'fixture',
          state: 'pending',
          valid: true,
        });
      return { ...intents.get(id)! };
    },
    async retrieve(id) {
      return { ...intents.get(id)! };
    },
    async release(id) {
      const i = intents.get(id)!;
      i.state = 'released';
      return { ...i };
    },
    async capture(id, key) {
      captures++;
      const i = intents.get(id)!;
      i.state = 'captured';
      i.captureKey = key;
      return { ...i };
    },
  };
  const initialPassword = 'Long-initial-password-123!';
  const passwordHash = await hash(initialPassword, 12);
  async function user(role: 'PRIVATE_USER' | 'ADMIN' = 'PRIVATE_USER') {
    const id = randomUUID();
    users.push(id);
    return db.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        phone: `fixture-${id}`,
        passwordHash,
        role,
        phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(),
        isIdentityVerified: true,
      },
    });
  }
  async function vehicle(seller: string, sample = false) {
    const id = randomUUID();
    vehicles.push(id);
    return db.vehicle.create({
      data: {
        id,
        userId: seller,
        isSample: sample,
        stammnummer: '123456789',
        vinChassis: id,
        firstRegistration: new Date('2020-01-01'),
        make: 'Test',
        model: 'Fixed',
        mileage: 100,
        canton: 'ZH',
        mfkDate: new Date('2026-01-01'),
        serviceHistory: 'FULL',
        tireCondition: 'Good',
        description: 'Fixture',
        images: [],
        listingType: 'FIXED_PRICE_OFFERS',
        status: 'ACTIVE',
        startPrice: '1000',
        buyNowPrice: '2000',
      },
    });
  }
  async function offer(userId: string, vehicleId: string, amount = '1500') {
    const { holdId } = await createHold(userId, vehicleId, undefined, gateway);
    Object.assign(intents.get(`pi_${holdId}`)!, {
      state: 'authorized',
      expiresAt: new Date(Date.now() + 86400000),
    });
    await syncHold(holdId, userId, gateway);
    const input = { vehicleId, holdId, amount, requestId: randomUUID() };
    return { input, ...(await makeOffer(userId, input, gateway)) };
  }
  try {
    const seller = await user(),
      buyer = await user(),
      rival = await user(),
      admin = await user('ADMIN');
    await assert.rejects(() => generateRecoveryCodes(buyer.id, 'wrong-password'));
    const codes = await generateRecoveryCodes(buyer.id, initialPassword);
    assert.equal(codes.length, 5);
    assert.ok(
      !(await db.recoveryCode.findMany({ where: { userId: buyer.id } })).some((c) =>
        codes.includes(c.tokenHash),
      ),
    );
    await assert.rejects(() =>
      resetPassword({ email: rival.email, code: codes[0], password: 'New-valid-password-123!' }),
    );
    const attempts = await Promise.allSettled(
      [1, 2].map(() =>
        resetPassword({ email: buyer.email, code: codes[0], password: 'New-valid-password-123!' }),
      ),
    );
    assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1);
    const reset = await db.user.findUniqueOrThrow({ where: { id: buyer.id } });
    assert.equal(reset.authVersion, 1);
    assert.ok(await compare('New-valid-password-123!', reset.passwordHash));
    assert.equal(await db.recoveryCode.count({ where: { userId: buyer.id } }), 0);
    await assert.rejects(() =>
      resetPassword({ email: buyer.email, code: codes[1], password: 'Another-valid-password!' }),
    );
    await changePassword(buyer.id, {
      currentPassword: 'New-valid-password-123!',
      password: 'Final-valid-password-123!',
    });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: buyer.id } })).authVersion, 2);
    console.log(
      'PASS hashed recovery codes, account binding, concurrent single use, all-code revocation and password versioning',
    );
    const sample = await vehicle(seller.id, true);
    await assert.rejects(
      () => createHold(buyer.id, sample.id, undefined, gateway),
      /SAMPLE_READ_ONLY/,
    );
    console.log('PASS sample listings cannot initiate payment authorization');
    const car = await vehicle(seller.id);
    const first = await offer(buyer.id, car.id);
    const second = await offer(rival.id, car.id, '1600');
    assert.equal((await makeOffer(buyer.id, first.input, gateway)).id, first.id);
    await assert.rejects(() => decideOffer(buyer.id, first.id, 'accept', gateway), /FORBIDDEN/);
    const accepted = await Promise.allSettled(
      [first, second].map((o) => decideOffer(seller.id, o.id, 'accept', gateway)),
    );
    assert.equal(accepted.filter((r) => r.status === 'fulfilled').length, 1);
    const sale = await db.settlement.findUniqueOrThrow({
      where: { vehicleId: car.id },
      include: { bid: true },
    });
    assert.equal(await db.settlement.count({ where: { vehicleId: car.id } }), 1);
    await processReleases(gateway);
    const loser = sale.bidId === first.id ? second : first;
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: loser.input.holdId } })).status,
      'RELEASED',
    );
    console.log(
      'PASS private fixed-price offers, idempotency, seller-only acceptance, one winner under concurrency and losing hold release',
    );
    const withdrawalCar = await vehicle(seller.id);
    const withdrawn = await offer(buyer.id, withdrawalCar.id);
    await decideOffer(buyer.id, withdrawn.id, 'withdraw', gateway);
    await decideOffer(buyer.id, withdrawn.id, 'withdraw', gateway);
    await assert.rejects(() => decideOffer(seller.id, withdrawn.id, 'accept', gateway));
    const expiring = await offer(rival.id, withdrawalCar.id);
    await db.bid.update({ where: { id: expiring.id }, data: { offerExpiresAt: new Date(0) } });
    await expireOffers();
    await processReleases(gateway);
    assert.equal(
      (await db.bid.findUniqueOrThrow({ where: { id: expiring.id } })).status,
      'OFFER_EXPIRED',
    );
    console.log('PASS withdrawal and offer expiry prevent acceptance and release holds');
    const note = 'Detailed evidence for the local integration test';
    await assert.rejects(
      () => openDispute(admin.id, { settlementId: sale.id, category: 'OTHER', message: note }),
      /FORBIDDEN/,
    );
    const dispute = await openDispute(sale.bid.userId, {
      settlementId: sale.id,
      category: 'NO_HANDOVER',
      message: note,
    });
    await assert.rejects(
      () => actOnSettlement(seller.id, sale.id, 'confirm', note),
      /DISPUTE_OPEN/,
    );
    await assert.rejects(
      () => reviewDispute(seller.id, { id: dispute.id, resolution: 'NO_ACTION', note }),
      /FORBIDDEN/,
    );
    await reviewDispute(admin.id, { id: dispute.id, resolution: 'REFUND_REQUIRED', note });
    assert.equal(
      (await db.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status,
      'ACTION_REQUIRED',
    );
    assert.equal(captures, 0);
    await reviewDispute(admin.id, { id: dispute.id, resolution: 'MANUAL_RESOLUTION', note });
    await actOnSettlement(seller.id, sale.id, 'confirm', note);
    const pendingDispute = await openDispute(seller.id, {
      settlementId: sale.id,
      category: 'PAYMENT_ISSUE',
      message: note,
    });
    await processCaptures(gateway);
    assert.equal(captures, 0);
    await reviewDispute(admin.id, {
      id: pendingDispute.id,
      resolution: 'REFUND_REQUIRED',
      note,
    });
    await db.transaction.updateMany({
      where: { holdId: sale.bid.holdId },
      data: { nextAttemptAt: new Date(0) },
    });
    await processCaptures(gateway);
    assert.equal(captures, 0, 'Refund-required review must keep queued captures blocked');
    assert.equal(
      (await db.paymentHold.findUniqueOrThrow({ where: { id: sale.bid.holdId } })).status,
      'CAPTURE_PENDING',
    );
    await reviewDispute(admin.id, { id: pendingDispute.id, resolution: 'NO_ACTION', note });
    await db.transaction.updateMany({
      where: { holdId: sale.bid.holdId },
      data: { nextAttemptAt: new Date(0) },
    });
    await processCaptures(gateway);
    assert.equal(captures, 1);
    console.log(
      'PASS participant-only disputes, independent review, pending-capture pause, manual resolution and refund-required status without fake refund',
    );
  } finally {
    await db.dispute.deleteMany({ where: { settlement: { vehicleId: { in: vehicles } } } });
    await db.settlement.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.transaction.deleteMany({ where: { hold: { vehicleId: { in: vehicles } } } });
    await db.bid.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.paymentHold.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.vehicle.deleteMany({ where: { id: { in: vehicles } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
