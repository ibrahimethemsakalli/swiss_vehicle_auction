import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import {
  protectionHandlers,
  protectConversation,
  protectionQueue,
} from '../src/lib/retention-protection.ts';
import { readRetentionInventory } from '../src/lib/retention-inventory.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm26e_${randomUUID().replaceAll('-', '')}_test`,
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()), {
  NODE_ENV: 'test',
  LOCAL_PROXY_ENGINE: 'true',
  NEXTAUTH_URL: 'http://localhost:3000',
});
const control = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migration.status, 0, migration.stderr);
  const user = async (role, suffix) =>
    db.user.create({
      data: {
        email: suffix + '@test.invalid',
        phone: 'TEST-' + suffix,
        passwordHash: 'fixture',
        role,
      },
    });
  const admin = await user('ADMIN', 'admin'),
    reviewer = await user('ADMIN', 'reviewer'),
    buyer = await user('PRIVATE_USER', 'buyer');
  const seller = await user('PRIVATE_USER', 'seller');
  const v = await db.vehicle.create({
    data: {
      userId: seller.id,
      stammnummer: 'PM26E',
      vinChassis: randomUUID(),
      make: 'TEST',
      model: 'TEST',
      mileage: 1,
      mfkDate: new Date('2000-01-01'),
      canton: 'ZH',
      serviceHistory: 'UNKNOWN',
      tireCondition: 'UNKNOWN',
      description: 'PRIVATE VEHICLE',
      images: [],
      listingType: 'AUCTION_7_DAYS',
      startPrice: 1000,
    },
  });
  const c = await db.conversation.create({
    data: {
      vehicleId: v.id,
      sellerId: seller.id,
      buyerId: buyer.id,
      createdAt: new Date('2000-01-01'),
    },
  });
  await db.chatMessage.create({
    data: {
      conversationId: c.id,
      senderId: buyer.id,
      requestId: randomUUID(),
      body: 'PRIVATE MESSAGE',
      createdAt: new Date('2000-01-01'),
    },
  });
  const before = await db.chatMessage.findMany();
  assert.equal((await readRetentionInventory(db, admin.id)).messageAssessment.elapsed, '1');
  const body = {
    action: 'create',
    conversationId: c.id,
    reason: 'Evidence preservation requested',
  };
  const request = (data, origin = 'http://localhost:3000') =>
    new Request('http://localhost:3000/api/admin/retention/protections', {
      method: 'POST',
      headers: { origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  const handler = protectionHandlers(db, async () => admin.id);
  assert.equal((await handler.POST(request(body, 'https://bad.invalid'))).status, 403);
  assert.equal(
    (await protectionHandlers(db, async () => buyer.id).POST(request(body))).status,
    403,
  );
  assert.equal(
    (
      await protectionHandlers(db, async () => {
        throw Error('UNAUTHORIZED');
      }).GET(new Request('http://localhost:3000/api/admin/retention/protections'))
    ).status,
    401,
  );
  assert.equal((await handler.POST(request({ ...body, reason: 'bad' }))).status, 400);
  assert.equal(
    (await handler.POST(request({ ...body, conversationId: randomUUID() }))).status,
    404,
  );
  assert.equal((await handler.POST(request({ ...body, reason: 'a'.repeat(9000) }))).status, 400);
  const results = await Promise.all([handler.POST(request(body)), handler.POST(request(body))]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const hold = (await protectionQueue(db, admin.id, {})).rows[0];
  assert.equal(hold.reason, body.reason);
  assert.equal(hold.reviewedAt, null);
  assert.equal((await readRetentionInventory(db, admin.id)).messageAssessment.evidence, '1');
  const review = { action: 'review', id: hold.id, note: 'Reviewed: continue preserving evidence' };
  await assert.rejects(protectConversation(db, reviewer.id, review), /LEGACY_REVIEW_DISABLED/);
  assert.equal((await protectionQueue(db, admin.id, { state: 'active' })).rows.length, 1);
  assert.equal((await protectionQueue(db, admin.id, { state: 'released' })).rows.length, 0);
  const report = await readRetentionInventory(db, admin.id);
  assert.equal(report.messageAssessment.elapsed, '0');
  assert.equal(report.messageAssessment.evidence, '1');
  assert.equal(report.rows.find((r) => r.table === 'RetentionProtection').protected, '1');
  assert.ok(!JSON.stringify(report).includes(body.reason));
  assert.deepEqual(await db.chatMessage.findMany(), before);
  assert.equal(
    (await handler.POST(request({ action: 'release', id: hold.id, note: 'attempt release' })))
      .status,
    400,
  );
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: new Date() } });
  assert.equal(
    (await handler.GET(new Request('http://localhost:3000/api/admin/retention/protections')))
      .status,
    403,
  );
  process.env.LOCAL_PROXY_ENGINE = 'false';
  assert.equal(
    (await protectionHandlers(db, async () => reviewer.id).POST(request(body))).status,
    404,
  );
  console.log(
    'PASS PM26E: local/admin/origin gates, validation, create race and retired legacy review, durable protection before/after review, queue paging, unchanged messages, no release operation.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm26e_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM26E isolated database removed.');
}
