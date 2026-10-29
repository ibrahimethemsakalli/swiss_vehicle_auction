import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { createDatabaseClient } from '../src/lib/database-client';
import { RefundDecisions } from '../src/lib/refund-decisions';
import { RefundRepository } from '../src/lib/refund-repository';
import { refundHandlers } from '../src/lib/refund-http';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = 'autoveri_l11_http_' + randomUUID().replaceAll('-', '') + '_test',
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
process.env.NEXTAUTH_URL = 'http://127.0.0.1:3000';
const control = new Pool({ connectionString: maintenance.toString() }),
  pool = new Pool({ connectionString: target.toString() }),
  db = createDatabaseClient(target.toString());
const service = new RefundDecisions(pool),
  repo = new RefundRepository(pool);
let currentUser = '';
const handlers = refundHandlers(
  service,
  async () => {
    if (!currentUser) throw Error('UNAUTHORIZED');
    return currentUser;
  },
  async () => {},
);
const get = (q = '') => handlers.GET(new Request('http://127.0.0.1:3000/api/refunds' + q));
const post = (body: unknown) =>
  handlers.POST(
    new Request('http://127.0.0.1:3000/api/refunds', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
let created = false;
try {
  await control.query(`CREATE DATABASE "${name}"`);
  created = true;
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: target.toString() }, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migrated.status, 0, migrated.stderr);
  const user = (role: 'ADMIN' | 'PRIVATE_USER') =>
    db.user.create({
      data: {
        email: randomUUID() + '@test.invalid',
        phone: randomUUID(),
        passwordHash: 'fixture',
        role,
      },
    });
  const [buyer, seller, other, admin] = await Promise.all([
    user('PRIVATE_USER'),
    user('ADMIN'),
    user('PRIVATE_USER'),
    user('ADMIN'),
  ]);
  const vehicle = await db.vehicle.create({
    data: {
      userId: seller.id,
      stammnummer: randomUUID(),
      vinChassis: randomUUID(),
      make: 'LOCAL',
      model: 'HTTP TEST',
      mileage: 0,
      mfkDate: new Date(),
      canton: 'ZH',
      serviceHistory: 'test',
      tireCondition: 'test',
      description: 'test',
      images: [],
      listingType: 'AUCTION_7_DAYS',
      startPrice: 100,
    },
  });
  const ref = randomUUID(),
    captureId = randomUUID();
  const hold = await db.paymentHold.create({
    data: {
      userId: buyer.id,
      vehicleId: vehicle.id,
      gateway: 'fake',
      gatewayTransactionId: ref,
      status: 'CAPTURED_FEE',
      expiresAt: new Date(),
    },
  });
  await repo.register(captureId, {
    scope: { provider: 'fake', merchant: 'test', environment: 'test' },
    captureRef: ref,
    currency: 'CHF',
    amountMinor: 3000,
    confirmed: true,
    participantIds: [buyer.id, seller.id],
    version: 0,
    blocked: false,
    operations: [],
    evidence: [],
    findings: [],
  });
  await pool.query('INSERT INTO "RefundCaptureBinding" ("captureId","holdId") VALUES ($1,$2)', [
    captureId,
    hold.id,
  ]);
  const policy = {
    version: 'TEST-ONLY',
    reviewRulesConfirmed: true,
    partialRefunds: null,
    requiredApprovals: 1,
    separateExecutor: null,
  };
  await pool.query('INSERT INTO "RefundRuntimePolicy" (id,policy,actors) VALUES ($1,$2,$3)', [
    'active',
    JSON.stringify(policy),
    JSON.stringify(
      [admin, seller].map((a) => ({ id: a.id, active: true, capabilities: ['refund.review'] })),
    ),
  ]);
  assert.equal((await get()).status, 401);
  currentUser = buyer.id;
  const list = await (await get()).json();
  assert.equal(list.captures.length, 1);
  assert.equal(list.captures[0].id, captureId);
  assert.equal(JSON.stringify(list).includes(ref), false);
  const reason = 'LOCAL HTTP TEST detailed reason for fee review';
  const request = { action: 'request', captureId, requestId: randomUUID(), reason };
  const response = await post(request);
  assert.equal(response.status, 200);
  const opened = await response.json();
  assert.equal((await (await get()).json()).cases.length, 1);
  currentUser = other.id;
  assert.equal((await (await get()).json()).cases.length, 0);
  assert.equal((await get('?id=' + opened.id)).status, 403);
  assert.equal((await get('?admin=true')).status, 403);
  currentUser = seller.id;
  assert.equal((await (await get('?admin=true')).json()).cases.length, 0);
  currentUser = admin.id;
  const adminList = await (await get('?admin=true')).json();
  assert.equal(adminList.cases.length, 1);
  assert.equal(adminList.policyReady, true);
  const decision = {
    action: 'decide',
    caseId: opened.id,
    requestId: randomUUID(),
    expectedVersion: 0,
    outcome: 'APPROVE',
    reason,
  };
  await pool.query('UPDATE "RefundCase" SET "evidenceReadyAt"=clock_timestamp() WHERE id=$1', [
    opened.id,
  ]);
  const before = await (await get('?id=' + opened.id)).json();
  assert.equal(before.canReview, true);
  assert.equal((await post(decision)).status, 200);
  assert.equal((await (await get('?id=' + opened.id)).json()).canReview, false);
  currentUser = buyer.id;
  const detail = await (await get('?id=' + opened.id)).json();
  assert.equal(detail.status, 'IN_REVIEW');
  assert.equal(detail.amountMinor, 3000);
  assert.equal('decisions' in detail, false);
  assert.equal((await pool.query('SELECT count(*)::int n FROM "RefundCommandState"')).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM "RefundReceipt"')).rows[0].n, 0);
  // Only the new list/HTTP boundary is checked: no worker/provider or previous sale workflows.
  await pool.query('UPDATE "RefundRuntimePolicy" SET policy=$1 WHERE id=$2', [
    JSON.stringify({ ...policy, requiredApprovals: null }),
    'active',
  ]);
  currentUser = admin.id;
  assert.equal((await (await get('?admin=true')).json()).policyReady, true);
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: new Date() } });
  assert.equal((await get('?admin=true')).status, 403);
  console.log(
    'PASS new HTTP/DB: session, scoped lists, private DTO, request/decision, review controls, missing policy, suspension; zero queued payments and receipts.',
  );
} finally {
  await db.$disconnect();
  await pool.end();
  if (created) {
    assert.match(name, /^autoveri_l11_http_[a-f0-9]{32}_test$/);
    await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.end();
}
