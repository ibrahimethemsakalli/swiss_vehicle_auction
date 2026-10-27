import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PaymentGateway, Intent } from '../src/lib/payments';

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  if (url.pathname === '/autoveri') url.pathname = '/autoveri_test';
  assert.ok(url.pathname.endsWith('_test'));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import('../src/lib/db');
  const { syncHold } = await import('../src/lib/payments');
  const userId = randomUUID(),
    vehicleId = randomUUID(),
    holdId = randomUUID();
  try {
    await db.user.create({
      data: {
        id: userId,
        email: `${userId}@provider.test`,
        phone: userId,
        passwordHash: 'not-a-login-hash',
      },
    });
    await db.vehicle.create({
      data: {
        id: vehicleId,
        userId,
        make: 'OFFLINE PROVIDER FIXTURE',
        model: 'No auction execution',
        stammnummer: '123456789',
        vinChassis: randomUUID(),
        mileage: 0,
        canton: 'ZH',
        mfkDate: new Date(),
        serviceHistory: 'TEST',
        tireCondition: 'TEST',
        description: 'Disposable provider state test',
        images: [],
        listingType: 'AUCTION_7_DAYS',
        startPrice: 1000,
        status: 'ACTIVE',
      },
    });
    await db.paymentHold.create({
      data: {
        id: holdId,
        userId,
        vehicleId,
        gateway: 'stripe',
        gatewayTransactionId: `pi_${holdId}`,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    const value: Intent = {
      id: `pi_${holdId}`,
      holdId,
      userId,
      vehicleId,
      clientSecret: null,
      valid: true,
      state: 'failed',
    };
    const unused = async () => {
      throw Error('Unexpected operation');
    };
    const fake: PaymentGateway = {
      create: unused,
      capture: unused,
      release: unused,
      retrieve: async () => value,
    };
    assert.equal((await syncHold(holdId, userId, fake)).status, 'FAILED');
    value.state = 'authorized';
    value.expiresAt = new Date(Date.now() + 600000);
    assert.equal((await syncHold(holdId, userId, fake)).status, 'FAILED');
    console.log(
      'PASS: declined authorization persists FAILED and later notification cannot resurrect it; no bidding, capture or release executed.',
    );
  } finally {
    await db.paymentHold.deleteMany({ where: { id: holdId } });
    await db.vehicle.deleteMany({ where: { id: vehicleId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
