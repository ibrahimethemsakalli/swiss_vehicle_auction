import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm24_${randomUUID().replaceAll('-', '')}_test`,
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
  const { changeDealer, readDealerWorkspace, publicDealer } = await import('../src/lib/dealers.ts');
  const { dealerHandlers } = await import('../src/lib/dealer-http.ts');
  const now = new Date();
  const user = (tag, role = 'DEALER') =>
    db.user.create({
      data: {
        email: tag + '@pm24.test',
        phone: tag,
        passwordHash: 'test',
        role,
        emailVerifiedAt: now,
        phoneVerifiedAt: now,
        isIdentityVerified: true,
        handelsregisterNr: 'DECLARED-ONLY',
        companyName: 'Test company',
      },
    });
  const owner = await user('dealer'),
    other = await user('other'),
    privateUser = await user('private', 'PRIVATE_USER'),
    admin = await user('admin', 'ADMIN');
  for (const u of [privateUser, admin])
    await assert.rejects(() => readDealerWorkspace(db, u.id), /FORBIDDEN/);
  const csv = 'make,model,vinChassis\nBMW,320,WBA12345678901234\nAudi,A4,WAU12345678901234';
  const preview = await changeDealer(db, owner.id, { action: 'preview', csv });
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.remaining, 20);
  assert.equal(await db.listingDraft.count(), 0);
  const command = { action: 'import', csv, hash: preview.hash, requestId: randomUUID() };
  const imported = await Promise.all([
    changeDealer(db, owner.id, command),
    changeDealer(db, owner.id, command),
  ]);
  assert.deepEqual(imported[0], imported[1]);
  assert.equal(await db.listingDraft.count(), 2);
  assert.equal(await db.vehicle.count(), 0);
  const drafts = await db.listingDraft.findMany({ where: { ownerId: owner.id } });
  assert.ok(drafts.every((d) => d.status === 'DRAFT' && d.vehicleId === null));
  assert.deepEqual(drafts[0].payload.images, []);
  assert.equal((await readDealerWorkspace(db, other.id)).remaining, 20);
  assert.ok(
    (await changeDealer(db, owner.id, { action: 'preview', csv })).rows.every((r) =>
      r.issues.some((i) => i.code === 'duplicate'),
    ),
  );
  await assert.rejects(
    () => changeDealer(db, owner.id, { ...command, csv: csv + '\n' }),
    /PREVIEW_CHANGED/,
  );
  const invalid = 'make,model,mileage\nBMW,320,bad';
  const bad = await changeDealer(db, owner.id, { action: 'preview', csv: invalid });
  await assert.rejects(
    () =>
      changeDealer(db, owner.id, {
        action: 'import',
        csv: invalid,
        hash: bad.hash,
        requestId: randomUUID(),
      }),
    /CSV_ERRORS/,
  );
  assert.equal(await db.listingDraft.count(), 2);
  const twenty = 'make,model\n' + 'BMW,Quota\n'.repeat(19);
  const tooMany = await changeDealer(db, owner.id, { action: 'preview', csv: twenty });
  await assert.rejects(
    () =>
      changeDealer(db, owner.id, {
        action: 'import',
        csv: twenty,
        hash: tooMany.hash,
        requestId: randomUUID(),
      }),
    /DRAFT_QUOTA/,
  );
  const nineteen = 'make,model\n' + 'BMW,Concurrent\n'.repeat(19);
  const concurrentPreview = await changeDealer(db, other.id, { action: 'preview', csv: nineteen });
  const quota = await Promise.allSettled(
    [1, 2].map(() =>
      changeDealer(db, other.id, {
        action: 'import',
        csv: nineteen,
        hash: concurrentPreview.hash,
        requestId: randomUUID(),
      }),
    ),
  );
  assert.equal(quota.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await db.listingDraft.count({ where: { ownerId: other.id } }), 19);
  let profile = await changeDealer(db, owner.id, {
    action: 'profile',
    version: 0,
    name: 'Synthetic dealer',
    canton: 'BE',
    city: 'Bern',
    postalCode: '3000',
    description: 'Self-declared profile',
    published: false,
  });
  await assert.rejects(() => publicDealer(db, owner.id, 1), /NOT_FOUND/);
  const base = {
    action: 'profile',
    name: profile.name,
    canton: profile.canton,
    city: profile.city,
    postalCode: profile.postalCode,
    description: profile.description,
    published: true,
  };
  await assert.rejects(() => changeDealer(db, owner.id, { ...base, version: 0 }), /CONFLICT/);
  profile = await changeDealer(db, owner.id, { ...base, version: profile.version });
  const v = (i, patch = {}) => ({
    userId: owner.id,
    vinChassis: 'PM24' + i,
    stammnummer: 'TEST',
    make: 'LOCAL TEST',
    model: 'Stock ' + i,
    mileage: 0,
    canton: 'BE',
    mfkStatus: 'UNKNOWN',
    serviceHistory: 'NONE',
    tireCondition: 'Unknown',
    description: 'Synthetic',
    images: [],
    listingType: 'FIXED_PRICE_OFFERS',
    startPrice: 1000,
    status: 'ACTIVE',
    ...patch,
  });
  await db.vehicle.createMany({
    data: [
      ...Array.from({ length: 13 }, (_, i) => v(i)),
      v('sold', { status: 'SOLD' }),
      v('pending', { status: 'PENDING_VERIFICATION' }),
      v('sample', { isSample: true }),
      v('expired', { listingType: 'AUCTION_7_DAYS', auctionEndsAt: new Date(0) }),
    ],
  });
  const first = await publicDealer(db, owner.id, 1),
    second = await publicDealer(db, owner.id, 2);
  assert.equal(first.total, 13);
  assert.equal(first.vehicles.length, 12);
  assert.equal(second.vehicles.length, 1);
  assert.equal(new Set([...first.vehicles, ...second.vehicles].map((v) => v.id)).size, 13);
  for (const sensitive of ['email', 'phone', 'handelsregisterNr', 'passwordHash'])
    assert.ok(!JSON.stringify(first).includes(sensitive));
  await db.user.update({ where: { id: owner.id }, data: { suspendedAt: now } });
  await assert.rejects(() => publicDealer(db, owner.id, 1), /NOT_FOUND/);
  await assert.rejects(() => changeDealer(db, owner.id, { action: 'preview', csv }), /FORBIDDEN/);
  await db.user.update({ where: { id: owner.id }, data: { suspendedAt: null } });
  await changeDealer(db, owner.id, { ...base, version: profile.version, published: false });
  await assert.rejects(() => publicDealer(db, owner.id, 1), /NOT_FOUND/);
  const api = dealerHandlers(db, async () => owner.id);
  const response = await api.GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(
    (
      await dealerHandlers(db, async () => {
        throw Error('UNAUTHORIZED');
      }).GET()
    ).status,
    401,
  );
  const post = (body, origin = 'http://127.0.0.1:3000') =>
    api.POST(
      new Request('http://127.0.0.1:3000/api/dealer', {
        method: 'POST',
        headers: { origin },
        body,
      }),
    );
  assert.equal((await post('{}', 'https://evil.test')).status, 403);
  assert.equal((await post('x'.repeat(600001))).status, 400);
  assert.equal(
    (await post(JSON.stringify({ action: 'preview', csv, ownerId: other.id }))).status,
    400,
  );
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
    'PASS: dealer guards, preview-only, atomic draft import, idempotency, duplicate VIN, stale preview, quota race, profile versions/publication/privacy, stock filtering/pagination, HTTP limits and schema alignment.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm24_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM24 isolated database removed.');
}
