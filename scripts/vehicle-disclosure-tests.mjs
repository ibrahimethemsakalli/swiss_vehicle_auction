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
const name = `autoveri_pm11_${randomUUID().replaceAll('-', '')}_test`,
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
  const owner = await db.user.create({
    data: {
      email: 'draft-owner@example.invalid',
      phone: 'pm11-owner',
      passwordHash: 'test',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      isIdentityVerified: true,
    },
  });
  const outsider = await db.user.create({
    data: { email: 'outsider@example.invalid', phone: 'pm11-outsider', passwordHash: 'test' },
  });
  const release = await db.legalRelease.create({ data: { version: 'pm11-fixture' } });
  const terms = await db.legalDocument.create({
      data: {
        releaseId: release.id,
        kind: 'TERMS',
        locale: 'de',
        title: 'test',
        content: {},
        contentHash: 'test',
      },
    }),
    privacy = await db.legalDocument.create({
      data: {
        releaseId: release.id,
        kind: 'PRIVACY',
        locale: 'de',
        title: 'test',
        content: {},
        contentHash: 'test',
      },
    });
  await db.legalCurrent.create({ data: { id: 'current', releaseId: release.id } });
  await db.legalAcceptance.create({
    data: {
      userId: owner.id,
      releaseId: release.id,
      termsDocumentId: terms.id,
      privacyDocumentId: privacy.id,
      locale: 'de',
      source: 'ACCOUNT',
      termsAccepted: true,
      privacyAcknowledged: true,
      eligibilityDeclared: true,
    },
  });

  const { marketWhere, filterInput } = await import('../src/lib/market-query.ts');
  const { publicVehicle, publicVehicleInclude } = await import('../src/lib/public-vehicle.ts');
  const filename = `${randomUUID()}.jpg`;
  await db.mediaAsset.create({ data: { ownerId: owner.id, filename, status: 'READY', bytes: 10 } });
  const payload = {
    draft: {
      make: 'PM11',
      model: 'EV',
      stammnummer: '123456789',
      vinChassis: 'PM111234567890123',
      firstRegistration: '2020-01-01',
      modelYear: '2019',
      mileage: '0',
      canton: 'BE',
      mfkStatus: 'NEVER',
      mfkDate: '',
      serviceHistory: 'NONE',
      tireCondition: 'Test',
      description: 'PM11 test',
      damageDescription: 'Door repaired',
      startPrice: '100',
    },
    specs: { fuelType: 'ELECTRIC', batteryHealth: '91.5', accidentHistory: 'REPAIRED' },
    equipment: [],
    images: [`/api/uploads/${filename}`],
    customMake: true,
    customModel: true,
    registrationYear: '2020',
    listingType: 'AUCTION_7_DAYS',
  };
  const id = randomUUID();
  const saved = await mutateDraft(db, owner.id, {
    action: 'save',
    id,
    revision: 0,
    step: 1,
    payload,
  });
  const restored = await readDrafts(db, owner.id, { id });
  assert.equal(restored.payload.draft.mfkStatus, 'NEVER');
  assert.equal(restored.payload.specs.batteryHealth, '91.5');
  const submitted = await mutateDraft(db, owner.id, {
    action: 'submit',
    id,
    revision: saved.revision,
    consent: true,
  });
  let vehicle = await db.vehicle.findUniqueOrThrow({
    where: { id: submitted.id },
    include: publicVehicleInclude,
  });
  let view = publicVehicle(vehicle);
  assert.equal(view.mfkDate, null);
  assert.equal(view.mfkStatus, 'NEVER');
  assert.equal(view.modelYear, 2019);
  assert.equal(view.batteryHealth, 91.5);
  assert.equal(view.damageDescription, 'Door repaired');
  const editing = await mutateDraft(db, owner.id, {
    action: 'edit',
    vehicleId: vehicle.id,
    version: vehicle.version,
  });
  const changed = structuredClone(editing.payload);
  changed.draft.mfkStatus = 'UNKNOWN';
  changed.draft.modelYear = '';
  changed.draft.damageDescription = '';
  changed.specs.batteryHealth = '';
  changed.specs.accidentHistory = 'UNKNOWN';
  const revised = await mutateDraft(db, owner.id, {
    action: 'save',
    id: editing.id,
    revision: editing.revision,
    step: 1,
    payload: changed,
  });
  await mutateDraft(db, owner.id, {
    action: 'submit',
    id: editing.id,
    revision: revised.revision,
    consent: true,
  });
  vehicle = await db.vehicle.findUniqueOrThrow({
    where: { id: vehicle.id },
    include: publicVehicleInclude,
  });
  view = publicVehicle(vehicle);
  assert.equal(view.modelYear, null);
  assert.equal(view.batteryHealth, null);
  assert.equal(view.mfkStatus, 'UNKNOWN');
  assert.equal(view.mfkDate, null);
  assert.equal(view.damageDescription, '');
  // Synthetic ACTIVE fixture only: no review/auction/payment workflow is executed.
  await db.vehicle.update({ where: { id: vehicle.id }, data: { status: 'ACTIVE' } });
  const f = filterInput.parse({ privateOnly: false });
  for (const patch of [
    { mfk: true },
    { yearFrom: 2020 },
    { ranges: { batteryHealth: { min: 0 } } },
  ])
    assert.equal(await db.vehicle.count({ where: marketWhere({ ...f, ...patch }) }), 0);
  await db.vehicle.update({
    where: { id: vehicle.id },
    data: { mfkStatus: 'DATED', mfkDate: new Date(), modelYear: 2020, batteryHealth: 90 },
  });
  for (const patch of [
    { mfk: true },
    { yearFrom: 2020 },
    { ranges: { batteryHealth: { min: 80 } } },
  ])
    assert.equal(await db.vehicle.count({ where: marketWhere({ ...f, ...patch }) }), 1);
  await assert.rejects(() =>
    db.vehicle.update({ where: { id: vehicle.id }, data: { mfkStatus: 'UNKNOWN' } }),
  );
  assert.equal(await db.transaction.count(), 0);
  console.log(
    'PASS: PM11 migration, draft restore/submit/edit clearing, public projection, unknown exclusion and positive SQL filters; no provider calls',
  );
} finally {
  await db.$disconnect();
  const { db: globalDb } = await import('../src/lib/db.ts');
  await globalDb.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm11_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: isolated PM11 database removed');
