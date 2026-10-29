import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { retentionGet } from '../src/lib/retention-inventory.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm26c_${randomUUID().replaceAll('-', '')}_test`,
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
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migrated.status, 0, migrated.stderr);
  const admin = await db.user.create({
    data: {
      email: 'admin-retention@test.invalid',
      phone: 'TEST-ADMIN',
      passwordHash: 'fixture',
      role: 'ADMIN',
    },
  });
  const buyer = await db.user.create({
    data: {
      email: 'buyer-retention@test.invalid',
      phone: 'TEST-BUYER',
      passwordHash: 'fixture',
      role: 'PRIVATE_USER',
    },
  });
  const get = (id) =>
    retentionGet(db, async () => {
      if (!id) throw Error('UNAUTHORIZED');
      return id;
    })();
  assert.equal((await get(null)).status, 401);
  assert.equal((await get(buyer.id)).status, 403);
  const vehicle = await db.vehicle.create({
    data: {
      userId: admin.id,
      stammnummer: 'TEST',
      vinChassis: randomUUID(),
      make: 'TEST',
      model: 'TEST',
      mileage: 1,
      mfkDate: new Date('2026-01-01'),
      canton: 'ZH',
      serviceHistory: 'UNKNOWN',
      tireCondition: 'UNKNOWN',
      description: 'private vehicle text',
      images: [],
      listingType: 'AUCTION_7_DAYS',
      startPrice: 1000,
    },
  });
  const conversation = await db.conversation.create({
    data: { vehicleId: vehicle.id, sellerId: admin.id, buyerId: buyer.id },
  });
  const messages = [];
  for (let i = 0; i < 2; i++)
    messages.push(
      await db.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: buyer.id,
          requestId: randomUUID(),
          body: 'PRIVATE MESSAGE ' + i,
          createdAt: new Date('2000-01-01'),
        },
      }),
    );
  let response = await get(admin.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  let report = await response.json();
  assert.equal(report.rows.find((r) => r.table === 'ChatMessage').protected, '2'); // PM-26D: recent conversation creation keeps old messages within retention.
  await db.messageReport.create({
    data: {
      messageId: messages[0].id,
      reporterId: buyer.id,
      category: 'TEST',
      note: 'PRIVATE REPORT',
      status: 'CLOSED',
    },
  });
  const before = await db.chatMessage.findMany();
  report = await (await get(admin.id)).json();
  assert.equal(report.rows.find((r) => r.table === 'ChatMessage').protected, '2'); // Closed report protects conversation context too.
  assert.equal(report.rows.find((r) => r.table === 'MessageReport').protected, '1');
  assert.equal(report.totals.candidate, '0');
  assert.equal(
    BigInt(report.totals.count),
    BigInt(report.totals.protected) + BigInt(report.totals.unknown),
  );
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  assert.ok(!JSON.stringify(report).includes(buyer.email));
  assert.deepEqual(await db.chatMessage.findMany(), before);
  assert.deepEqual(report.unscanned, ['support', 'logs', 'backups']);
  // Exercise the actual inventory transaction's READ ONLY mode with an injected write.
  const sabotage = {
    $transaction: (fn, options) =>
      db.$transaction(
        (tx) =>
          fn(
            new Proxy(tx, {
              get(obj, key) {
                if (key === 'user')
                  return {
                    findUnique: async () => {
                      await tx.user.update({
                        where: { id: admin.id },
                        data: { phone: 'MUST-NOT-WRITE' },
                      });
                      return admin;
                    },
                  };
                return Reflect.get(obj, key);
              },
            }),
          ),
        options,
      ),
  };
  assert.equal((await retentionGet(sabotage, async () => admin.id)()).status, 503);
  assert.equal((await db.user.findUnique({ where: { id: admin.id } })).phone, 'TEST-ADMIN');
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: new Date() } });
  assert.equal((await get(admin.id)).status, 403);
  process.env.LOCAL_PROXY_ENGINE = 'false';
  assert.equal((await get(admin.id)).status, 404);
  console.log(
    'PASS PM26C: exact inventory, old unknown messages, closed-report protection, privacy, role gates, read-only transaction and disabled mode.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm26c_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM26C isolated database removed.');
}
