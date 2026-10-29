import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
import { supportRead, supportWrite } from '../src/lib/support.ts';
import { supportHandlers } from '../src/lib/support-http.ts';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = 'autoveri_pm27_' + randomUUID().replaceAll('-', '') + '_test',
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
  async function user(role) {
    const id = randomUUID();
    return db.user.create({
      data: { id, role, email: id + '@test.invalid', phone: id, passwordHash: 'fixture' },
    });
  }
  const a = await user('PRIVATE_USER'),
    b = await user('DEALER'),
    admin = await user('ADMIN');
  const create = {
    action: 'create',
    commandId: randomUUID(),
    subject: 'Support question',
    body: 'Please help with my listing.',
  };
  const { id } = await supportWrite(db, a.id, create);
  assert.deepEqual(await supportWrite(db, a.id, create), { id });
  assert.equal(await db.supportEntry.count(), 1);
  await assert.rejects(
    supportWrite(db, a.id, { ...create, body: 'Different request body' }),
    /CONFLICT/,
  );
  assert.equal((await supportRead(db, b.id, {})).items.length, 0);
  await assert.rejects(supportRead(db, b.id, { id }), /NOT_FOUND/);
  await assert.rejects(supportRead(db, a.id, { admin: 'true' }), /FORBIDDEN/);
  assert.equal((await supportRead(db, admin.id, { admin: 'true' })).items.length, 1);
  const reply = (version, extra = {}) => ({
    action: 'reply',
    id,
    version,
    commandId: randomUUID(),
    body: 'An explanatory reply for this request.',
    ...extra,
  });
  await assert.rejects(supportWrite(db, a.id, reply(0, { status: 'RESOLVED' })), /FORBIDDEN/);
  await assert.rejects(supportWrite(db, b.id, reply(0)), /NOT_FOUND/);
  await supportWrite(db, admin.id, reply(0, { status: 'WAITING_USER' }));
  assert.equal((await supportRead(db, a.id, { id })).ticket.status, 'WAITING_USER');
  const race = await Promise.allSettled([
    supportWrite(db, a.id, reply(1)),
    supportWrite(db, admin.id, reply(1, { status: 'RESOLVED' })),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  await supportWrite(db, admin.id, reply(2, { status: 'RESOLVED' }));
  await supportWrite(db, a.id, reply(3));
  assert.equal((await supportRead(db, a.id, { id })).ticket.status, 'OPEN');
  await supportWrite(db, admin.id, reply(4, { status: 'CLOSED' }));
  await assert.rejects(supportWrite(db, a.id, reply(5)), /CLOSED/);
  await supportWrite(db, admin.id, reply(5, { status: 'OPEN' }));
  const detail = await supportRead(db, a.id, { id });
  assert.equal(detail.entries.length, 7);
  assert.equal(detail.entries[0].staff, false);
  await db.user.update({ where: { id: admin.id }, data: { role: 'PRIVATE_USER' } });
  await assert.rejects(supportRead(db, admin.id, { admin: 'true' }), /FORBIDDEN/);
  await db.user.update({ where: { id: a.id }, data: { suspendedAt: new Date() } });
  await assert.rejects(supportWrite(db, a.id, reply(6)), /FORBIDDEN/);
  await db.user.update({ where: { id: a.id }, data: { suspendedAt: null } });
  const h = supportHandlers(db, async () => a.id);
  assert.equal(
    (
      await h.POST(
        new Request('http://localhost:3000/api/support', {
          method: 'POST',
          headers: { origin: 'https://evil.invalid' },
          body: JSON.stringify(create),
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await h.POST(
        new Request('http://localhost:3000/api/support', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          body: 'x'.repeat(20001),
        }),
      )
    ).status,
    400,
  );
  assert.match(
    (await h.GET(new Request('http://localhost:3000/api/support'))).headers.get('Cache-Control'),
    /no-store/,
  );
  for (let i = 0; i < 9; i++) await supportWrite(db, a.id, { ...create, commandId: randomUUID() });
  await assert.rejects(supportWrite(db, a.id, { ...create, commandId: randomUUID() }), /LIMIT/);
  console.log(
    'PASS PM27: ownership, admin role, status history, retry, concurrency, reopen, closed guard, suspension, CSRF, size cap and active ticket quota.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm27_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
}
