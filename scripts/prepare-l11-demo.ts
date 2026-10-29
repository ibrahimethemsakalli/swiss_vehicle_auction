import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hash, compare } from 'bcryptjs';
import { Pool } from 'pg';
import { createDatabaseClient } from '../src/lib/database-client';
import { RefundDecisions } from '../src/lib/refund-decisions';
import { approvedRefundPolicy } from '../src/lib/refund-policy';
import type { RefundActor, RefundCapture } from '../src/lib/refund-domain';

const url = new URL(process.env.DATABASE_URL ?? '');
assert.ok(process.env.NODE_ENV !== 'production');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/autoveri');
assert.equal(process.env.LOCAL_TEST_PAYMENTS, 'true');
assert.equal(process.env.LOCAL_TEST_MESSAGES, 'true');
assert.equal(process.env.LOCAL_REFUND_POLICY_WORKER, 'true');
assert.ok(!process.env.STRIPE_SECRET_KEY);
// This preparation has no provider or HTTP dependency.
globalThis.fetch = async () => {
  throw Error('NETWORK_FORBIDDEN');
};
const db = createDatabaseClient(url.toString());
const pool = new Pool({ connectionString: url.toString() });
const manifestPath = '.local/l11-demo.json',
  credentialsPath = '.local/l11-demo-logins.json';
const saved = JSON.parse(readFileSync('.local/test-logins.json', 'utf8')) as {
  email: string;
  password: string;
  role: string;
}[];
const adminEmail = 'admin@local.autoveri.test',
  secondEmail = 'l11-admin2@local.autoveri.test';
const buyerEmail = 'private_user@local.autoveri.test',
  sellerEmail = 'dealer@local.autoveri.test';
try {
  const [admin, buyer, seller] = await Promise.all(
    [adminEmail, buyerEmail, sellerEmail].map((email) =>
      db.user.findUniqueOrThrow({ where: { email } }),
    ),
  );
  for (const [u, role, phone] of [
    [admin, 'ADMIN', 'LOCAL-LOGIN-2'],
    [buyer, 'PRIVATE_USER', 'LOCAL-LOGIN-0'],
    [seller, 'DEALER', 'LOCAL-LOGIN-1'],
  ] as const) {
    assert.equal(u.role, role);
    assert.equal(u.phone, phone);
    assert.equal(u.suspendedAt, null);
    assert.equal(u.isSample, false);
  }
  const existingAdmin = saved.find((x) => x.email === adminEmail)!;
  const existingBuyer = saved.find((x) => x.email === buyerEmail)!;
  assert.ok(existingAdmin && (await compare(existingAdmin.password, admin.passwordHash)));
  assert.ok(existingBuyer && (await compare(existingBuyer.password, buyer.passwordHash)));
  if (!existsSync(manifestPath)) {
    assert.equal(
      await db.user.count({ where: { email: secondEmail } }),
      0,
      'Do not reset an existing account',
    );
    assert.ok(!existsSync(credentialsPath), 'Preserve existing local credentials');
    writeFileSync(
      credentialsPath,
      JSON.stringify(
        [
          existingAdmin,
          { role: 'ADMIN', email: secondEmail, password: randomBytes(18).toString('base64url') },
          existingBuyer,
        ],
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          synthetic: true,
          vehicleId: randomUUID(),
          holdId: randomUUID(),
          captureId: randomUUID(),
          captureRef: 'l11_demo_' + randomUUID(),
          requestId: randomUUID(),
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.synthetic, true);
  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')) as typeof saved;
  const secondCredentials = credentials.find((x) => x.email === secondEmail)!;
  assert.ok(secondCredentials?.password);
  const passwordHash = await hash(secondCredentials.password, 12);
  const reason =
    'LOCAL E2E TEST L11: synthetic CHF 30 platform fee refund request. No real charge or provider evidence. Please review this local demonstration only.';
  const capabilities: RefundActor['capabilities'] = [
    'refund.review',
    'refund.execute',
    'payment.reconcile',
  ];
  const second = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('l11-demo-preparation',0))`;
    let a = await tx.user.findUnique({ where: { email: secondEmail } });
    if (!a)
      a = await tx.user.create({
        data: {
          email: secondEmail,
          phone: 'LOCAL-L11-ADMIN-2',
          role: 'ADMIN',
          passwordHash,
          emailVerifiedAt: new Date(),
          phoneVerifiedAt: new Date(),
          isIdentityVerified: true,
        },
      });
    assert.equal(a.phone, 'LOCAL-L11-ADMIN-2');
    assert.equal(a.role, 'ADMIN');
    assert.equal(a.suspendedAt, null);
    assert.equal(a.isSample, false);
    assert.ok(await compare(secondCredentials.password, a.passwordHash));
    const current = await tx.refundRuntimePolicy.findUnique({ where: { id: 'active' } });
    const actors = (current?.actors ?? []) as unknown as RefundActor[];
    assert.ok(Array.isArray(actors));
    const merged = actors.filter((x) => ![admin.id, a.id].includes(x.id));
    for (const id of [admin.id, a.id]) {
      const previous = actors.find((x) => x.id === id);
      merged.push({
        id,
        active: true,
        capabilities: [...new Set([...(previous?.capabilities ?? []), ...capabilities])],
      });
    }
    await tx.refundRuntimePolicy.upsert({
      where: { id: 'active' },
      create: {
        id: 'active',
        policy: approvedRefundPolicy,
        actors: JSON.parse(JSON.stringify(merged)),
      },
      update: { policy: approvedRefundPolicy, actors: JSON.parse(JSON.stringify(merged)) },
    });
    const vehicle = await tx.vehicle.findUnique({ where: { id: manifest.vehicleId } });
    if (!vehicle)
      await tx.vehicle.create({
        data: {
          id: manifest.vehicleId,
          userId: seller.id,
          stammnummer: 'LOCAL-L11-' + manifest.vehicleId,
          vinChassis: 'LOCAL-L11-' + manifest.vehicleId,
          make: 'L11 DEMO',
          model: 'SYNTHETIC ONLY',
          mileage: 0,
          mfkDate: new Date(),
          canton: 'ZH',
          serviceHistory: 'Local synthetic fixture; unverified',
          tireCondition: 'Unknown — local fixture',
          description:
            'LOCAL E2E TEST L11 refund preparation. Synthetic data, not a real vehicle or sale.',
          images: [],
          listingType: 'AUCTION_7_DAYS',
          startPrice: 100,
          status: 'SOLD',
        },
      });
    else
      assert.equal(
        vehicle.description,
        'LOCAL E2E TEST L11 refund preparation. Synthetic data, not a real vehicle or sale.',
      );
    const hold = await tx.paymentHold.findUnique({ where: { id: manifest.holdId } });
    if (!hold)
      await tx.paymentHold.create({
        data: {
          id: manifest.holdId,
          userId: buyer.id,
          vehicleId: manifest.vehicleId,
          gateway: 'fake',
          gatewayTransactionId: manifest.captureRef,
          status: 'CAPTURED_FEE',
          amount: 30,
          currency: 'CHF',
          expiresAt: new Date('2000-01-01T00:00:00Z'),
        },
      });
    else {
      assert.equal(hold.gateway, 'fake');
      assert.equal(hold.vehicleId, manifest.vehicleId);
      assert.equal(hold.userId, buyer.id);
    }
    const snapshot: RefundCapture = {
      scope: { provider: 'fake', merchant: 'LOCAL-L11-DEMO-NOT-A-MERCHANT', environment: 'test' },
      captureRef: manifest.captureRef,
      currency: 'CHF',
      amountMinor: 3000,
      confirmed: true,
      participantIds: [buyer.id, seller.id],
      version: 0,
      blocked: false,
      operations: [],
      evidence: [],
      findings: [],
    };
    if (!(await tx.refundCaptureState.findUnique({ where: { id: manifest.captureId } }))) {
      await tx.refundCaptureState.create({
        data: {
          id: manifest.captureId,
          scopeKey: JSON.stringify(['fake', snapshot.scope.merchant, 'test']),
          captureRef: manifest.captureRef,
          version: 0,
          snapshot: JSON.parse(JSON.stringify(snapshot)),
        },
      });
      await tx.refundStateEvent.create({
        data: {
          captureId: manifest.captureId,
          version: 0,
          kind: 'REGISTER_LOCAL_DEMO',
          snapshot: JSON.parse(JSON.stringify(snapshot)),
        },
      });
      await tx.refundCaptureBinding.create({
        data: { captureId: manifest.captureId, holdId: manifest.holdId },
      });
    }
    return a;
  });
  const service = new RefundDecisions(pool);
  const request = await service.request(buyer.id, {
    captureId: manifest.captureId,
    requestId: manifest.requestId,
    reason,
  });
  const views = [];
  for (const a of [admin, second]) {
    const list = await service.list(a.id, true, 1),
      detail = await service.read(a.id, request.id);
    assert.equal(list.policyReady, true);
    assert.ok(list.cases.some((c) => c.id === request.id));
    assert.equal(detail.canManage, true);
    assert.equal(detail.evidenceReady, false);
    assert.equal(detail.status, 'REQUESTED');
    views.push({ email: a.email, canManage: detail.canManage, canReview: detail.canReview });
  }
  const buyerView = await service.read(buyer.id, request.id);
  assert.equal(buyerView.amountMinor, 3000);
  assert.equal(await db.refundDecision.count({ where: { caseId: request.id } }), 0);
  assert.equal(await db.refundCommandState.count({ where: { captureId: manifest.captureId } }), 0);
  assert.equal(await db.refundReceipt.count({ where: { captureId: manifest.captureId } }), 0);
  const result = {
    ...manifest,
    caseId: request.id,
    status: request.status,
    adminIds: [admin.id, second.id],
    buyerId: buyer.id,
    sellerId: seller.id,
    capabilities,
    authority: 'User explicitly authorised two local example administrators',
    verifiedAt: new Date().toISOString(),
    views,
    paymentCommands: 0,
    refundReceipts: 0,
    decisionCount: 0,
  };
  writeFileSync(manifestPath, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      caseId: request.id,
      status: request.status,
      amount: '30 CHF synthetic',
      views,
      credentialsFile: credentialsPath,
      decisionCount: 0,
      paymentCommands: 0,
      refundReceipts: 0,
    }),
  );
} finally {
  await db.$disconnect();
  await pool.end();
}
