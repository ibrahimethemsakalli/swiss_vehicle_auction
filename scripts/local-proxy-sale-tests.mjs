import 'dotenv/config';
import { finishLocalProxy, sweepLocalProxy } from '../src/lib/local-proxy-lifecycle.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { localProxyHandlers } from '../src/lib/local-proxy-http.ts';
import { createLocalProxyEngine } from '../src/lib/local-proxy-engine.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm25g_${randomUUID().replaceAll('-', '')}_test`,
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()), {
  NODE_ENV: 'test',
  LOCAL_PROXY_ENGINE: 'true',
});
const control = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const run = (args) =>
    spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
      env: process.env,
      encoding: 'utf8',
      timeout: 120000,
    });
  const migrated = run(['migrate', 'deploy']);
  assert.equal(migrated.status, 0, migrated.stderr);
  const users = [];
  for (const [i, label] of ['private_user', 'dealer', 'admin'].entries())
    users.push(
      await db.user.create({
        data: {
          email: `${label}@local.autoveri.test`,
          phone: `LOCAL-LOGIN-${i}`,
          role: ['PRIVATE_USER', 'DEALER', 'ADMIN'][i],
          passwordHash: 'fixture',
          isIdentityVerified: true,
          emailVerifiedAt: new Date(),
          phoneVerifiedAt: new Date(),
        },
      }),
    );
  const [a, b, admin] = users;
  const handlers = (id) =>
    localProxyHandlers(
      db,
      async () => {
        if (!id) throw Error('UNAUTHORIZED');
        return id;
      },
      target.toString(),
    );
  const get = (id, query = '') =>
    handlers(id).GET(new Request('http://127.0.0.1:3000/api/local-proxy' + query));
  const post = (id, body, origin = 'http://127.0.0.1:3000') =>
    handlers(id).POST(
      new Request('http://127.0.0.1:3000/api/local-proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      }),
    );
  const make = async () =>
    (await (await post(admin.id, { action: 'create', requestId: randomUUID() })).json()).auctionId;
  const cmd = (id, action, owner = admin.id, requestId = randomUUID()) =>
    post(owner, {
      action,
      auctionId: id,
      ...(['renew', 'confirm'].includes(action) ? { requestId } : {}),
    });
  const state = async (id, owner = a.id) => await (await get(owner, '?auctionId=' + id)).json();
  const won = async () => {
    const id = await make();
    assert.equal(
      (await post(a.id, { action: 'bid', auctionId: id, maximum: '3000', requestId: randomUUID() }))
        .status,
      200,
    );
    await db.localProxyAuction.update({ where: { id }, data: { endsAt: new Date(0) } });
    await cmd(id, 'close');
    return id;
  };
  const expire = (id) =>
    db.localProxyHold.updateMany({
      where: { auctionId: id, status: 'AUTHORIZED' },
      data: { expiresAt: new Date(0) },
    });
  const count = (id) => db.localProxyCapture.count({ where: { auctionId: id } });
  const id = await won();
  assert.equal((await cmd(id, 'confirm', a.id)).status, 403);
  assert.equal((await cmd(id, 'renew', b.id)).status, 403);
  assert.equal((await cmd(id, 'renew', admin.id)).status, 403);
  assert.equal(
    (
      await post(admin.id, {
        action: 'confirm',
        auctionId: id,
        requestId: randomUUID(),
        amountCents: 1,
      })
    ).status,
    400,
  );
  await expire(id);
  assert.equal((await cmd(id, 'confirm')).status, 409);
  assert.equal(await count(id), 0);
  const requestId = randomUUID();
  const renewals = await Promise.all([
    cmd(id, 'renew', a.id, requestId),
    cmd(id, 'renew', a.id, requestId),
  ]);
  renewals.forEach((r) => assert.equal(r.status, 200));
  assert.equal(await db.localProxyHold.count({ where: { auctionId: id } }), 2);
  assert.equal(
    await db.localProxyHold.count({ where: { auctionId: id, status: 'AUTHORIZED' } }),
    1,
  );
  const renewed = await state(id);
  assert.equal(renewed.own.hold.status, 'AUTHORIZED');
  const expiry = renewed.own.hold.expiresAt;
  await cmd(id, 'renew', a.id);
  assert.equal((await state(id)).own.hold.expiresAt, expiry);
  // A stale renewal receipt cannot re-authorize after its replacement expires.
  await expire(id);
  await sweepLocalProxy(db);
  await cmd(id, 'renew', a.id, requestId);
  assert.equal((await state(id)).own.hold.status, 'RELEASED');
  await cmd(id, 'renew', a.id);
  assert.equal((await state(id)).own.hold.status, 'AUTHORIZED');
  // Concurrent different confirmations still produce a single capture.
  const confirmations = await Promise.all([
    cmd(id, 'confirm'),
    cmd(id, 'confirm'),
    cmd(id, 'confirm'),
  ]);
  confirmations.forEach((r) => assert.equal(r.status, 200));
  assert.equal(await count(id), 1);
  const completed = await state(id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.own.hold.status, 'CAPTURED');
  assert.equal(completed.capture.amountCents, 3000);
  assert.equal(completed.capture.currency, 'CHF');
  assert.equal(completed.canBid, false);
  assert.deepEqual(Object.keys(completed.capture).sort(), [
    'amountCents',
    'capturedAt',
    'currency',
  ]);
  assert.equal((await cmd(id, 'cancel')).status, 409);
  assert.equal((await cmd(id, 'renew', a.id)).status, 409);
  const version = completed.version;
  await cmd(id, 'confirm');
  await sweepLocalProxy(db);
  assert.equal((await state(id)).version, version);
  assert.equal(await count(id), 1);
  assert.equal(
    (await post(a.id, { action: 'bid', auctionId: id, maximum: '5000', requestId: randomUUID() }))
      .status,
    409,
  );
  // Cancel/confirm race: either fully cancelled without capture, or fully completed with exactly one.
  const race = await won();
  await Promise.all([cmd(race, 'confirm'), cmd(race, 'cancel')]);
  const rs = await state(race);
  assert.ok(['CANCELLED', 'COMPLETED'].includes(rs.status));
  assert.equal(await count(race), rs.status === 'COMPLETED' ? 1 : 0);
  assert.equal(rs.own.hold.status, rs.status === 'COMPLETED' ? 'CAPTURED' : 'RELEASED');
  // Renewal/cancel race never leaves a live reservation after cancellation.
  const cancel = await won();
  await expire(cancel);
  await Promise.all([cmd(cancel, 'renew', a.id), cmd(cancel, 'cancel')]);
  assert.equal((await state(cancel)).status, 'CANCELLED');
  assert.equal(await count(cancel), 0);
  assert.equal(
    await db.localProxyHold.count({ where: { auctionId: cancel, status: 'AUTHORIZED' } }),
    0,
  );
  assert.equal((await cmd(cancel, 'confirm')).status, 409);
  assert.equal((await cmd(cancel, 'renew', a.id)).status, 403);
  const open = await make();
  assert.equal((await cmd(open, 'confirm')).status, 409);
  await db.localProxyAuction.update({ where: { id: open }, data: { endsAt: new Date(0) } });
  await cmd(open, 'close');
  assert.equal((await cmd(open, 'confirm')).status, 409);
  // Fault at final receipt rolls capture, hold, auction and event back together.
  const rollback = await won();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION pm25g_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PM25G_FAULT'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER pm25g_fault BEFORE INSERT ON "LocalProxyCommand" FOR EACH ROW EXECUTE FUNCTION pm25g_fail()`,
  );
  assert.equal((await cmd(rollback, 'confirm')).status, 503);
  assert.equal(await count(rollback), 0);
  assert.equal((await state(rollback)).status, 'WON');
  assert.equal((await state(rollback)).own.hold.status, 'AUTHORIZED');
  await expire(rollback);
  const hc = await db.localProxyHold.count({ where: { auctionId: rollback } });
  assert.equal((await cmd(rollback, 'renew', a.id)).status, 503);
  assert.equal(await db.localProxyHold.count({ where: { auctionId: rollback } }), hc);
  await db.$executeRawUnsafe('DROP TRIGGER pm25g_fault ON "LocalProxyCommand"');
  await db.$executeRawUnsafe('DROP FUNCTION pm25g_fail()');
  await cmd(rollback, 'renew', a.id);
  assert.equal((await cmd(rollback, 'confirm')).status, 200);
  for (const model of [db.vehicle, db.bid, db.paymentHold, db.outboxEvent])
    assert.equal(await model.count(), 0);
  const diff = run([
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--exit-code',
  ]);
  assert.equal(diff.status, 0, diff.stdout + diff.stderr);
  console.log(
    'PASS: renewal ownership/expiry/replay, one capture under concurrent confirmation, cancellation races, terminal guards, rollback and migration alignment.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm25g_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM25G isolated database removed.');
}
