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
const name = `autoveri_pm25i_${randomUUID().replaceAll('-', '')}_test`,
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
  const ledger = () => get(admin.id, '?view=ledger');
  assert.equal((await get(null, '?view=ledger')).status, 401);
  assert.equal((await get(a.id, '?view=ledger')).status, 403);
  assert.equal((await get(b.id, '?view=ledger')).status, 403);
  assert.equal((await get(admin.id, '?view=ledger&auctionId=' + randomUUID())).status, 400);
  let r = await ledger();
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal((await r.json()).captureCents, '0');
  // Seed only the ledger's required rows; do not replay completed bidding/sale flows.
  const seed = async () => {
    const x = await db.localProxyAuction.create({
      data: {
        sellerId: randomUUID(),
        buyerIds: [a.id],
        winnerId: a.id,
        status: 'COMPLETED',
        startCents: 100000n,
        incrementCents: 10000n,
        startsAt: new Date(0),
        endsAt: new Date(1),
      },
    });
    const h = await db.localProxyHold.create({
      data: { auctionId: x.id, ownerId: a.id, status: 'CAPTURED', expiresAt: new Date(2) },
    });
    await db.localProxyCapture.create({ data: { auctionId: x.id, holdId: h.id } });
    return { id: x.id, holdId: h.id };
  };
  const one = await seed(),
    two = await seed();
  await db.localProxyRefundCase.create({
    data: {
      auctionId: one.id,
      requestedBy: a.id,
      reason: 'PRIVATE REASON MUST NOT LEAK',
      status: 'APPROVED',
    },
  });
  await db.localProxyRefund.create({
    data: { auctionId: one.id, amountCents: 3000, currency: 'CHF' },
  });
  const before = await db.localProxyAuction.findMany({ orderBy: { id: 'asc' } });
  const good = await (await ledger()).json();
  assert.deepEqual([good.captureCents, good.refundCents, good.netCents], ['6000', '3000', '3000']);
  assert.equal(good.issues.length, 0);
  assert.equal(good.entries.length, 3);
  assert.ok(!JSON.stringify(good).includes('PRIVATE REASON'));
  assert.ok(!JSON.stringify(good).includes(a.id));
  assert.deepEqual(await db.localProxyAuction.findMany({ orderBy: { id: 'asc' } }), before);
  const missing = await db.localProxyAuction.create({
    data: {
      sellerId: randomUUID(),
      buyerIds: [],
      status: 'COMPLETED',
      startCents: 100000n,
      incrementCents: 10000n,
      startsAt: new Date(0),
      endsAt: new Date(1),
    },
  });
  await db.localProxyHold.create({
    data: { auctionId: two.id, ownerId: a.id, status: 'CAPTURED', expiresAt: new Date(2) },
  });
  await db.localProxyRefundCase.create({
    data: {
      auctionId: two.id,
      requestedBy: a.id,
      reason: 'PRIVATE SECOND REASON',
      status: 'APPROVED',
    },
  });
  const bad = await (await ledger()).json();
  assert.ok(bad.issues.find((i) => i.auctionId === missing.id).issues.includes('MISSING_CAPTURE'));
  const codes = bad.issues.find((i) => i.auctionId === two.id).issues;
  for (const c of ['MISSING_REFUND', 'MULTIPLE_CAPTURED_HOLDS', 'UNLINKED_CAPTURED_HOLD'])
    assert.ok(codes.includes(c));
  assert.deepEqual([bad.captureCents, bad.refundCents, bad.netCents], ['6000', '3000', '3000']);
  await db.localProxyCapture.update({ where: { auctionId: two.id }, data: { currency: 'EUR' } });
  const fx = await (await ledger()).json();
  assert.equal(fx.excludedCurrencyCount, 1);
  assert.equal(fx.captureCents, '3000');
  assert.equal(fx.netCents, '0');
  // Actual unique constraints continue preventing duplicate ledger records.
  await assert.rejects(() =>
    db.localProxyCapture.create({ data: { auctionId: one.id, holdId: one.holdId } }),
  );
  await assert.rejects(() =>
    db.localProxyRefund.create({ data: { auctionId: one.id, amountCents: 3000, currency: 'CHF' } }),
  );
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: new Date() } });
  assert.equal((await ledger()).status, 403);
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: null } });
  process.env.LOCAL_PROXY_ENGINE = 'false';
  assert.equal((await ledger()).status, 404);
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
    'PASS: admin-only read-only ledger, accurate totals, private projections, injected missing/duplicate-hold/currency issues, unique constraints, disabled mode and schema alignment.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm25i_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM25I isolated database removed.');
}
