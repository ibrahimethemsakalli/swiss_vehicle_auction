import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
import { supportRead, supportWrite } from '../src/lib/support.ts';
import { supportRoutingWrite } from '../src/lib/support-routing.ts';
import { supportHandlers } from '../src/lib/support-http.ts';
import { listNotifications, readNotification } from '../src/lib/notifications.ts';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = 'autoveri_pm28_' + randomUUID().replaceAll('-', '') + '_test',
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()), {
  NODE_ENV: 'test',
  NEXTAUTH_URL: 'http://localhost:3000',
});
const control = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migrated.status, 0, migrated.stderr);
  async function user(role, extra = {}) {
    const id = randomUUID();
    return db.user.create({
      data: { id, role, email: id + '@test.invalid', phone: id, passwordHash: 'fixture', ...extra },
    });
  }
  const u = await user('PRIVATE_USER'),
    other = await user('DEALER'),
    a = await user('ADMIN'),
    b = await user('ADMIN'),
    bad = await user('ADMIN', { suspendedAt: new Date() });
  const create = {
    action: 'create',
    commandId: randomUUID(),
    subject: 'PRIVATE SUBJECT',
    body: 'PRIVATE BODY text for local test',
  };
  const { id } = await supportWrite(db, u.id, create);
  assert.equal(
    await db.notification.count({ where: { userId: a.id, kind: 'SUPPORT_ACTIVITY' } }),
    1,
  );
  assert.equal(await db.notification.count({ where: { userId: bad.id } }), 0);
  assert.equal(await db.notification.count({ where: { userId: u.id } }), 0);
  await supportWrite(db, u.id, create);
  assert.equal(await db.notification.count(), 2);
  const initial = (await supportRead(db, a.id, { id, admin: 'true' })).entries[0];
  assert.equal((await supportRead(db, a.id, { admin: 'true' })).items[0].unreadCount, 1);
  const assign = (version, ownerId) => ({
    action: 'assign',
    id,
    version,
    ownerId,
    reason: 'Local routing test reason',
    commandId: randomUUID(),
  });
  await assert.rejects(supportRoutingWrite(db, u.id, assign(0, b.id)), /FORBIDDEN/);
  await assert.rejects(supportRoutingWrite(db, a.id, assign(0, u.id)), /FORBIDDEN/);
  await assert.rejects(supportRoutingWrite(db, a.id, assign(0, bad.id)), /FORBIDDEN/);
  const command = assign(0, b.id);
  await supportRoutingWrite(db, a.id, command);
  await supportRoutingWrite(db, a.id, command);
  assert.equal(await db.supportAssignment.count(), 1);
  assert.equal(await db.notification.count({ where: { kind: 'SUPPORT_ASSIGNMENT' } }), 1);
  await assert.rejects(
    supportRoutingWrite(db, a.id, { ...command, reason: 'Changed reason text' }),
    /CONFLICT/,
  );
  const reply = (version) => ({
    action: 'reply',
    id,
    version,
    commandId: randomUUID(),
    body: 'PRIVATE REPLY body for the test',
  });
  const beforeA = await db.notification.count({ where: { userId: a.id } }),
    beforeB = await db.notification.count({ where: { userId: b.id } });
  await supportWrite(db, u.id, reply(1));
  assert.equal(await db.notification.count({ where: { userId: a.id } }), beforeA);
  assert.equal(await db.notification.count({ where: { userId: b.id } }), beforeB + 1);
  await supportRoutingWrite(db, a.id, { action: 'read', id, entryIds: [initial.id] });
  await supportRoutingWrite(db, a.id, { action: 'read', id, entryIds: [initial.id] });
  assert.equal(await db.supportRead.count(), 1);
  assert.equal((await supportRead(db, a.id, { id, admin: 'true' })).unreadCount, 1);
  assert.equal((await supportRead(db, b.id, { id, admin: 'true' })).unreadCount, 2);
  await assert.rejects(
    supportRoutingWrite(db, other.id, { action: 'read', id, entryIds: [initial.id] }),
    /NOT_FOUND/,
  );
  await supportWrite(db, a.id, reply(2)); // non-owner admin retains reply rights
  assert.equal((await supportRead(db, u.id, { id })).unreadCount, 1);
  const notice = (await listNotifications(db, u.id, {})).items[0];
  assert.equal(notice.kind, 'SUPPORT_REPLY');
  assert.equal(notice.supportTicketId, id);
  assert.ok(!JSON.stringify(await db.notification.findMany()).includes('PRIVATE'));
  await readNotification(db, u.id, { id: notice.id });
  assert.equal((await supportRead(db, u.id, { id })).unreadCount, 1); // inbox receipt != reply receipt
  const race = await Promise.allSettled([
    supportRoutingWrite(db, a.id, assign(3, a.id)),
    supportRoutingWrite(db, b.id, assign(3, null)),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  await db.user.update({ where: { id: b.id }, data: { role: 'PRIVATE_USER' } });
  assert.equal((await listNotifications(db, b.id, {})).items.length, 0);
  assert.equal((await listNotifications(db, b.id, { summary: 'true' })).unreadCount, 0);
  await assert.rejects(supportRoutingWrite(db, b.id, assign(4, b.id)), /NOT_FOUND/);
  await supportRoutingWrite(db, a.id, assign(4, null)).catch((e) => {
    if (e.message !== 'CONFLICT') throw e;
  });
  const t = await db.supportTicket.findUniqueOrThrow({ where: { id } });
  const seenA = await db.notification.count({ where: { userId: a.id } });
  await supportWrite(db, u.id, reply(t.version));
  assert.equal(await db.notification.count({ where: { userId: a.id } }), seenA + 1);
  const h = supportHandlers(db, async () => u.id);
  assert.equal(
    (
      await h.POST(
        new Request('http://localhost:3000/api/support', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          body: JSON.stringify({ action: 'read', id, entryIds: [initial.id] }),
        }),
      )
    ).status,
    200,
  );
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reject_support_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER reject_support_notice BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION reject_support_notice()`,
  );
  const before = await db.supportTicket.findUniqueOrThrow({ where: { id } }),
    count = await db.supportEntry.count();
  await assert.rejects(supportWrite(db, u.id, reply(before.version)));
  assert.equal(await db.supportEntry.count(), count);
  assert.equal(
    (await db.supportTicket.findUniqueOrThrow({ where: { id } })).version,
    before.version,
  );
  console.log(
    'PASS PM28: assignment eligibility, retries/races, independent exact-entry receipts, inbox links/visibility, owner/fallback routing, non-owner reply rights, atomic notification rollback.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm28_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
}
