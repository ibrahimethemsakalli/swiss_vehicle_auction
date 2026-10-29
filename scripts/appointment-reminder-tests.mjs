import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
import { notifyAppointmentReminders } from '../src/lib/appointment-reminders.ts';
import { appointmentCalendarHandler } from '../src/lib/appointment-calendar-http.ts';
import { mutateChat } from '../src/lib/messaging.ts';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm25a_${randomUUID().replaceAll('-', '')}_test`,
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
  const users = await Promise.all(
    ['seller', 'buyer', 'outsider'].map((label) =>
      db.user.create({
        data: {
          email: `${label}@pm25.invalid`,
          phone: label,
          passwordHash: 'fixture',
          emailVerifiedAt: new Date(),
          phoneVerifiedAt: new Date(),
        },
      }),
    ),
  );
  const [seller, buyer, outsider] = users;
  const v = await db.vehicle.create({
    data: {
      userId: seller.id,
      stammnummer: 'fixture',
      vinChassis: randomUUID(),
      make: 'PM25',
      model: 'Private test',
      mileage: 1,
      canton: 'ZH',
      mfkDate: new Date(),
      serviceHistory: 'test',
      tireCondition: 'test',
      description: 'test',
      images: [],
      listingType: 'AUCTION_7_DAYS',
      status: 'ACTIVE',
      startPrice: 100,
      auctionEndsAt: new Date(Date.now() + 86400000),
    },
  });
  const c = await db.conversation.create({
    data: { vehicleId: v.id, buyerId: buyer.id, sellerId: seller.id },
  });
  const create = (status, offset) =>
    db.appointment.create({
      data: {
        conversationId: c.id,
        proposerId: seller.id,
        requestId: randomUUID(),
        location: 'Private meeting location',
        status,
        startsAt: new Date(Date.now() + offset),
      },
    });
  const due = await create('ACCEPTED', 3600000);
  const pending = await create('PENDING', 3600000),
    cancelled = await create('CANCELLED', 3600000),
    past = await create('ACCEPTED', -1000),
    future = await create('ACCEPTED', 25 * 3600000);
  await Promise.all([notifyAppointmentReminders(db), notifyAppointmentReminders(db)]);
  assert.equal(await db.notification.count({ where: { kind: 'CHAT_REMINDER' } }), 2);
  assert.equal((await notifyAppointmentReminders(db)).count, 0);
  const rows = await db.notification.findMany();
  assert.deepEqual(rows.map((r) => r.userId).sort(), [seller.id, buyer.id].sort());
  assert.ok(rows.every((r) => !JSON.stringify(r).includes('Private meeting location')));
  const fetchCalendar = (actor, id, lang = 'en') =>
    appointmentCalendarHandler(
      db,
      async () => actor,
    )(new Request(`http://localhost/api/appointments/calendar?id=${id}&lang=${lang}`));
  for (const actor of [seller.id, buyer.id])
    for (const lang of ['de', 'fr', 'it', 'en']) {
      const r = await fetchCalendar(actor, due.id, lang);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
      assert.match(r.headers.get('content-disposition'), /attachment;/);
      const body = await r.text();
      assert.match(body, /BEGIN:VCALENDAR/);
      assert.match(body, /Private meeting location/);
      assert.ok(!body.includes('@pm25.invalid'));
    }
  assert.equal((await fetchCalendar(outsider.id, due.id)).status, 403);
  assert.equal((await fetchCalendar(buyer.id, randomUUID())).status, 403);
  for (const a of [pending, cancelled, past])
    assert.equal((await fetchCalendar(buyer.id, a.id)).status, 409);
  assert.equal((await fetchCalendar(buyer.id, 'bad')).status, 400);
  assert.equal((await fetchCalendar(buyer.id, due.id, 'tr')).status, 400);
  const unauthorized = appointmentCalendarHandler(db, async () => {
    throw Error('UNAUTHORIZED');
  });
  assert.equal((await unauthorized(new Request('http://localhost/'))).status, 401);
  await db.user.update({ where: { id: buyer.id }, data: { suspendedAt: new Date() } });
  assert.equal((await fetchCalendar(buyer.id, due.id)).status, 403);
  const late = await create('ACCEPTED', 1800000);
  assert.equal((await notifyAppointmentReminders(db)).count, 0);
  await db.user.update({ where: { id: buyer.id }, data: { suspendedAt: null } });
  await db.userBlock.create({ data: { ownerId: seller.id, targetId: buyer.id } });
  assert.equal((await notifyAppointmentReminders(db)).count, 0);
  await db.userBlock.delete({
    where: { ownerId_targetId: { ownerId: seller.id, targetId: buyer.id } },
  });
  assert.equal((await notifyAppointmentReminders(db)).count, 2);
  await mutateChat(db, seller.id, {
    action: 'appointment',
    conversationId: c.id,
    id: late.id,
    decision: 'CANCELLED',
  });
  assert.equal((await fetchCalendar(buyer.id, late.id)).status, 409);
  const cancelBefore = await create('ACCEPTED', 1800000);
  await mutateChat(db, seller.id, {
    action: 'appointment',
    conversationId: c.id,
    id: cancelBefore.id,
    decision: 'CANCELLED',
  });
  assert.equal((await notifyAppointmentReminders(db)).count, 0);
  // More than a batch of due appointments: previously notified rows cannot starve later ones.
  await db.appointment.createMany({
    data: Array.from({ length: 105 }, () => ({
      id: randomUUID(),
      conversationId: c.id,
      proposerId: seller.id,
      requestId: randomUUID(),
      location: 'Batch',
      status: 'ACCEPTED',
      startsAt: new Date(Date.now() + 7200000),
    })),
  });
  assert.equal((await notifyAppointmentReminders(db)).count, 200);
  assert.equal((await notifyAppointmentReminders(db)).count, 10);
  assert.equal((await notifyAppointmentReminders(db)).count, 0);
  assert.equal(
    await db.notification.count({ where: { eventKey: `appointment-reminder:${future.id}` } }),
    0,
  );
  console.log(
    'PASS: concurrent one-time reminders, 24-hour window, cancelled/pending/past/blocked/suspended exclusions, batch progress, private calendar access, four languages, cancellation and no-cache headers.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm25a_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM25A isolated database removed.');
}
