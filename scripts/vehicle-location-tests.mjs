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
const name = `autoveri_pm16_${randomUUID().replaceAll('-', '')}_test`,
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
      phone: 'pm16-owner',
      passwordHash: 'test',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      isIdentityVerified: true,
    },
  });
  const outsider = await db.user.create({
    data: { email: 'outsider@example.invalid', phone: 'pm16-outsider', passwordHash: 'test' },
  });
  const release = await db.legalRelease.create({ data: { version: 'pm16-fixture' } });
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
      make: 'PM16',
      model: 'EV',
      stammnummer: '123456789',
      vinChassis: 'PM161234567890123',
      firstRegistration: '2020-01-01',
      modelYear: '2019',
      mileage: '0',
      canton: 'BE',
      city: '  Biel/Bienne  ',
      postalCode: '2502',
      mfkStatus: 'NEVER',
      mfkDate: '',
      serviceHistory: 'NONE',
      tireCondition: 'Test',
      description: 'PM16 test',
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
  assert.equal(restored.payload.draft.city, '  Biel/Bienne  ');
  assert.equal(restored.payload.draft.postalCode, '2502');
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
  assert.equal(view.city, 'Biel/Bienne');
  assert.equal(view.postalCode, '2502');
  for (const key of ['address', 'street', 'houseNumber', 'latitude', 'longitude'])
    assert.equal(key in view, false);
  const editing = await mutateDraft(db, owner.id, {
    action: 'edit',
    vehicleId: vehicle.id,
    version: vehicle.version,
  });
  assert.equal(editing.payload.draft.city, 'Biel/Bienne');
  assert.equal(editing.payload.draft.postalCode, '2502');
  const changed = structuredClone(editing.payload);
  changed.draft.city = '';
  changed.draft.postalCode = '';
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
    where: { id: submitted.id },
    include: publicVehicleInclude,
  });
  assert.equal(vehicle.city, null);
  assert.equal(vehicle.postalCode, null);
  // Only synthetic state setup for location queries; no approval/bidding/payment workflow.
  await db.vehicle.update({ where: { id: vehicle.id }, data: { status: 'ACTIVE' } });
  const f = filterInput.parse({ city: 'Biel/Bienne', postalCode: '25' });
  assert.equal(await db.vehicle.count({ where: marketWhere(f) }), 0);
  await db.vehicle.update({
    where: { id: vehicle.id },
    data: { city: 'Biel/Bienne', postalCode: '2502' },
  });
  const { filterVehicles } = await import('../src/lib/market-types.ts');
  for (const patch of [
    { city: 'biel/bienne', postalCode: '25' },
    { city: 'Biel', postalCode: '' },
    { city: '', postalCode: '2502' },
    { city: '', postalCode: '80' },
  ]) {
    const filters = filterInput.parse(patch);
    const rows = await db.vehicle.findMany({
      where: marketWhere(filters),
      include: publicVehicleInclude,
    });
    const all = await db.vehicle.findMany({ include: publicVehicleInclude });
    assert.deepEqual(
      rows.map((v) => v.id),
      filterVehicles(all.map(publicVehicle), filters).map((v) => v.id),
    );
  }
  // Verify complete input rejection directly; do not repeat submission workflows for unrelated fields.
  const { vehicleInput } = await import('../src/lib/vehicles.ts');
  const raw = {
    ...payload.draft,
    ...payload.specs,
    mileage: 0,
    modelYear: 2019,
    batteryHealth: 91.5,
    images: payload.images,
    equipment: [],
    listingType: payload.listingType,
    city: 'Private road 10',
  };
  assert.equal(vehicleInput.safeParse(raw).success, false);
  const snapshot = await db.listingRevision.findFirst({
    where: { vehicleId: vehicle.id, action: 'SUBMITTED' },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(snapshot.snapshot.city, 'Biel/Bienne');
  assert.equal(await db.transaction.count(), 0);
  console.log(
    'PASS: location draft persistence, submission normalization, edit clearing, public projection, SQL/favorite filter parity and private-address exclusion',
  );
} finally {
  await db.$disconnect();
  const { db: globalDb } = await import('../src/lib/db.ts');
  await globalDb.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm16_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: isolated PM16 database removed');
