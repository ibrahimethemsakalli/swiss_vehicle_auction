import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { mutateDraft, readDrafts, assertReviewVersion } from '../src/lib/listing-drafts.ts';
import { draftHandlers } from '../src/lib/listing-draft-http.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm13_${randomUUID().replaceAll('-', '')}_test`,
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

  const { readFavorites, changeFavorites } = await import('../src/lib/favorites.ts');
  const { favoriteHandlers } = await import('../src/lib/favorite-http.ts');
  const owner = await db.user.create({
    data: { email: 'pm13@example.invalid', phone: 'pm13', passwordHash: 'test' },
  });
  const other = await db.user.create({
    data: { email: 'pm13-other@example.invalid', phone: 'pm13-other', passwordHash: 'test' },
  });
  const base = {
    userId: owner.id,
    stammnummer: '123456789',
    firstRegistration: new Date('2020-01-01'),
    make: 'PM13',
    model: 'Fixture',
    mileage: 0,
    canton: 'BE',
    mfkStatus: 'UNKNOWN',
    mfkDate: null,
    serviceHistory: 'NONE',
    tireCondition: 'Test',
    description: 'PM13',
    images: [],
    listingType: 'AUCTION_7_DAYS',
    startPrice: 1000,
  };
  const vehicles = [];
  for (const [i, status] of [
    'ACTIVE',
    'SOLD',
    'EXPIRED',
    'CANCELLED',
    'DRAFT',
    'PENDING_VERIFICATION',
    'REJECTED',
  ].entries())
    vehicles.push(
      await db.vehicle.create({
        data: { ...base, vinChassis: `PM13TEST${String(i).padStart(9, '0')}`, status },
      }),
    );
  const ids = vehicles.map((v) => v.id);
  await changeFavorites(db, owner.id, { action: 'set', vehicleId: ids[0], saved: true });
  const merged = await changeFavorites(db, owner.id, {
    action: 'merge',
    ids: [...ids, ids[0], 'demo-1', randomUUID()],
  });
  assert.equal(merged.ids.length, 4);
  assert.equal(merged.skipped, 5);
  assert.equal((await readFavorites(db, other.id)).ids.length, 0);
  await db.$disconnect();
  assert.equal((await readFavorites(db, owner.id)).ids.length, 4);
  await Promise.all(
    [1, 2, 3].map(() =>
      changeFavorites(db, owner.id, { action: 'set', vehicleId: ids[0], saved: true }),
    ),
  );
  assert.equal(await db.favorite.count({ where: { userId: owner.id } }), 4);
  await changeFavorites(db, other.id, { action: 'set', vehicleId: ids[0], saved: false });
  assert.equal((await readFavorites(db, owner.id)).ids.length, 4);
  await db.vehicle.update({ where: { id: ids[0] }, data: { status: 'DRAFT' } });
  assert.deepEqual((await readFavorites(db, owner.id)).unavailable, [ids[0]]);
  await changeFavorites(db, owner.id, { action: 'set', vehicleId: ids[0], saved: false });
  assert.equal((await readFavorites(db, owner.id)).ids.length, 3);
  for (const id of ids.slice(4))
    await assert.rejects(
      () => changeFavorites(db, owner.id, { action: 'set', vehicleId: id, saved: true }),
      /FAVORITE_UNAVAILABLE/,
    );
  const extras = Array.from({ length: 198 }, (_, i) => ({
    id: randomUUID(),
    ...base,
    vinChassis: `PM13MORE${String(i).padStart(9, '0')}`,
    status: 'ACTIVE',
  }));
  await db.vehicle.createMany({ data: extras });
  await changeFavorites(db, owner.id, {
    action: 'merge',
    ids: extras.slice(0, 197).map((v) => v.id),
  });
  assert.equal((await readFavorites(db, owner.id)).ids.length, 200);
  await assert.rejects(
    () => changeFavorites(db, owner.id, { action: 'merge', ids: [extras[197].id, ids[1]] }),
    /FAVORITE_LIMIT/,
  );
  assert.equal((await readFavorites(db, owner.id)).ids.length, 200);
  const http = favoriteHandlers(db, async () => owner.id),
    origin = process.env.NEXTAUTH_URL;
  assert.match((await http.GET()).headers.get('cache-control'), /private.*no-store/);
  assert.equal(
    (
      await favoriteHandlers(db, async () => {
        throw Error('UNAUTHORIZED');
      }).GET()
    ).status,
    401,
  );
  const post = (body, from = origin) =>
    http.POST(
      new Request(`${origin}/api/favorites`, {
        method: 'POST',
        headers: { origin: from },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await post({}, 'https://other.invalid')).status, 403);
  assert.equal((await post({ x: 'x'.repeat(24001) })).status, 400);
  assert.equal(
    (await post({ action: 'set', vehicleId: ids[1], saved: false, userId: other.id })).status,
    400,
  );
  await db.user.update({ where: { id: owner.id }, data: { suspendedAt: new Date() } });
  assert.equal((await http.GET()).status, 403);
  assert.equal(await db.transaction.count(), 0);
  console.log(
    'PASS: persistence, user isolation, explicit idempotent merge, closed states, inaccessible removal, concurrent inserts, atomic quota and HTTP guards; no providers',
  );
} finally {
  await db.$disconnect();
  const { db: globalDb } = await import('../src/lib/db.ts');
  await globalDb.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm13_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: isolated PM13 database removed');
