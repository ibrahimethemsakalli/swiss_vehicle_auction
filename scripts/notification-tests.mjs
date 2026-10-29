import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import {
  notify,
  notifyHoldRenewals,
  listNotifications,
  readNotification,
} from '../src/lib/notifications.ts';
import { notificationHandlers } from '../src/lib/notification-http.ts';
import { ciEnvironment } from './ci-environment.mjs';

const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = `autoveri_pm08_${randomUUID().replaceAll('-', '')}_test`;
const target = new URL(source);
target.pathname = `/${name}`;
const maintenance = new URL(source);
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()));
const admin = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  assert.match(name, /^autoveri_pm08_[a-f0-9]{32}_test$/);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const deploy = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(deploy.status, 0, 'Apply notification migration to an isolated database');
  const seller = await db.user.create({
    data: { email: 'seller@example.invalid', phone: 'pm08-seller', passwordHash: 'test-only' },
  });
  const buyer = await db.user.create({
    data: { email: 'buyer@example.invalid', phone: 'pm08-buyer', passwordHash: 'test-only' },
  });
  const vehicle = await db.vehicle.create({
    data: {
      userId: seller.id,
      stammnummer: 'test',
      vinChassis: randomUUID(),
      make: 'Test',
      model: 'Notification fixture',
      mileage: 1,
      canton: 'ZH',
      mfkDate: new Date(),
      serviceHistory: 'test',
      tireCondition: 'test',
      description: 'PM08 isolated fixture',
      images: [],
      listingType: 'AUCTION_7_DAYS',
      status: 'ACTIVE',
      startPrice: 100,
    },
  });
  const event = { type: 'outbid', bidId: randomUUID(), userId: buyer.id, vehicle };
  await Promise.all([
    db.$transaction((tx) => notify(tx, event)),
    db.$transaction((tx) => notify(tx, event)),
  ]);
  assert.equal(await db.notification.count(), 1, 'Concurrent retries must deduplicate');
  await assert.rejects(
    db.$transaction(async (tx) => {
      await notify(tx, { ...event, bidId: 'rollback' });
      throw Error('ROLLBACK');
    }),
    /ROLLBACK/,
  );
  assert.equal(await db.notification.count(), 1, 'Notification rolls back with its event');
  await db.$transaction((tx) =>
    notify(tx, {
      type: 'closed',
      version: 1,
      winnerId: buyer.id,
      participantIds: [buyer.id, buyer.id],
      vehicle,
    }),
  );
  await db.$transaction((tx) =>
    notify(tx, { type: 'review', version: 2, approved: false, vehicle }),
  );
  await db.$transaction((tx) =>
    notify(tx, {
      type: 'dispute',
      disputeId: randomUUID(),
      resolution: 'REFUND_REQUIRED',
      buyerId: buyer.id,
      vehicle,
    }),
  );
  assert.equal((await listNotifications(db, buyer.id, {})).items.length, 3);
  const notification = (await listNotifications(db, buyer.id, {})).items[0];
  await readNotification(db, seller.id, { id: notification.id });
  assert.equal(
    (await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt,
    null,
  );
  await readNotification(db, buyer.id, { id: notification.id });
  const read = (await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt;
  await readNotification(db, buyer.id, { id: notification.id });
  assert.deepEqual(
    (await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt,
    read,
  );
  await db.$disconnect();
  assert.equal(
    (await listNotifications(db, buyer.id, { unread: 'true' })).unreadCount,
    2,
    'Read state persists across reconnect',
  );
  console.log(
    'PASS: migration, atomic creation/rollback, duplicate delivery, owner isolation and persistent read state',
  );

  const now = new Date();
  await db.notification.createMany({
    data: Array.from({ length: 45 }, (_, i) => ({
      userId: buyer.id,
      eventKey: `page:${i}`,
      kind: 'OUTBID',
      vehicleId: vehicle.id,
      vehicleName: 'Page fixture',
      createdAt: now,
    })),
  });
  let cursor;
  const seen = new Set();
  do {
    const page = await listNotifications(db, buyer.id, cursor ? { cursor } : {});
    assert.ok(page.items.length <= 20);
    for (const item of page.items) {
      assert.ok(!seen.has(item.id));
      seen.add(item.id);
      assert.ok(!('userId' in item) && !('eventKey' in item));
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 48, 'Stable timestamp/id cursor has no gaps');
  const api = notificationHandlers(db, async () => buyer.id);
  const denied = notificationHandlers(db, async () => {
    throw Error('UNAUTHORIZED');
  });
  const origin = process.env.NEXTAUTH_URL;
  assert.equal((await denied.GET(new Request(`${origin}/api/notifications`))).status, 401);
  assert.equal(
    (await api.GET(new Request(`${origin}/api/notifications?userId=${seller.id}`))).status,
    400,
  );
  assert.equal(
    (await api.GET(new Request(`${origin}/api/notifications?cursor=invalid`))).status,
    400,
  );
  const result = await api.GET(new Request(`${origin}/api/notifications?summary=true`));
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await result.json()).items, []);
  const patch = (headers, body) =>
    api.PATCH(
      new Request(`${origin}/api/notifications`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await patch({ Origin: 'https://foreign.invalid' }, { id: notification.id })).status,
    403,
  );
  assert.equal(
    (await patch({ Origin: origin }, { id: notification.id, userId: seller.id })).status,
    400,
  );
  assert.equal(
    (await patch({ Origin: origin, 'Content-Length': '1' }, { id: 'x'.repeat(2048) })).status,
    400,
  );
  assert.equal((await patch({ Origin: origin }, { id: notification.id })).status, 200);
  await db.user.update({ where: { id: buyer.id }, data: { suspendedAt: new Date() } });
  assert.equal((await api.GET(new Request(`${origin}/api/notifications`))).status, 403);
  await db.user.update({ where: { id: buyer.id }, data: { suspendedAt: null } });
  console.log(
    'PASS: notification-only HTTP authorization, origin, input/privacy, pagination and unread counts',
  );

  const hold = await db.paymentHold.create({
    data: {
      userId: buyer.id,
      vehicleId: vehicle.id,
      gateway: 'TEST_NO_PROVIDER',
      status: 'AUTHORIZED',
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bid = await db.bid.create({
    data: {
      userId: buyer.id,
      vehicleId: vehicle.id,
      amount: 100,
      holdId: hold.id,
      requestId: randomUUID(),
    },
  });
  assert.equal(await notifyHoldRenewals(db), 1);
  assert.equal(await notifyHoldRenewals(db), 0);
  assert.equal(
    (await db.paymentHold.findUniqueOrThrow({ where: { id: hold.id } })).status,
    'AUTHORIZED',
  );
  await db.notification.deleteMany({ where: { eventKey: `renewal:${hold.id}` } });
  await db.bid.update({ where: { id: bid.id }, data: { status: 'OUTBID' } });
  assert.equal(await notifyHoldRenewals(db), 0, 'Inactive bid gets no renewal request');
  await db.bid.update({ where: { id: bid.id }, data: { status: 'ACTIVE' } });
  await db.paymentHold.update({
    where: { id: hold.id },
    data: { expiresAt: new Date(Date.now() + 48 * 3600000) },
  });
  assert.equal(await notifyHoldRenewals(db), 0, 'Not within renewal window');
  console.log(
    'PASS: notification-only renewal sweep, deduplication and eligibility; no payment/bid action invoked',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm08_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: isolated PM08 database removed');
