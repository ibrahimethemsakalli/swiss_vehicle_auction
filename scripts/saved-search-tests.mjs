import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm14_${randomUUID().replaceAll('-', '')}_test`,
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = `/${name}`;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()));
const admin = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migration.status, 0, migration.stderr);

  const { readSearches, changeSearches, notifySearchMatches } = await import(
    '../src/lib/saved-searches.ts'
  );
  const { savedSearchHandlers } = await import('../src/lib/saved-search-http.ts');
  const { defaultFilters } = await import('../src/lib/search-state.ts');
  const user = await db.user.create({
    data: { email: 'pm14@example.invalid', phone: 'pm14', passwordHash: 'test' },
  });
  const other = await db.user.create({
    data: { email: 'pm14-other@example.invalid', phone: 'pm14-other', passwordHash: 'test' },
  });
  const command = {
    action: 'save',
    name: 'Matching BE',
    filters: { ...defaultFilters, canton: 'BE' },
    alerts: true,
  };
  const saved = (await changeSearches(db, user.id, command)).items[0];
  assert.equal((await readSearches(db, other.id)).items.length, 0);
  await db.$disconnect();
  assert.equal((await readSearches(db, user.id)).items[0].name, 'Matching BE');
  await assert.rejects(() => changeSearches(db, user.id, command), /SEARCH_NAME/);
  await changeSearches(db, other.id, { action: 'delete', id: saved.id });
  assert.equal((await readSearches(db, user.id)).items.length, 1);
  const base = {
    userId: other.id,
    stammnummer: '123456789',
    firstRegistration: new Date('2020-01-01'),
    make: 'PM14',
    model: 'Fixture',
    mileage: 100,
    canton: 'BE',
    mfkStatus: 'UNKNOWN',
    mfkDate: null,
    serviceHistory: 'NONE',
    tireCondition: 'test',
    description: 'PM14 test',
    images: [],
    listingType: 'AUCTION_7_DAYS',
    startPrice: 1000,
    auctionEndsAt: new Date(Date.now() + 3600000),
    status: 'ACTIVE',
  };
  // Baseline older listings do not create initial notification spam.
  await db.vehicle.create({
    data: { ...base, vinChassis: 'PM14OLD0000000001', updatedAt: new Date('2020-01-01') },
  });
  const vehicle = await db.vehicle.create({ data: { ...base, vinChassis: 'PM14NEW0000000001' } });
  await db.vehicle.create({ data: { ...base, vinChassis: 'PM14ZH00000000001', canton: 'ZH' } });
  await db.vehicle.create({
    data: { ...base, vinChassis: 'PM14END000000001', auctionEndsAt: new Date('2020-01-01') },
  });
  await db.vehicle.create({
    data: { ...base, vinChassis: 'PM14PRIVATE000001', status: 'PENDING_VERIFICATION' },
  });
  await db.vehicle.create({ data: { ...base, vinChassis: 'PM14SAMPLE0000001', isSample: true } });
  await notifySearchMatches(db);
  await notifySearchMatches(db);
  let notices = await db.notification.findMany({ where: { userId: user.id } });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].vehicleId, vehicle.id);
  assert.equal(notices[0].kind, 'SEARCH_MATCH');
  await db.vehicle.update({ where: { id: vehicle.id }, data: { mileage: 101 } });
  await notifySearchMatches(db);
  assert.equal(await db.notification.count(), 1);
  // An updated previously nonmatching listing can become a new match.
  await db.vehicle.updateMany({ where: { canton: 'ZH' }, data: { canton: 'BE' } });
  await notifySearchMatches(db);
  assert.equal(await db.notification.count(), 2);
  const http = savedSearchHandlers(db, async () => user.id);
  assert.equal((await http.GET()).headers.get('Cache-Control'), 'private, no-store');
  assert.equal(
    (
      await savedSearchHandlers(db, async () => {
        throw Error('UNAUTHORIZED');
      }).GET()
    ).status,
    401,
  );
  const post = (body, origin = process.env.NEXTAUTH_URL) =>
    http.POST(
      new Request(process.env.NEXTAUTH_URL + '/api/saved-searches', {
        method: 'POST',
        headers: { origin },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await post(command, 'https://other.invalid')).status, 403);
  assert.equal((await post({ ...command, userId: other.id })).status, 400);
  assert.equal((await post({ x: 'x'.repeat(24001) })).status, 400);
  for (let i = 1; i < 20; i++)
    await changeSearches(db, user.id, { ...command, name: 'Search ' + i, alerts: false });
  await assert.rejects(
    () => changeSearches(db, user.id, { ...command, name: 'Too many' }),
    /SEARCH_LIMIT/,
  );
  await changeSearches(db, user.id, { action: 'delete', id: saved.id });
  assert.equal((await readSearches(db, user.id)).items.length, 19);
  await db.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
  assert.equal((await http.GET()).status, 403);
  assert.equal(await db.transaction.count(), 0);
  console.log(
    'PASS: saved search persistence, isolation, quota, validation, notification matching/deduplication and HTTP guards; no real providers',
  );
} finally {
  await db.$disconnect();
  const { db: globalDb } = await import('../src/lib/db.ts');
  await globalDb.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm14_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: isolated PM14 database removed');
