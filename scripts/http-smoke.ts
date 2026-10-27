import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

async function main() {
  const database = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '');
  if (
    !process.env.TEST_DATABASE_URL &&
    ['127.0.0.1', 'localhost'].includes(database.hostname) &&
    database.pathname === '/autoveri'
  )
    database.pathname = '/autoveri_test';
  if (!database.pathname.endsWith('_test')) throw new Error('Isolated _test database required');
  process.env.DATABASE_URL = database.toString();
  const { db } = await import('../src/lib/db');
  const { legalTestFixture } = await import('./legal-test-fixture');
  const legalFixture = await legalTestFixture();
  const origin = 'http://localhost:3100';
  const uploads = path.resolve('.local/http-test-uploads');
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    windowsHide: true,
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LOCAL_TEST_PAYMENTS: 'true', // Must remain disabled in production despite opt-in.
      NEXTAUTH_URL: origin,
      NEXTAUTH_SECRET: randomBytes(48).toString('hex'),
      PORT: '3100',
      HOST: '127.0.0.1',
      UPLOAD_DIR: uploads,
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_VERIFY_SERVICE_SID: '',
      STRIPE_SECRET_KEY: '',
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
    },
  });
  // Consume output without logging cookies, provider payloads or configuration.
  server.stdout?.resume();
  server.stderr?.resume();
  const users: string[] = [];
  const vehicles: string[] = [];
  let photo: string | undefined;
  function client() {
    const cookies = new Map<string, string>();
    return async (route: string, init: RequestInit = {}) => {
      const response = await fetch(origin + route, {
        ...init,
        redirect: 'manual',
        headers: {
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          Origin: origin,
          ...init.headers,
        },
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        const at = pair.indexOf('=');
        cookies.set(pair.slice(0, at), pair.slice(at + 1));
      }
      return response;
    };
  }
  const post = (data: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const run = randomUUID();
  async function account(index: number) {
    const request = client();
    const email = `${run}-${index}@example.test`;
    const password = 'Long-smoke-password-123!';
    const registration = await request(
      '/api/register',
      post({
        email,
        password,
        phone: '+417' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0'),
        role: 'PRIVATE_USER',
        language: 'en',
        legal: legalFixture.input('en'),
      }),
    );
    assert.equal(registration.status, 201);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    users.push(user.id);
    const csrf = await (await request('/api/auth/csrf')).json();
    await request('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        csrfToken: csrf.csrfToken,
        email,
        password,
        callbackUrl: origin + '/dashboard',
        json: 'true',
      }),
    });
    assert.equal((await request('/api/account')).status, 200);
    return { id: user.id, request };
  }
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error('Smoke server exited');
      try {
        ready = (await fetch(origin + '/api/auth/providers')).ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Server startup');
    const anonymous = client();
    assert.equal((await (await anonymous('/api/local-test')).json()).enabled, false);
    assert.equal(
      (await anonymous('/api/local-test', post({ vehicleId: randomUUID() }))).status,
      404,
    );
    for (const route of [
      '/register',
      '/verify',
      '/login',
      '/',
      '/dashboard',
      '/admin',
      '/security',
      '/reset-password',
    ])
      assert.equal((await anonymous(route)).status, 200);
    const sellRedirect = await anonymous('/sell');
    assert.equal(sellRedirect.status, 307);
    assert.equal(sellRedirect.headers.get('location'), '/login?next=/sell');
    assert.equal((await anonymous('/api/vehicles', post({}))).status, 401);
    assert.equal((await anonymous('/api/payments/holds', post({}))).status, 401);
    const seller = await account(0);
    assert.equal((await seller.request('/sell')).status, 200);
    const admin = await account(1);
    assert.equal((await seller.request('/api/verification', post({ action: 'send' }))).status, 503);
    assert.equal((await seller.request('/api/admin/identities')).status, 403);
    assert.equal((await seller.request('/api/vehicles', post({}))).status, 403);
    console.log(
      'PASS HTTP registration, NextAuth session, role guards and missing SMS provider fail closed',
    );
    // Fixtures replace external identity evidence and SMS delivery; no runtime verification bypass exists.
    await db.user.update({ where: { id: seller.id }, data: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), } });
    await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    assert.equal(
      (
        await admin.request(
          '/api/admin/identities',
          post({ userId: seller.id, evidenceReference: `fixture:${run}` }),
        )
      ).status,
      200,
    );
    assert.equal((await (await seller.request('/api/verification')).json()).identityVerified, true);
    const image = new FormData();
    image.set(
      'photo',
      new File(
        [
          await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
            .png()
            .toBuffer(),
        ],
        'car.png',
        { type: 'image/png' },
      ),
    );
    const uploaded = await seller.request('/api/uploads', { method: 'POST', body: image });
    assert.equal(uploaded.status, 201);
    const { url } = await uploaded.json();
    photo = path.basename(url);
    assert.equal((await anonymous(url)).status, 404);
    assert.equal((await seller.request(url)).status, 200);
    const vin =
      'WBA' +
      run
        .replace(/[^0-9]/g, '')
        .padEnd(14, '1')
        .slice(0, 14);
    const input = {
      stammnummer: '123456789',
      vinChassis: vin,
      firstRegistration: '2020-01-01',
      make: 'Smoke',
      model: 'Alpine',
      mileage: 50000,
      canton: 'ZH',
      mfkDate: '2026-01-01',
      serviceHistory: 'FULL',
      tireCondition: 'Good',
      description: 'HTTP integration fixture',
      images: [url],
      listingType: 'AUCTION_7_DAYS',
      startPrice: '1000',
    };
    const created = await seller.request('/api/vehicles', post(input));
    assert.equal(created.status, 201);
    const vehicle = await created.json();
    vehicles.push(vehicle.id);
    assert.equal(vehicle.status, 'PENDING_VERIFICATION');
    const reviewed = await admin.request(
      '/api/admin',
      post({
        id: vehicle.id,
        action: 'approve',
        note: `fixture:${run}`,
        make: input.make,
        model: input.model,
        stammnummer: input.stammnummer,
        vinChassis: vin,
        firstRegistration: input.firstRegistration,
        mfkDate: input.mfkDate,
      }),
    );
    assert.equal(reviewed.status, 200);
    assert.equal((await anonymous(url)).status, 200);
    const detail = await (await anonymous(`/api/market/${vehicle.id}`)).json();
    assert.equal(detail.demo, false);
    assert.equal(detail.vehicle.status, 'ACTIVE');
    assert.ok(!JSON.stringify(detail).includes(vin));
    assert.equal(
      (
        await seller.request(
          '/api/payments/holds',
          post({ action: 'create', vehicleId: vehicle.id }),
        )
      ).status,
      503,
    );
    console.log(
      'PASS HTTP identity review, photo upload, listing creation, admin approval and masked public vehicle',
    );
    console.log('PASS missing Stripe configuration blocks checkout without authorizing funds');
    const buyer = await account(2);
    const hold = await db.paymentHold.create({
      data: {
        userId: buyer.id,
        vehicleId: vehicle.id,
        gateway: 'stripe',
        gatewayTransactionId: `pi_fixture_${run}`,
        status: 'AUTHORIZED',
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await db.bid.create({
      data: {
        userId: buyer.id,
        vehicleId: vehicle.id,
        holdId: hold.id,
        amount: '1000',
        requestId: randomUUID(),
      },
    });
    await db.vehicle.update({
      where: { id: vehicle.id },
      data: { auctionEndsAt: new Date(Date.now() - 1000), currentPrice: '1000' },
    });
    const { closeAuction } = await import('../src/lib/settlement');
    await closeAuction(vehicle.id);
    assert.equal((await anonymous('/api/settlements')).status, 401);
    const sale = (await (await seller.request('/api/settlements')).json()).settlements.find(
      (s: { vehicleId: string }) => s.vehicleId === vehicle.id,
    );
    assert.ok(sale.seller);
    assert.equal(
      (
        await buyer.request(
          '/api/settlements',
          post({ id: sale.id, action: 'confirm', note: 'Unauthorized buyer confirmation' }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await seller.request(
          '/api/settlements',
          post({ id: sale.id, action: 'confirm', note: 'Fixture handover and payment completed' }),
        )
      ).status,
      200,
    );
    assert.equal(
      (await db.settlement.findUniqueOrThrow({ where: { id: sale.id } })).status,
      'CAPTURE_PENDING',
    );
    assert.equal(
      (
        await admin.request(
          '/api/settlements',
          post({ id: sale.id, action: 'cancel', note: 'Cannot cancel an in-flight capture' }),
        )
      ).status,
      409,
    );
    console.log(
      'PASS HTTP settlement visibility, seller-only completion, queued capture and conflicting cancellation',
    );
    assert.equal((await anonymous('/api/offers')).status, 401);
    assert.equal((await anonymous('/api/disputes')).status, 401);
    const opened = await buyer.request(
      '/api/disputes',
      post({
        settlementId: sale.id,
        category: 'PAYMENT_ISSUE',
        message: 'HTTP fixture: payment dispute needs independent review.',
      }),
    );
    assert.equal(opened.status, 201);
    const dispute = await opened.json();
    assert.equal(
      (
        await seller.request('/api/disputes', {
          ...post({
            id: dispute.id,
            resolution: 'NO_ACTION',
            note: 'The seller cannot adjudicate their own dispute.',
          }),
          method: 'PATCH',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await admin.request('/api/disputes', {
          ...post({
            id: dispute.id,
            resolution: 'REFUND_REQUIRED',
            note: 'External refund action required; no funds moved by this test.',
          }),
          method: 'PATCH',
        })
      ).status,
      200,
    );
    const recovery = await buyer.request(
      '/api/security',
      post({ action: 'generate', currentPassword: 'Long-smoke-password-123!' }),
    );
    assert.equal(recovery.status, 200);
    const { codes } = await recovery.json();
    const buyerRecord = await db.user.findUniqueOrThrow({ where: { id: buyer.id } });
    assert.equal(
      (
        await anonymous(
          '/api/security',
          post({
            action: 'reset',
            email: buyerRecord.email,
            code: codes[0],
            password: 'Reset-smoke-password-123!',
          }),
        )
      ).status,
      200,
    );
    assert.equal((await buyer.request('/api/account')).status, 401);
    console.log(
      'PASS HTTP dispute roles, deferred refund status, recovery code reset and existing-session invalidation',
    );
  } finally {
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve();
      else {
        server.once('exit', () => resolve());
        setTimeout(resolve, 5000).unref();
      }
    });
    await db.dispute.deleteMany({ where: { settlement: { vehicleId: { in: vehicles } } } });
    await db.settlement.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.transaction.deleteMany({ where: { hold: { vehicleId: { in: vehicles } } } });
    await db.bid.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.paymentHold.deleteMany({ where: { vehicleId: { in: vehicles } } });
    await db.vehicle.deleteMany({ where: { id: { in: vehicles } } });
    await db.smsVerification.deleteMany({ where: { userId: { in: users } } });
    await db.legalAcceptance.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await legalFixture.cleanup();
    if (photo && /^[0-9a-f-]+\.(jpg|png)$/.test(photo)) await unlink(path.join(uploads, photo));
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
