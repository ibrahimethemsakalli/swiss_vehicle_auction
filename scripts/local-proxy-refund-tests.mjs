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
const name = `autoveri_pm25h_${randomUUID().replaceAll('-', '')}_test`,
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
  const make = async () => {
    const id = (await (await post(admin.id, { action: 'create', requestId: randomUUID() })).json())
      .auctionId;
    await post(a.id, { action: 'bid', auctionId: id, requestId: randomUUID(), maximum: '3000' });
    await db.localProxyAuction.update({ where: { id }, data: { endsAt: new Date(0) } });
    await post(admin.id, { action: 'close', auctionId: id });
    await post(admin.id, { action: 'confirm', auctionId: id, requestId: randomUUID() });
    return id;
  };
  const call = (
    id,
    action,
    owner = a.id,
    reason = 'A documented local test reason.',
    requestId = randomUUID(),
  ) => post(owner, { action, auctionId: id, reason, requestId });
  const state = async (id, owner = a.id) => await (await get(owner, '?auctionId=' + id)).json();
  const count = (id) => db.localProxyRefund.count({ where: { auctionId: id } });
  const id = await make(),
    requestId = randomUUID();
  const captureBefore = await db.localProxyCapture.findUniqueOrThrow({ where: { auctionId: id } });
  assert.equal((await call(id, 'requestRefund', b.id)).status, 403);
  assert.equal((await call(id, 'requestRefund', admin.id)).status, 403);
  assert.equal((await call(id, 'approveRefund', a.id)).status, 403);
  assert.equal((await call(id, 'approveRefund', admin.id)).status, 409);
  assert.equal((await call(id, 'requestRefund', a.id, '  short ')).status, 400);
  assert.equal((await call(id, 'requestRefund', a.id, 'x'.repeat(401))).status, 400);
  assert.equal(
    (
      await post(a.id, {
        action: 'requestRefund',
        auctionId: id,
        requestId: randomUUID(),
        reason: 'Some genuine reason',
        amountCents: 9999,
      })
    ).status,
    400,
  );
  const requests = await Promise.all([
    call(id, 'requestRefund', a.id, undefined, requestId),
    call(id, 'requestRefund', a.id, undefined, requestId),
  ]);
  requests.forEach((r) => assert.equal(r.status, 200));
  assert.equal(await db.localProxyRefundCase.count({ where: { auctionId: id } }), 1);
  assert.equal(
    (await call(id, 'requestRefund', a.id, 'Different text for same key', requestId)).status,
    409,
  );
  assert.equal((await call(id, 'requestRefund')).status, 409);
  assert.equal((await state(id, b.id)).refundCase, null);
  assert.equal((await state(id)).refundCase.status, 'PENDING');
  assert.equal((await state(id, admin.id)).refundCase.reason, 'A documented local test reason.');
  assert.ok(!JSON.stringify((await state(id)).refundCase).includes('requestedBy'));
  const decisions = await Promise.all([
    call(id, 'approveRefund', admin.id),
    call(id, 'approveRefund', admin.id),
  ]);
  decisions.forEach((r) => assert.equal(r.status, 200));
  assert.equal(await count(id), 1);
  const approved = (await state(id)).refundCase;
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.refund.amountCents, 3000);
  assert.equal(approved.refund.currency, 'CHF');
  assert.equal((await call(id, 'rejectRefund', admin.id)).status, 409);
  assert.equal((await call(id, 'requestRefund', a.id, undefined, requestId)).status, 200);
  assert.equal((await state(id)).status, 'COMPLETED');
  assert.equal((await state(id)).own.hold.status, 'CAPTURED');
  assert.deepEqual(
    await db.localProxyCapture.findUniqueOrThrow({ where: { auctionId: id } }),
    captureBefore,
  );
  const v = (await state(id)).version;
  await call(id, 'approveRefund', admin.id);
  assert.equal((await state(id)).version, v);
  await post(admin.id, { action: 'confirm', auctionId: id, requestId: randomUUID() });
  assert.equal(await db.localProxyCapture.count({ where: { auctionId: id } }), 1);
  assert.equal(await count(id), 1);
  // Rejection stores a final reason without a refund; it cannot later become approval.
  const rejected = await make();
  await call(rejected, 'requestRefund');
  await call(rejected, 'rejectRefund', admin.id);
  assert.equal((await state(rejected)).refundCase.status, 'REJECTED');
  assert.equal(await count(rejected), 0);
  assert.equal((await call(rejected, 'approveRefund', admin.id)).status, 409);
  // Opposing simultaneous decisions produce exactly one durable outcome.
  const race = await make();
  await call(race, 'requestRefund');
  const raceResults = await Promise.all([
    call(race, 'approveRefund', admin.id),
    call(race, 'rejectRefund', admin.id),
  ]);
  assert.deepEqual(raceResults.map((r) => r.status).sort(), [200, 409]);
  const rs = (await state(race)).refundCase.status;
  assert.equal(await count(race), rs === 'APPROVED' ? 1 : 0);
  // Atomicity: failure at final command receipt rolls back request or approval, refund and event.
  const rollback = await make();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION pm25h_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PM25H_FAULT'; END $$`,
  );
  const addFault = () =>
    db.$executeRawUnsafe(
      `CREATE TRIGGER pm25h_fault BEFORE INSERT ON "LocalProxyCommand" FOR EACH ROW EXECUTE FUNCTION pm25h_fail()`,
    );
  const removeFault = () => db.$executeRawUnsafe('DROP TRIGGER pm25h_fault ON "LocalProxyCommand"');
  await addFault();
  assert.equal((await call(rollback, 'requestRefund')).status, 503);
  assert.equal((await state(rollback)).refundCase, null);
  await removeFault();
  await call(rollback, 'requestRefund');
  const rv = (await state(rollback)).version;
  await addFault();
  assert.equal((await call(rollback, 'approveRefund', admin.id)).status, 503);
  assert.equal((await state(rollback)).refundCase.status, 'PENDING');
  assert.equal(await count(rollback), 0);
  assert.equal((await state(rollback)).version, rv);
  await removeFault();
  await db.$executeRawUnsafe('DROP FUNCTION pm25h_fail()');
  await call(rollback, 'approveRefund', admin.id);
  // Capture is mandatory; an inconsistent completed row must not refund invented funds.
  const missing = (
    await (await post(admin.id, { action: 'create', requestId: randomUUID() })).json()
  ).auctionId;
  const actor = await db.localProxyMember.findUniqueOrThrow({
    where: { auctionId_userId: { auctionId: missing, userId: a.id } },
  });
  await db.localProxyAuction.update({
    where: { id: missing },
    data: { status: 'COMPLETED', winnerId: actor.actorId },
  });
  assert.equal((await call(missing, 'requestRefund')).status, 409);
  const events = await db.localProxyEvent.findMany({ where: { auctionId: id } });
  assert.ok(!JSON.stringify(events).includes('documented local test reason'));
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
    'PASS: private reasoned requests, strict validation/authorization, approval and rejection, single refund, concurrent opposing decisions, replay conflicts, rollback, immutable capture and migration alignment.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm25h_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM25H isolated database removed.');
}
