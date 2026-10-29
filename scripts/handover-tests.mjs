import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm19_${randomUUID().replaceAll('-', '')}_test`,
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
  const { readHandover, mutateHandover } = await import('../src/lib/handover.ts');
  const { blankHandover, swissCalendarDate } = await import('../src/lib/handover-rules.ts');
  const { handoverHandlers } = await import('../src/lib/handover-http.ts');
  const user = (tag, role = 'PRIVATE_USER') =>
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
  const seller = await user('seller'),
    buyer = await user('buyer'),
    outsider = await user('outsider'),
    admin = await user('admin', 'ADMIN');
  const vehicle = await db.vehicle.create({
    data: {
      userId: seller.id,
      vinChassis: 'PM19TEST000000001',
      stammnummer: '123456789',
      make: 'PM19',
      model: 'Local fixture',
      mileage: 5000,
      canton: 'BE',
      mfkStatus: 'UNKNOWN',
      serviceHistory: 'NONE',
      tireCondition: 'test',
      description: 'Synthetic test only',
      images: [],
      listingType: 'AUCTION_7_DAYS',
      startPrice: 1000,
      status: 'EXPIRED',
    },
  });
  const hold = await db.paymentHold.create({
    data: {
      userId: buyer.id,
      vehicleId: vehicle.id,
      gateway: 'LOCAL_TEST',
      status: 'AUTHORIZED',
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const bid = await db.bid.create({
    data: {
      userId: buyer.id,
      vehicleId: vehicle.id,
      holdId: hold.id,
      requestId: randomUUID(),
      amount: 1200,
      status: 'WON',
    },
  });
  const sale = await db.settlement.create({ data: { vehicleId: vehicle.id, bidId: bid.id } });
  const query = { settlementId: sale.id },
    save = { action: 'save', settlementId: sale.id, version: 0, payload: blankHandover };
  assert.equal((await readHandover(db, buyer.id, query)).current, null);
  await assert.rejects(() => readHandover(db, outsider.id, query), /FORBIDDEN/);
  await assert.rejects(() => mutateHandover(db, admin.id, save), /FORBIDDEN/);
  const races = await Promise.allSettled([
    mutateHandover(db, seller.id, save),
    mutateHandover(db, buyer.id, save),
  ]);
  assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
  const ack = { action: 'acknowledge', settlementId: sale.id, version: 1, confirmed: true };
  await assert.rejects(() => mutateHandover(db, buyer.id, ack), /HANDOVER_INCOMPLETE/);
  const payload = {
    ...blankHandover,
    date: swissCalendarDate(new Date()),
    inspection: 'YES',
    damage: 'YES',
    keys: 'NO',
    documents: 'YES',
    vehicle: 'YES',
    note: 'Second key not available; factual local test.',
  };
  await mutateHandover(db, seller.id, { ...save, version: 1, payload });
  const v2 = (await readHandover(db, buyer.id, query)).current;
  assert.equal(v2.snapshot.price, '1200');
  assert.equal(v2.payload.mileage, null);
  assert.equal(v2.snapshot.maskedVin.includes(vehicle.vinChassis), false);
  await Promise.all([
    mutateHandover(db, buyer.id, { ...ack, version: 2 }),
    mutateHandover(db, seller.id, { ...ack, version: 2 }),
  ]);
  await mutateHandover(db, buyer.id, { ...ack, version: 2 });
  assert.equal(await db.outboxEvent.count({ where: { kind: 'handover.acknowledged' } }), 2);
  const confirmed = (await readHandover(db, buyer.id, query)).current;
  assert.ok(confirmed.buyerAcknowledgedAt);
  assert.ok(confirmed.sellerAcknowledgedAt);
  assert.equal(confirmed.contentHash, v2.contentHash);
  await mutateHandover(db, buyer.id, { ...save, version: 2, payload: { ...payload, keyCount: 1 } });
  const revised = await readHandover(db, seller.id, query);
  assert.equal(revised.current.buyerAcknowledgedAt, null);
  assert.equal(revised.current.sellerAcknowledgedAt, null);
  assert.notEqual(revised.current.contentHash, v2.contentHash);
  assert.ok(revised.history.find((r) => r.version === 2).buyerAcknowledgedAt);
  await assert.rejects(() => mutateHandover(db, seller.id, { ...ack, version: 2 }), /CONFLICT/);
  const dispute = await db.dispute.create({
    data: {
      settlementId: sale.id,
      reporterId: buyer.id,
      category: 'OTHER',
      message: 'Synthetic blocking dispute',
    },
  });
  assert.equal((await readHandover(db, buyer.id, query)).canSave, false);
  await assert.rejects(() => mutateHandover(db, buyer.id, { ...ack, version: 3 }), /DISPUTE_OPEN/);
  await db.dispute.update({ where: { id: dispute.id }, data: { status: 'ACTION_REQUIRED' } });
  await assert.rejects(
    () => mutateHandover(db, seller.id, { ...save, version: 3, payload }),
    /DISPUTE_OPEN/,
  );
  await db.dispute.update({ where: { id: dispute.id }, data: { status: 'RESOLVED' } });
  for (const status of [
    'COMPLETED',
    'CANCELLED',
    'DEFAULTED',
    'CAPTURE_PENDING',
    'DEFAULT_REVIEW',
  ]) {
    await db.settlement.update({ where: { id: sale.id }, data: { status } });
    assert.equal((await readHandover(db, buyer.id, query)).canSave, false);
    await assert.rejects(
      () => mutateHandover(db, seller.id, { ...save, version: 3, payload }),
      /HANDOVER_LOCKED/,
    );
  }
  await db.settlement.update({ where: { id: sale.id }, data: { status: 'AWAITING_CONFIRMATION' } });
  await db.user.update({ where: { id: buyer.id }, data: { phoneVerifiedAt: null } });
  await assert.rejects(
    () => mutateHandover(db, buyer.id, { ...ack, version: 3 }),
    /VERIFICATION_REQUIRED/,
  );
  await db.user.update({ where: { id: buyer.id }, data: { phoneVerifiedAt: new Date() } });
  const http = handoverHandlers(db, async () => buyer.id),
    origin = process.env.NEXTAUTH_URL;
  const get = await http.GET(new Request(origin + '/api/handover?settlementId=' + sale.id));
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('Cache-Control'), 'private, no-store');
  assert.equal('createdById' in (await get.json()).current, false);
  const post = (body, from = origin) =>
    http.POST(
      new Request(origin + '/api/handover', {
        method: 'POST',
        headers: { origin: from },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await post({ ...ack, version: 3 }, 'https://wrong.invalid')).status, 403);
  assert.equal((await post({ ...ack, version: 3, buyerAcknowledgedAt: new Date() })).status, 400);
  assert.equal((await post({ note: 'x'.repeat(12001) })).status, 400);
  assert.equal(
    (
      await handoverHandlers(db, async () => {
        throw Error('UNAUTHORIZED');
      }).GET(new Request(origin + '/api/handover?settlementId=' + sale.id))
    ).status,
    401,
  );
  const current = await db.handoverRevision.findFirst({
    where: { settlementId: sale.id },
    orderBy: { version: 'desc' },
  });
  await db.handoverRevision.createMany({
    data: Array.from({ length: 17 }, (_, i) => ({ ...current, id: randomUUID(), version: i + 4 })),
  });
  await assert.rejects(
    () => mutateHandover(db, buyer.id, { ...save, version: 20, payload }),
    /RATE_LIMITED/,
  );
  const history = await readHandover(db, buyer.id, { ...query, page: 2 });
  assert.equal(history.history.length, 10);
  assert.equal(history.total, 20);
  assert.equal(history.current.version, 20);
  await db.handoverRevision.createMany({
    data: Array.from({ length: 80 }, (_, i) => ({
      ...current,
      id: randomUUID(),
      version: i + 21,
      createdAt: new Date(Date.now() - 86400000),
    })),
  });
  await assert.rejects(
    () => mutateHandover(db, buyer.id, { ...save, version: 100, payload }),
    /HANDOVER_LIMIT/,
  );
  await db.user.update({ where: { id: buyer.id }, data: { suspendedAt: new Date() } });
  assert.equal(
    (await http.GET(new Request(origin + '/api/handover?settlementId=' + sale.id))).status,
    403,
  );
  assert.equal(await db.transaction.count(), 0);
  assert.equal((await db.paymentHold.findUnique({ where: { id: hold.id } })).status, 'AUTHORIZED');
  assert.equal((await db.vehicle.findUnique({ where: { id: vehicle.id } })).status, 'EXPIRED');
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
    'PASS: scoped access, immutable version content, concurrent saves/acknowledgements, stale version rejection, missing/negative facts, dispute/closed-state guards, quota/history, HTTP boundaries, schema alignment and no payment side effects.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm19_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PASS: isolated PM19 database removed');
}
