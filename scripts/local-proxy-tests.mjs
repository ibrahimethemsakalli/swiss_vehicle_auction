import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { createLocalProxyEngine } from '../src/lib/local-proxy-engine.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm25d_${randomUUID().replaceAll('-', '')}_test`,
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
let created = false,
  engine;
try {
  await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const run = (args) =>
    spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
      env: process.env,
      encoding: 'utf8',
      timeout: 120000,
    });
  const migration = run(['migrate', 'deploy']);
  assert.equal(migration.status, 0, migration.stderr);
  engine = createLocalProxyEngine(target.toString());
  const fixture = () =>
    engine.createFixture({ start: '1000', increment: '100', durationSeconds: 1800 });
  const f = await fixture(),
    [a, b, c] = f.buyerIds;
  const cmd = (auctionId, maximum, requestId = randomUUID()) => ({ auctionId, maximum, requestId });
  const first = cmd(f.auctionId, '3000');
  const duplicate = await Promise.all([engine.submit(a, first), engine.submit(a, first)]);
  assert.deepEqual(duplicate[0], duplicate[1]);
  assert.equal(duplicate[0].priceCents, '100000');
  assert.equal(await db.localProxyHold.count(), 1);
  assert.equal(await db.localProxyCommand.count(), 1);
  await assert.rejects(() => engine.submit(a, { ...first, maximum: '3100' }), /REQUEST_CONFLICT/);
  await assert.rejects(() => engine.submit(f.sellerId, cmd(f.auctionId, '4000')), /SELF_BID/);
  await assert.rejects(() => engine.submit(randomUUID(), cmd(f.auctionId, '4000')), /FORBIDDEN/);
  await assert.rejects(
    () => engine.submit(b, { ...cmd(f.auctionId, '4000'), ownerId: a }),
    /unrecognized_keys|Unrecognized key/,
  );
  assert.equal(await engine.ownLimit(f.auctionId, b), null);
  await assert.rejects(() => engine.ownLimit(f.auctionId, f.sellerId), /FORBIDDEN/);
  const aHold = (await engine.ownLimit(f.auctionId, a)).hold;
  const raised = await engine.submit(a, cmd(f.auctionId, '3200'));
  assert.equal(raised.priceCents, '100000');
  assert.equal((await engine.ownLimit(f.auctionId, a)).hold.id, aHold.id);
  assert.equal(await db.localProxyHold.count(), 1);
  assert.equal((await engine.events(f.auctionId, b)).length, 1);
  const defended = await engine.submit(b, cmd(f.auctionId, '3150'));
  assert.equal(defended.priceCents, '320000');
  assert.equal(defended.leaderId, a);
  assert.equal((await engine.ownLimit(f.auctionId, b)).hold.status, 'RELEASED');
  const won = await engine.submit(b, cmd(f.auctionId, '3500'));
  assert.equal(won.leaderId, b);
  assert.equal(won.priceCents, '330000');
  assert.equal((await engine.ownLimit(f.auctionId, a)).hold.status, 'RELEASED');
  assert.equal((await engine.ownLimit(f.auctionId, b)).hold.status, 'AUTHORIZED');
  assert.equal(
    await db.localProxyHold.count({ where: { auctionId: f.auctionId, status: 'AUTHORIZED' } }),
    1,
  );
  assert.equal(
    (await engine.submit(a, first)).priceCents,
    '100000',
    'retry returns original receipt, not a second operation',
  );
  // Allowlist every public projection. No maximum or hold metadata can escape.
  for (const event of await engine.events(f.auctionId, c))
    assert.deepEqual(Object.keys(event).sort(), [
      'auctionId',
      'endsAt',
      'leaderId',
      'priceCents',
      'version',
    ]);
  assert.deepEqual(Object.keys(await engine.view(f.auctionId, c)).sort(), [
    'auctionId',
    'endsAt',
    'leaderId',
    'priceCents',
    'version',
  ]);
  await assert.rejects(() => engine.view(f.auctionId, randomUUID()), /FORBIDDEN/);
  // Same maximum concurrently: the first serialized acceptance keeps priority.
  const tie = await fixture();
  const ties = await Promise.all(
    tie.buyerIds.slice(0, 2).map((id) => engine.submit(id, cmd(tie.auctionId, '3000'))),
  );
  const earliest = ties.find((r) => r.version === 1);
  assert.equal((await engine.view(tie.auctionId, tie.sellerId)).leaderId, earliest.leaderId);
  assert.equal((await engine.view(tie.auctionId, tie.sellerId)).priceCents, '300000');
  const race = await fixture();
  await Promise.all(
    race.buyerIds.map((id, i) => engine.submit(id, cmd(race.auctionId, String(3000 + i * 1000)))),
  );
  assert.equal((await engine.view(race.auctionId, race.sellerId)).leaderId, race.buyerIds[2]);
  assert.equal(
    await db.localProxyHold.count({ where: { auctionId: race.auctionId, status: 'AUTHORIZED' } }),
    1,
  );
  const short = await engine.createFixture({
    start: '1000',
    increment: '100',
    durationSeconds: 120,
  });
  const before = await engine.view(short.auctionId, short.sellerId);
  const extended = await engine.submit(short.buyerIds[0], cmd(short.auctionId, '3000'));
  assert.equal(Date.parse(extended.endsAt) - Date.parse(before.endsAt), 120000);
  assert.equal(extended.extended, true);
  const own = await engine.ownLimit(short.auctionId, short.buyerIds[0]);
  await db.localProxyHold.update({ where: { id: own.hold.id }, data: { expiresAt: new Date(0) } });
  const countBefore = await db.localProxyHold.count();
  await assert.rejects(
    () => engine.submit(short.buyerIds[1], cmd(short.auctionId, '4000')),
    /LEADER_HOLD_EXPIRED/,
  );
  assert.equal(await db.localProxyHold.count(), countBefore);
  await db.localProxyAuction.update({
    where: { id: short.auctionId },
    data: { endsAt: new Date(0) },
  });
  await assert.rejects(
    () => engine.submit(short.buyerIds[1], cmd(short.auctionId, '4000')),
    /AUCTION_ENDED/,
  );
  const notStarted = await fixture();
  await db.localProxyAuction.update({
    where: { id: notStarted.auctionId },
    data: { startsAt: new Date(Date.now() + 100000) },
  });
  await assert.rejects(
    () => engine.submit(notStarted.buyerIds[0], cmd(notStarted.auctionId, '3000')),
    /AUCTION_NOT_STARTED/,
  );
  // A failure at the last receipt write must roll back cap, hold, price and outbox together.
  const fault = await fixture();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION pm25d_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PM25D_INJECTED'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER pm25d_fail BEFORE INSERT ON "LocalProxyCommand" FOR EACH ROW EXECUTE FUNCTION pm25d_fail()`,
  );
  await assert.rejects(
    () => engine.submit(fault.buyerIds[0], cmd(fault.auctionId, '3000')),
    /PM25D_INJECTED/,
  );
  assert.equal((await engine.view(fault.auctionId, fault.sellerId)).version, 0);
  for (const model of [db.localProxyLimit, db.localProxyHold, db.localProxyEvent])
    assert.equal(await model.count({ where: { auctionId: fault.auctionId } }), 0);
  await db.$executeRawUnsafe('DROP TRIGGER pm25d_fail ON "LocalProxyCommand"');
  await db.$executeRawUnsafe('DROP FUNCTION pm25d_fail()');
  await engine.submit(fault.buyerIds[0], cmd(fault.auctionId, '3000'));
  const retained = await engine.ownLimit(fault.auctionId, fault.buyerIds[0]);
  await db.$executeRawUnsafe(
    `CREATE FUNCTION pm25d_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PM25D_INJECTED'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER pm25d_fail BEFORE INSERT ON "LocalProxyCommand" FOR EACH ROW EXECUTE FUNCTION pm25d_fail()`,
  );
  await assert.rejects(
    () => engine.submit(fault.buyerIds[1], cmd(fault.auctionId, '4000')),
    /PM25D_INJECTED/,
  );
  assert.equal((await engine.view(fault.auctionId, fault.sellerId)).leaderId, fault.buyerIds[0]);
  assert.equal((await engine.view(fault.auctionId, fault.sellerId)).version, 1);
  assert.equal(
    (await engine.ownLimit(fault.auctionId, fault.buyerIds[0])).hold.status,
    'AUTHORIZED',
  );
  assert.equal(
    (await engine.ownLimit(fault.auctionId, fault.buyerIds[0])).hold.id,
    retained.hold.id,
  );
  assert.equal(await engine.ownLimit(fault.auctionId, fault.buyerIds[1]), null);
  assert.equal(await db.localProxyHold.count({ where: { auctionId: fault.auctionId } }), 1);
  await db.$executeRawUnsafe('DROP TRIGGER pm25d_fail ON "LocalProxyCommand"');
  await db.$executeRawUnsafe('DROP FUNCTION pm25d_fail()');
  await assert.rejects(
    () => engine.submit(fault.buyerIds[1], cmd(fault.auctionId, '1000')),
    /BID_TOO_LOW/,
  );
  assert.equal(await db.localProxyHold.count({ where: { auctionId: fault.auctionId } }), 1);
  await assert.rejects(() => engine.ownLimit(fault.auctionId, a), /FORBIDDEN/);
  // Existing business tables stay untouched.
  for (const model of [db.user, db.vehicle, db.bid, db.paymentHold, db.outboxEvent])
    assert.equal(await model.count(), 0);
  process.env.LOCAL_PROXY_ENGINE = 'false';
  await assert.rejects(() => engine.view(f.auctionId, a), /LOCAL_PROXY_DISABLED/);
  process.env.LOCAL_PROXY_ENGINE = 'true';
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
    'PASS: isolated migration, private limits/public allowlists, authorization boundary, idempotency, equal/max-cap races, one held reservation, release/re-entry, one extension, expired holds, late/start guards, atomic rollback, schema alignment and untouched production tables.',
  );
} finally {
  await engine?.disconnect();
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm25d_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM25D isolated database removed.');
}
