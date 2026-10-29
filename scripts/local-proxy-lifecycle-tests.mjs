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
const name = `autoveri_pm25f_${randomUUID().replaceAll('-', '')}_test`,
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
  const bid = (auctionId, owner = a.id, maximum = '3000') =>
    post(owner, { action: 'bid', auctionId, maximum, requestId: randomUUID() });
  const state = async (id) => await (await get(a.id, '?auctionId=' + id)).json();
  const finish = (id, action = 'close', owner = admin.id) => post(owner, { action, auctionId: id });
  const due = (id) => db.localProxyAuction.update({ where: { id }, data: { endsAt: new Date(0) } });
  const holds = (id) => db.localProxyHold.findMany({ where: { auctionId: id } });
  const engine = createLocalProxyEngine(target.toString());
  try {
    const id = await make();
    assert.equal((await finish(id)).status, 409); // cannot force premature winner
    assert.equal((await finish(id, 'cancel', a.id)).status, 403);
    assert.equal(
      (await post(admin.id, { action: 'cancel', auctionId: id, winnerId: a.id })).status,
      400,
    );
    assert.equal((await bid(id)).status, 200);
    await due(id);
    const results = await Promise.all([finish(id), finish(id), sweepLocalProxy(db)]);
    assert.equal(results[0].status, 200);
    assert.equal(results[1].status, 200);
    const won = await state(id);
    assert.equal(won.status, 'WON');
    assert.equal(won.winner, 'YOU');
    assert.equal(won.canBid, false);
    assert.equal(won.own.hold.status, 'AUTHORIZED');
    assert.equal((await state(id)).priceCents, '100000');
    const events = await db.localProxyEvent.count({ where: { auctionId: id } });
    await finish(id);
    await sweepLocalProxy(db);
    assert.equal(await db.localProxyEvent.count({ where: { auctionId: id } }), events);
    assert.equal((await bid(id, b.id, '5000')).status, 409);
    assert.ok(!JSON.stringify(won).includes('winnerId'));
    // Cancellation after winner determination releases winner and cannot be reversed by a close retry.
    assert.equal((await finish(id, 'cancel')).status, 200);
    const cancelled = await state(id);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.winner, 'NONE');
    assert.equal(cancelled.own.hold.status, 'RELEASED');
    assert.equal(cancelled.canBid, false);
    const cv = cancelled.version;
    await finish(id, 'cancel');
    await finish(id);
    assert.equal((await state(id)).version, cv);
    assert.equal((await bid(id, b.id, '5000')).status, 409);
    // Empty due auction; worker alone determines outcome.
    const empty = await make();
    await due(empty);
    await sweepLocalProxy(db);
    assert.equal((await state(empty)).status, 'NO_BIDS');
    assert.equal((await holds(empty)).length, 0);
    // Invalid leader hold must never promote a runner-up or create a funded winner.
    const review = await make();
    await bid(review);
    await db.localProxyHold.updateMany({
      where: { auctionId: review },
      data: { expiresAt: new Date(0) },
    });
    await due(review);
    await sweepLocalProxy(db);
    assert.equal((await state(review)).status, 'REVIEW');
    assert.equal((await state(review)).winner, 'NONE');
    assert.ok((await holds(review)).every((h) => h.status === 'RELEASED'));
    // A valid winner's reservation expires later without reopening/reassigning the auction.
    const expiry = await make();
    await bid(expiry);
    await due(expiry);
    await finish(expiry);
    await db.localProxyHold.updateMany({
      where: { auctionId: expiry },
      data: { expiresAt: new Date(0) },
    });
    await sweepLocalProxy(db);
    assert.equal((await state(expiry)).status, 'WON');
    assert.equal((await state(expiry)).own.hold.status, 'RELEASED');
    // Cancellation and bid share the same row lock. Either ordering leaves no active reservation.
    const race = await make();
    await Promise.all([bid(race), finish(race, 'cancel')]);
    assert.equal((await state(race)).status, 'CANCELLED');
    assert.ok((await holds(race)).every((h) => h.status === 'RELEASED'));
    // If a bid extended the deadline before closing obtains the lock, closing must recheck it.
    const extended = await make();
    await db.localProxyAuction.update({
      where: { id: extended },
      data: { endsAt: new Date(Date.now() + 60000) },
    });
    await bid(extended);
    assert.equal((await finish(extended)).status, 409);
    assert.equal((await state(extended)).status, 'OPEN');
    // Force final event write to fail: status and reservation releases must roll back together.
    const rollback = await make();
    await bid(rollback);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION pm25f_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PM25F_FAULT'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER pm25f_fault BEFORE INSERT ON "LocalProxyEvent" FOR EACH ROW EXECUTE FUNCTION pm25f_fail()`,
    );
    assert.equal((await finish(rollback, 'cancel')).status, 503);
    assert.equal((await state(rollback)).status, 'OPEN');
    assert.equal((await state(rollback)).own.hold.status, 'AUTHORIZED');
    await db.$executeRawUnsafe('DROP TRIGGER pm25f_fault ON "LocalProxyEvent"');
    await db.$executeRawUnsafe('DROP FUNCTION pm25f_fail()');
    await finish(rollback, 'cancel');
    // Authorizer failure happens before lifecycle writes.
    const denied = await make();
    await due(denied);
    await assert.rejects(
      () =>
        finishLocalProxy(db, denied, 'close', async () => {
          throw Error('FORBIDDEN');
        }),
      /FORBIDDEN/,
    );
    assert.equal((await state(denied)).status, 'OPEN');
    for (const model of [db.vehicle, db.bid, db.paymentHold, db.outboxEvent])
      assert.equal(await model.count(), 0);
  } finally {
    await engine.disconnect();
  }
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
    'PASS: lifecycle winner/no-bids/review/cancel, release/expiry, permissions, due-time, concurrent close and bid/cancel races, idempotence, rollback, terminal bid rejection and migration alignment.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm25f_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM25F isolated database removed.');
}
