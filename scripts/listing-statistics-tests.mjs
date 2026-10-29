import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm22_${randomUUID().replaceAll('-', '')}_test`,
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()));
const control = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migration.status, 0, migration.stderr);
  const {
    recordListingView,
    readListingStatistics,
    cleanupListingViews,
    statisticsSince,
    statisticsDay,
    dailyViewerToken,
  } = await import('../src/lib/listing-statistics.ts');
  const { statisticsHandlers } = await import('../src/lib/listing-statistics-http.ts');
  process.env.LOCAL_TEST_PAYMENTS = 'true';
  const now = new Date('2026-10-28T12:00:00Z');
  const createUser = (tag, patch = {}) =>
    db.user.create({
      data: {
        email: `${tag}@pm22.test`,
        phone: tag,
        passwordHash: 'test',
        emailVerifiedAt: now,
        ...patch,
      },
    });
  const seller = await createUser('seller'),
    buyer = await createUser('buyer'),
    outsider = await createUser('outsider'),
    admin = await createUser('admin', { role: 'ADMIN' });
  const vehicle = await db.vehicle.create({
    data: {
      userId: seller.id,
      vinChassis: randomUUID(),
      stammnummer: 'pm22',
      make: 'LOCAL TEST',
      model: 'Statistics',
      mileage: 0,
      canton: 'BE',
      mfkStatus: 'UNKNOWN',
      serviceHistory: 'NONE',
      tireCondition: 'unknown',
      description: 'Synthetic',
      images: [],
      startPrice: 1000,
      listingType: 'AUCTION_7_DAYS',
      status: 'ACTIVE',
      auctionEndsAt: new Date('2030-01-01'),
    },
  });
  const record = (id = buyer.id, ua = 'Mozilla/5.0 Safari/537.36', date = now) =>
    recordListingView(db, id, { vehicleId: vehicle.id }, ua, date);
  await Promise.all(Array.from({ length: 6 }, () => record()));
  assert.equal(await db.listingViewDay.count(), 1);
  await record(seller.id);
  await record(admin.id);
  await record(outsider.id, 'Googlebot');
  assert.equal(await db.listingViewDay.count(), 1);
  await db.user.update({ where: { id: outsider.id }, data: { suspendedAt: now } });
  await record(outsider.id);
  assert.equal(await db.listingViewDay.count(), 1);
  await db.user.update({
    where: { id: outsider.id },
    data: { suspendedAt: null, emailVerifiedAt: null },
  });
  await record(outsider.id);
  assert.equal(await db.listingViewDay.count(), 1);
  for (const patch of [
    { isSample: true },
    { status: 'DRAFT' },
    { status: 'EXPIRED' },
    { status: 'SOLD' },
    { status: 'ACTIVE', auctionEndsAt: new Date(0) },
  ]) {
    await db.vehicle.update({ where: { id: vehicle.id }, data: { isSample: false, ...patch } });
    await record(buyer.id, 'Mozilla/5.0', new Date('2026-10-29'));
    assert.equal(await db.listingViewDay.count(), 1);
  }
  await db.vehicle.update({
    where: { id: vehicle.id },
    data: { status: 'ACTIVE', auctionEndsAt: new Date('2030-01-01') },
  });
  await record(buyer.id, 'Mozilla/5.0', new Date('2026-10-27'));
  assert.equal(await db.listingViewDay.count(), 2);
  await db.favorite.createMany({
    data: [
      { userId: seller.id, vehicleId: vehicle.id },
      { userId: buyer.id, vehicleId: vehicle.id },
    ],
  });
  const conversation = await db.conversation.create({
    data: { vehicleId: vehicle.id, buyerId: buyer.id, sellerId: seller.id, createdAt: now },
  });
  let stats = await readListingStatistics(db, seller.id, {}, now);
  assert.equal(stats.rows[0].contacts, 0);
  await db.chatMessage.create({
    data: {
      conversationId: conversation.id,
      senderId: buyer.id,
      requestId: randomUUID(),
      body: 'Synthetic contact',
      createdAt: now,
    },
  });
  stats = await readListingStatistics(db, seller.id, {}, now);
  assert.deepEqual(
    [stats.rows[0].views, stats.rows[0].favorites, stats.rows[0].contacts],
    [2, 1, 1],
  );
  assert.ok(!JSON.stringify(stats).includes(buyer.id));
  assert.ok(!JSON.stringify(stats).includes('viewerToken'));
  assert.equal((await readListingStatistics(db, buyer.id, {}, now)).rows.length, 0);
  await db.favorite.delete({
    where: { userId_vehicleId: { userId: buyer.id, vehicleId: vehicle.id } },
  });
  await db.chatMessage.updateMany({
    where: { conversationId: conversation.id },
    data: { hiddenAt: now },
  });
  stats = await readListingStatistics(db, seller.id, {}, now);
  assert.equal(stats.rows[0].favorites, 0);
  assert.equal(stats.rows[0].contacts, 0);
  const oldDay = new Date(statisticsSince(now).getTime() - 86400000);
  await db.listingViewDay.create({
    data: { vehicleId: vehicle.id, day: oldDay, viewerToken: 'old' },
  });
  assert.equal((await cleanupListingViews(db, now)).count, 1);
  assert.equal(await db.listingViewDay.count(), 2);
  const token = dailyViewerToken(buyer.id, statisticsDay(now), process.env.NEXTAUTH_SECRET);
  await db.vehicle.createMany({
    data: Array.from({ length: 101 }, (_, i) => ({
      id: randomUUID(),
      userId: seller.id,
      vinChassis: randomUUID(),
      stammnummer: 'quota',
      make: 'LOCAL TEST',
      model: `Quota ${i}`,
      mileage: 0,
      canton: 'BE',
      mfkStatus: 'UNKNOWN',
      serviceHistory: 'NONE',
      tireCondition: 'unknown',
      description: 'Synthetic',
      images: [],
      startPrice: 1000,
      listingType: 'FIXED_PRICE_OFFERS',
      status: 'ACTIVE',
    })),
  });
  const extra = await db.vehicle.findMany({
    where: { stammnummer: 'quota' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  await db.listingViewDay.createMany({
    data: extra
      .slice(0, 99)
      .map((v) => ({ vehicleId: v.id, day: statisticsDay(now), viewerToken: token })),
  });
  await recordListingView(db, buyer.id, { vehicleId: extra[100].id }, 'Mozilla/5.0', now);
  assert.equal(
    await db.listingViewDay.count({ where: { viewerToken: token, day: statisticsDay(now) } }),
    100,
  );
  const first = await readListingStatistics(db, seller.id, { page: 1 }, now),
    second = await readListingStatistics(db, seller.id, { page: 2 }, now);
  assert.equal(first.rows.length, 20);
  assert.equal(first.total, 102);
  assert.equal(new Set([...first.rows, ...second.rows].map((v) => v.id)).size, 40);
  process.env.NODE_ENV = 'production';
  await record();
  assert.equal((await readListingStatistics(db, seller.id, {}, now)).collectionEnabled, false);
  assert.ok(
    (await readListingStatistics(db, seller.id, {}, now)).rows.every((v) => v.views === null),
  );
  process.env.NODE_ENV = 'test';
  const handlers = statisticsHandlers(db, async () => seller.id);
  const response = await handlers.GET(new Request('http://127.0.0.1:3000/api/listing-statistics'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(
    (
      await statisticsHandlers(db, async () => {
        throw Error('UNAUTHORIZED');
      }).GET(new Request('http://localhost'))
    ).status,
    401,
  );
  assert.equal(
    (await handlers.GET(new Request('http://localhost/?userId=' + buyer.id))).status,
    400,
  );
  const post = (body, origin = 'http://127.0.0.1:3000') =>
    handlers.POST(
      new Request('http://127.0.0.1:3000/api/listing-statistics', {
        method: 'POST',
        headers: { origin, 'user-agent': 'Mozilla/5.0' },
        body,
      }),
    );
  assert.equal(
    (await post(JSON.stringify({ vehicleId: vehicle.id }), 'https://evil.test')).status,
    403,
  );
  assert.equal((await post('x'.repeat(513))).status, 400);
  assert.equal(
    (await post(JSON.stringify({ vehicleId: vehicle.id, userId: buyer.id }))).status,
    400,
  );
  assert.equal((await post(JSON.stringify({ vehicleId: vehicle.id }))).status, 200);
  const diff = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(diff.status, 0, diff.stdout + diff.stderr);
  console.log(
    'PASS: concurrent deduplication, owner/admin/bot/sample/state exclusions, quota, UTC retention, truthful counters, ownership/privacy, pagination, production off, HTTP boundaries and schema alignment.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm22_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM22 isolated database removed.');
}
