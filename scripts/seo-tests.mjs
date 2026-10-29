import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm20_${randomUUID().replaceAll('-', '')}_test`,
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
  const { readPublicDetail, indexableVehicles } = await import('../src/lib/seo-data.ts');
  const { sitemapIndex, sitemapPage } = await import('../src/lib/seo-sitemap.ts');
  const seller = await db.user.create({
    data: { email: 'seo-fixture@example.org', phone: 'pm20-test', passwordHash: 'not-a-login' },
  });
  const base = {
    userId: seller.id,
    make: 'Fixture',
    model: 'SEO only',
    mileage: 1234,
    canton: 'BE',
    mfkStatus: 'UNKNOWN',
    serviceHistory: 'NONE',
    tireCondition: 'unknown',
    description: 'Synthetic isolated fixture',
    images: [],
    listingType: 'AUCTION_7_DAYS',
    startPrice: 1000,
    status: 'ACTIVE',
    auctionEndsAt: new Date(Date.now() + 3600000),
  };
  const make = (tag, patch = {}) =>
    db.vehicle.create({ data: { ...base, vinChassis: tag, stammnummer: tag, ...patch } });
  const active = await make('active'),
    sold = await make('sold', { status: 'SOLD' }),
    expired = await make('expired', { auctionEndsAt: new Date(0) }),
    sample = await make('sample', { isSample: true }),
    draft = await make('draft', { status: 'DRAFT' });
  await make('pending', { status: 'PENDING_VERIFICATION' });
  await make('rejected', { status: 'REJECTED' });
  await make('local', { make: 'LOCAL TEST' });
  const ids = (await db.vehicle.findMany({ where: indexableVehicles(), select: { id: true } })).map(
    (v) => v.id,
  );
  assert.deepEqual(ids, [active.id]);
  assert.equal(await readPublicDetail(draft.id), null);
  assert.equal(await readPublicDetail(randomUUID()), null);
  for (const v of [sold, expired, sample])
    assert.equal((await readPublicDetail(v.id)).eligible, false);
  const detail = await readPublicDetail(active.id);
  assert.equal(detail.eligible, true);
  assert.ok(!JSON.stringify(detail).includes(seller.email));
  assert.ok(!JSON.stringify(detail).includes('passwordHash'));
  await db.vehicle.createMany({
    data: Array.from({ length: 1000 }, (_, i) => ({
      ...base,
      id: randomUUID(),
      vinChassis: `page-${i}`,
      stammnummer: `page-${i}`,
    })),
  });
  process.env.NODE_ENV = 'production';
  Object.assign(process.env, {
    LAUNCH_MODE: 'public',
    LAUNCH_LEGAL_VERSION: 'synthetic-v1',
    NEXTAUTH_URL: 'https://cars.example.org',
    NEXTAUTH_SECRET: 'synthetic-unit-test-key-01234567890123456789',
    UPLOAD_DIR: '/synthetic/uploads',
    LOCAL_PROXY_ENGINE: 'false',
    LOCAL_REFUND_POLICY_WORKER: 'false',
    LOCAL_TEST_MESSAGES: 'false',
    LOCAL_TEST_PAYMENTS: 'false',
  });
  process.env.PUBLIC_SITE_URL = 'https://cars.example.org';
  process.env.SEO_INDEXING_ENABLED = 'true';
  const index = await (await sitemapIndex()).text();
  assert.equal((index.match(/<sitemap>/g) ?? []).length, 2);
  const first = await (await sitemapPage('0')).text(),
    second = await (await sitemapPage('1')).text();
  assert.equal((first.match(/<url>/g) ?? []).length, 4004);
  assert.equal((second.match(/<url>/g) ?? []).length, 4);
  assert.equal((await sitemapPage('2')).status, 404);
  const urls = [...(first + second).matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  assert.equal(new Set(urls).size, urls.length);
  for (const v of [sold, expired, sample, draft])
    assert.ok(!urls.some((url) => url.includes(v.id)));
  await db.user.update({ where: { id: seller.id }, data: { suspendedAt: new Date() } });
  assert.equal(await db.vehicle.count({ where: indexableVehicles() }), 0);
  await db.user.update({
    where: { id: seller.id },
    data: { suspendedAt: null, email: 'fixture@local.autoveri.test' },
  });
  assert.equal(await db.vehicle.count({ where: indexableVehicles() }), 0);
  process.env.LOCAL_TEST_PAYMENTS = 'true';
  assert.ok(!(await (await sitemapIndex()).text()).includes('<loc>'));
  console.log(
    'PASS: public detail privacy/status, test/suspended owners excluded, 1001-listing sitemap pagination and local noindex boundary; no external providers.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm20_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM20 isolated database removed.');
}
