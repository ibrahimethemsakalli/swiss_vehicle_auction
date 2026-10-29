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
const name = 'autoveri_pm29_' + randomUUID().replaceAll('-', '') + '_test',
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
    b = await user('ADMIN');
  async function fixture(subject, ownerId = null, actorId = u.id, status = 'OPEN', userId = u.id) {
    return db.supportTicket.create({
      data: {
        subject,
        ownerId,
        userId,
        status,
        entries: {
          create: {
            actorId,
            commandId: randomUUID(),
            payload: 'fixture',
            body: 'SECRET_BODY_ONLY',
            staff: actorId !== userId,
            status,
          },
        },
      },
      include: { entries: true },
    });
  }
  const mine = await fixture('Alpha help', a.id),
    unassigned = await fixture('Alpha unassigned'),
    theirs = await fixture('Alpha other', b.id),
    read = await fixture('Alpha read', a.id),
    own = await fixture('Alpha own', a.id, a.id),
    closed = await fixture('Alpha closed', a.id, u.id, 'CLOSED'),
    foreign = await fixture('Foreign private', null, other.id, 'OPEN', other.id),
    literal = await fixture('100%_special\\text');
  await db.supportRead.create({ data: { entryId: read.entries[0].id, userId: a.id } });
  const ids = async (id, q) => (await supportRead(db, id, q)).items.map((i) => i.id).sort();
  assert.deepEqual(
    await ids(a.id, {
      admin: 'true',
      assignment: 'mine',
      unread: 'true',
      status: 'OPEN',
      q: '  ALPHA ',
    }),
    [mine.id].sort(),
  );
  assert.deepEqual(await ids(b.id, { admin: 'true', assignment: 'mine' }), [theirs.id]);
  assert.deepEqual(await ids(a.id, { admin: 'true', assignment: 'unassigned', q: 'Alpha' }), [
    unassigned.id,
  ]);
  assert.deepEqual(await ids(a.id, { admin: 'true', q: mine.id.toUpperCase() }), [mine.id]);
  assert.deepEqual(await ids(a.id, { admin: 'true', q: mine.id.slice(0, 8) }), []);
  assert.deepEqual(await ids(a.id, { admin: 'true', q: 'SECRET_BODY_ONLY' }), []);
  for (const q of ['%', '_', '\\'])
    assert.deepEqual(await ids(a.id, { admin: 'true', q }), [literal.id]);
  assert.deepEqual(await ids(u.id, { q: foreign.id }), []);
  await assert.rejects(supportRead(db, u.id, { assignment: 'mine' }), /FORBIDDEN/);
  await assert.rejects(supportRead(db, u.id, { admin: 'true', q: foreign.id }), /FORBIDDEN/);
  // A user's unread filter uses their receipts, not the admin's receipts.
  assert.deepEqual(await ids(u.id, { unread: 'true' }), [own.id]);
  await db.supportRead.create({ data: { entryId: mine.entries[0].id, userId: a.id } });
  assert.deepEqual(
    await ids(a.id, {
      admin: 'true',
      assignment: 'mine',
      unread: 'true',
      status: 'OPEN',
      q: 'Alpha',
    }),
    [],
  );
  await db.supportTicket.update({ where: { id: unassigned.id }, data: { ownerId: a.id } });
  assert.deepEqual(await ids(a.id, { admin: 'true', assignment: 'unassigned', q: 'Alpha' }), []);
  assert.ok((await ids(a.id, { admin: 'true' })).includes(unassigned.id));
  for (let i = 0; i < 23; i++) await fixture('Page marker ' + String(i).padStart(2, '0'));
  const first = await supportRead(db, a.id, { admin: 'true', q: 'page marker', page: 1 }),
    second = await supportRead(db, a.id, { admin: 'true', q: 'page marker', page: 2 });
  assert.equal(first.items.length, 20);
  assert.equal(first.more, true);
  assert.equal(second.items.length, 3);
  assert.equal(second.more, false);
  assert.equal(new Set([...first.items, ...second.items].map((i) => i.id)).size, 23);
  const handler = supportHandlers(db, async () => a.id);
  const response = await handler.GET(
    new Request('http://localhost:3000/api/support?admin=true&assignment=mine&unread=true&q=Alpha'),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(
    (await handler.GET(new Request('http://localhost:3000/api/support?assignment=invalid'))).status,
    400,
  );
  console.log(
    'PASS PM29: combined filters, per-viewer unread, literal search, exact ID, ownership, role guards, changed assignment/read results, pagination and HTTP query validation.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm29_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
}
