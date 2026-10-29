import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm18_${randomUUID().replaceAll('-', '')}_test`,
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()));
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
  const { readAdminQueue, assignAdminWork } = await import('../src/lib/admin-queue.ts');
  const { adminQueueHandlers } = await import('../src/lib/admin-queue-http.ts');
  const actor = async (tag, role = 'ADMIN') =>
    db.user.create({
      data: {
        email: `${tag}@example.invalid`,
        phone: tag,
        passwordHash: 'test',
        role,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });
  const admin = await actor('admin'),
    other = await actor('other'),
    seller = await actor('seller', 'PRIVATE_USER'),
    buyer = await actor('buyer', 'PRIVATE_USER');
  const old = new Date('2026-01-01T23:59:59.999Z'),
    base = {
      userId: seller.id,
      stammnummer: '123456789',
      make: 'PM18',
      model: 'Queue fixture',
      mileage: 0,
      canton: 'BE',
      mfkStatus: 'UNKNOWN',
      serviceHistory: 'NONE',
      tireCondition: 'fixture',
      description: 'Synthetic local test only',
      images: [],
      listingType: 'AUCTION_7_DAYS',
      startPrice: 1000,
      status: 'PENDING_VERIFICATION',
      createdAt: old,
    };
  const vehicles = Array.from({ length: 105 }, (_, i) => ({
    ...base,
    id: randomUUID(),
    vinChassis: `PM18${String(i).padStart(13, '0')}`,
  }));
  await db.vehicle.createMany({ data: vehicles });
  const holds = vehicles.map((v) => ({
    id: randomUUID(),
    userId: buyer.id,
    vehicleId: v.id,
    gateway: 'LOCAL_TEST',
    status: 'AUTHORIZED',
    expiresAt: new Date('2027-01-01'),
    createdAt: old,
  }));
  await db.paymentHold.createMany({ data: holds });
  const bids = holds.map((h) => ({
    id: randomUUID(),
    userId: buyer.id,
    vehicleId: h.vehicleId,
    holdId: h.id,
    amount: 1000,
    requestId: randomUUID(),
    status: 'WON',
  }));
  await db.bid.createMany({ data: bids });
  const sales = bids.map((b) => ({
    id: randomUUID(),
    vehicleId: b.vehicleId,
    bidId: b.id,
    status: 'AWAITING_CONFIRMATION',
    createdAt: old,
  }));
  await db.settlement.createMany({ data: sales });
  await db.dispute.createMany({
    data: sales.map((s) => ({
      settlementId: s.id,
      reporterId: buyer.id,
      category: 'OTHER',
      message: 'Synthetic case',
      createdAt: old,
    })),
  });
  await db.user.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      email: `fixture${i}@example.invalid`,
      phone: `fixture${i}`,
      passwordHash: 'test',
      createdAt: old,
    })),
  });
  await db.outboxEvent.createMany({
    data: vehicles.map((v) => ({
      kind: 'admin.review',
      payload: {
        adminId: admin.id,
        vehicleId: v.id,
        action: 'approve',
        note: 'Historical fixture',
      },
      createdAt: old,
      deliveredAt: old,
    })),
  });
  for (const kind of ['queue', 'payments', 'settlements', 'disputes', 'identities', 'audit']) {
    const ids = [];
    for (let page = 1; page <= 6; page++) {
      const r = await readAdminQueue(db, admin.id, {
        kind,
        page,
        from: '2026-01-01',
        to: '2026-01-01',
      });
      assert.equal(r.total, 105, kind);
      assert.equal(r.items.length, page === 6 ? 5 : 20, kind);
      ids.push(...r.items.map((i) => i.id));
    }
    assert.equal(new Set(ids).size, 105, kind);
  }
  const v = vehicles[0];
  assert.equal((await readAdminQueue(db, admin.id, { q: v.id })).total, 1);
  assert.equal((await readAdminQueue(db, admin.id, { kind: 'payments', q: 'pM18' })).total, 105);
  assert.equal((await readAdminQueue(db, admin.id, { kind: 'queue', status: 'ACTIVE' })).total, 0);
  assert.equal((await readAdminQueue(db, admin.id, { kind: 'audit', q: v.id })).total, 1);
  assert.equal((await readAdminQueue(db, admin.id, { from: '2026-01-02' })).total, 0);
  assert.equal((await readAdminQueue(db, admin.id, { page: 99 })).items.length, 0);
  await assert.rejects(() => readAdminQueue(db, buyer.id, {}), /FORBIDDEN/);
  const cmd = {
    kind: 'queue',
    id: v.id,
    action: 'claim',
    version: 0,
    note: 'Local operator assignment',
  };
  const claims = await Promise.allSettled([
    assignAdminWork(db, admin.id, cmd),
    assignAdminWork(db, other.id, cmd),
  ]);
  assert.equal(
    claims.filter((c) => c.status === 'fulfilled').length,
    1,
    claims.map((c) => (c.status === 'rejected' ? String(c.reason) : 'ok')).join('|'),
  );
  const assigned = await db.adminWorkItem.findUniqueOrThrow({
    where: { kind_recordId: { kind: 'queue', recordId: v.id } },
  });
  const owner = assigned.ownerId,
    notOwner = owner === admin.id ? other.id : admin.id;
  await assert.rejects(
    () => assignAdminWork(db, notOwner, { ...cmd, action: 'release', version: 1 }),
    /CONFLICT/,
  );
  await assert.rejects(
    () => assignAdminWork(db, owner, { ...cmd, action: 'release', version: 0 }),
    /CONFLICT/,
  );
  await assignAdminWork(db, owner, { ...cmd, action: 'release', version: 1 });
  await assignAdminWork(db, notOwner, { ...cmd, version: 2 });
  await db.user.update({ where: { id: notOwner }, data: { suspendedAt: new Date() } });
  await assert.rejects(() => readAdminQueue(db, notOwner, {}), /FORBIDDEN/);
  await assignAdminWork(db, owner, { ...cmd, version: 3 });
  const assignmentHistory = await readAdminQueue(db, owner, {
    kind: 'audit',
    status: 'admin.assignment',
    q: v.id,
  });
  assert.equal(assignmentHistory.total, 4);
  assert.ok(assignmentHistory.items.every((i) => i.actor && i.note));
  const displayed = (await readAdminQueue(db, owner, { q: v.id })).items[0];
  assert.equal(displayed.assignment.owner.role, 'ADMIN');
  assert.equal(displayed.assignment.version, 4);
  await assert.rejects(() => assignAdminWork(db, owner, { ...cmd, id: randomUUID() }), /NOT_FOUND/);
  const http = adminQueueHandlers(db, async () => owner),
    origin = process.env.NEXTAUTH_URL;
  const get = await http.GET(new Request(origin + '/api/admin/work?kind=payments&page=6'));
  assert.equal(get.status, 200);
  assert.equal((await get.json()).items.length, 5);
  assert.equal(get.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await http.GET(new Request(origin + '/api/admin/work?page=0'))).status, 400);
  assert.equal(
    (
      await adminQueueHandlers(db, async () => buyer.id).GET(
        new Request(origin + '/api/admin/work'),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await adminQueueHandlers(db, async () => {
        throw Error('UNAUTHORIZED');
      }).GET(new Request(origin + '/api/admin/work'))
    ).status,
    401,
  );
  const post = (body, from = origin) =>
    http.POST(
      new Request(origin + '/api/admin/work', {
        method: 'POST',
        headers: { origin: from },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await post(cmd, 'https://wrong.invalid')).status, 403);
  assert.equal((await post({ ...cmd, ownerId: buyer.id })).status, 400);
  assert.equal((await post({ note: 'x'.repeat(4100) })).status, 400);
  assert.equal(await db.transaction.count(), 0);
  assert.equal(await db.paymentHold.count({ where: { status: 'AUTHORIZED' } }), 105);
  assert.equal(await db.vehicle.count({ where: { status: 'PENDING_VERIFICATION' } }), 105);
  const diff = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(diff.status, 0, diff.stdout + diff.stderr);
  console.log(
    'PASS: six queues with 105 records each, stable tied-date pages, filters, UTC dates, roles, concurrent claims, release/version conflicts, inactive-owner recovery, immutable assignment history, HTTP guards and unchanged payment/listing state. Schema matches migrations.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm18_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PASS: isolated PM18 database removed');
}
