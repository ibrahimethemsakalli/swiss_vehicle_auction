import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { localProxyHandlers } from '../src/lib/local-proxy-http.ts';
import { createLocalProxyEngine } from '../src/lib/local-proxy-engine.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm25e_${randomUUID().replaceAll('-', '')}_test`,
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
  const create = { action: 'create', requestId: randomUUID() };
  assert.equal((await get(null)).status, 401);
  assert.equal((await post(a.id, create)).status, 403);
  assert.equal((await post(admin.id, create, 'https://evil.test')).status, 403);
  const responses = await Promise.all([post(admin.id, create), post(admin.id, create)]);
  for (const r of responses) assert.equal(r.status, 200);
  const room = await responses[0].json();
  assert.deepEqual(await responses[1].json(), room);
  assert.equal(await db.localProxyRoom.count(), 1);
  assert.equal(await db.localProxyMember.count(), 3);
  const auctionId = room.auctionId;
  const bid = { action: 'bid', auctionId, requestId: randomUUID(), maximum: '3000.17' };
  assert.equal((await post(admin.id, bid)).status, 403);
  assert.equal((await post(a.id, { ...bid, actorId: b.id })).status, 400);
  assert.equal((await post(a.id, bid)).status, 200);
  const mine = await (await get(a.id, '?auctionId=' + auctionId)).json();
  assert.equal(mine.own.maximumCents, '300017');
  assert.equal(mine.own.hold.amountCents, 3000);
  assert.equal(mine.leader, 'YOU');
  const otherResponse = await get(b.id, '?auctionId=' + auctionId);
  assert.equal(otherResponse.headers.get('cache-control'), 'private, no-store');
  const other = await otherResponse.json();
  assert.equal(other.own, null);
  assert.equal(other.leader, 'OTHER');
  assert.ok(!JSON.stringify(other).includes('300017'));
  assert.ok(!('actorId' in other));
  const seller = await (await get(admin.id, '?auctionId=' + auctionId)).json();
  assert.equal(seller.role, 'SELLER');
  assert.equal(seller.own, null);
  assert.equal(seller.canBid, false);
  const win = await post(b.id, { ...bid, requestId: randomUUID(), maximum: '3500' });
  assert.equal(win.status, 200);
  assert.deepEqual(Object.keys(await win.json()).sort(), ['auctionId', 'ok']);
  assert.equal(
    (await (await get(a.id, '?auctionId=' + auctionId)).json()).own.hold.status,
    'RELEASED',
  );
  const replay = await post(a.id, bid);
  assert.equal(replay.status, 200);
  assert.equal(await db.localProxyHold.count(), 2);
  assert.equal((await get(a.id, '?auctionId=' + randomUUID())).status, 403);
  assert.equal((await get(a.id, '?userId=' + b.id)).status, 400);
  await db.user.update({ where: { id: a.id }, data: { suspendedAt: new Date() } });
  assert.equal((await get(a.id)).status, 403);
  assert.equal(
    (await post(a.id, { ...bid, maximum: '4000', requestId: randomUUID() })).status,
    403,
  );
  await db.user.update({ where: { id: a.id }, data: { suspendedAt: null } });
  await db.user.update({ where: { id: a.id }, data: { phone: 'not-fixture' } });
  assert.equal((await get(a.id)).status, 403);
  await db.user.update({ where: { id: a.id }, data: { phone: 'LOCAL-LOGIN-0' } });
  await db.user.update({ where: { id: a.id }, data: { emailVerifiedAt: null } });
  assert.equal((await get(a.id)).status, 403);
  await db.user.update({ where: { id: a.id }, data: { emailVerifiedAt: new Date() } });
  assert.equal((await post(a.id, { padding: 'x'.repeat(2200) })).status, 400);
  assert.equal(
    (await handlers(a.id).GET(new Request('http://remote.test/api/local-proxy'))).status,
    404,
  );
  // Authorization callback runs before any engine write, inside its lock/transaction.
  const m = await db.localProxyMember.findUniqueOrThrow({
    where: { auctionId_userId: { auctionId, userId: a.id } },
  });
  const engine = createLocalProxyEngine(target.toString());
  try {
    await assert.rejects(
      () =>
        engine.submit(
          m.actorId,
          { auctionId, requestId: randomUUID(), maximum: '5000' },
          async () => {
            throw Error('FORBIDDEN');
          },
        ),
      /FORBIDDEN/,
    );
  } finally {
    await engine.disconnect();
  }
  assert.equal(await db.localProxyHold.count(), 2);
  const leaderLimit = await db.localProxyLimit.findFirstOrThrow({
    where: {
      auctionId,
      ownerId: (
        await db.localProxyMember.findUniqueOrThrow({
          where: { auctionId_userId: { auctionId, userId: b.id } },
        })
      ).actorId,
    },
  });
  await db.localProxyHold.update({
    where: { id: leaderLimit.holdId },
    data: { expiresAt: new Date(0) },
  });
  const expired = await (await get(b.id, '?auctionId=' + auctionId)).json();
  assert.equal(expired.own.hold.status, 'EXPIRED');
  assert.equal(expired.blocked, true);
  assert.equal(expired.canBid, false);
  await db.localProxyAuction.update({ where: { id: auctionId }, data: { endsAt: new Date(0) } });
  assert.equal((await (await get(a.id, '?auctionId=' + auctionId)).json()).closed, true);
  process.env.LOCAL_PROXY_ENGINE = 'false';
  assert.equal((await get(a.id)).status, 404);
  process.env.LOCAL_PROXY_ENGINE = 'true';
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
    'PASS: atomic room mapping, session/role/verified fixture guards, owner-only limits, seller privacy, no actor spoofing, CSRF/host/body/query limits, no-store, repeated request, authorization callback rollback, expiry display, disabled mode and migration alignment.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm25e_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM25E isolated database removed.');
}
