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
const name = `autoveri_pm23_${randomUUID().replaceAll('-', '')}_test`,
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
      phone: 'pm23-owner',
      passwordHash: 'test',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      isIdentityVerified: true,
    },
  });
  const outsider = await db.user.create({
    data: { email: 'outsider@example.invalid', phone: 'pm23-outsider', passwordHash: 'test' },
  });
  const release = await db.legalRelease.create({ data: { version: 'pm23-fixture' } });
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

  const { reviewListing } = await import('../src/lib/listing-review.ts');

  const { publicVehicle, publicVehicleInclude } = await import('../src/lib/public-vehicle.ts');
  const { createVehicle, vehicleInput } = await import('../src/lib/vehicles.ts');
  const { vehicleDataOrigin } = await import('../src/lib/vehicle-data-origin.ts');
  const filename = randomUUID() + '.jpg';
  await db.mediaAsset.create({ data: { ownerId: owner.id, filename, status: 'READY', bytes: 10 } });
  const payload = {
    draft: {
      make: 'PM23',
      model: 'Declared',
      stammnummer: '123456789',
      vinChassis: 'PM231234567890123',
      firstRegistration: '2020-01-01',
      mileage: '100',
      canton: 'BE',
      mfkStatus: 'UNKNOWN',
      mfkDate: '',
      serviceHistory: 'NONE',
      tireCondition: 'Unknown',
      description: 'Synthetic',
      startPrice: '100',
    },
    specs: {},
    equipment: [],
    images: ['/api/uploads/' + filename],
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
  const started = new Date();
  const submitted = await mutateDraft(db, owner.id, {
    action: 'submit',
    id,
    revision: saved.revision,
    consent: true,
  });
  let v = await db.vehicle.findUniqueOrThrow({
    where: { id: submitted.id },
    include: publicVehicleInclude,
  });
  assert.ok(v.dataDeclaredAt >= started);
  assert.equal(v.dataCorrectedAt, null);
  assert.equal(vehicleDataOrigin(publicVehicle(v)).source, 'SELLER_DECLARATION');
  assert.equal(publicVehicle(v).modelYear, null);
  assert.deepEqual(publicVehicle(v).equipment, []);
  const firstStamp = v.dataDeclaredAt.toISOString();
  const snapshot = await db.listingRevision.findFirstOrThrow({
    where: { vehicleId: v.id, action: 'SUBMITTED' },
  });
  assert.equal(snapshot.snapshot.dataDeclaredAt, firstStamp);
  const moderator = await db.user.create({
    data: { email: 'admin@pm23.test', phone: 'pm23-admin', passwordHash: 'test', role: 'ADMIN' },
  });
  const review = (vehicle, patch = {}) => ({
    id: vehicle.id,
    version: vehicle.version,
    action: 'reject',
    note: 'Synthetic correction request',
    corrections: ['VEHICLE_DATA'],
    make: vehicle.make,
    model: vehicle.model,
    stammnummer: vehicle.stammnummer,
    vinChassis: vehicle.vinChassis,
    firstRegistration: '2020-01-01',
    mfkStatus: 'UNKNOWN',
    mfkDate: null,
    ...patch,
  });
  await reviewListing(db, moderator.id, review(v, { model: 'Corrected by admin' }));
  v = await db.vehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(v.dataDeclaredAt.toISOString(), firstStamp);
  assert.ok(v.dataCorrectedAt);
  assert.deepEqual(v.dataCorrectedFields, ['model']);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { kind: 'admin.review' },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(event.payload.updated.model, 'Corrected by admin');
  assert.deepEqual(event.payload.updated.dataCorrectedFields, ['model']);
  const edit = await mutateDraft(db, owner.id, {
    action: 'revise',
    vehicleId: v.id,
    version: v.version,
  });
  edit.payload.draft.model = 'Corrected by seller';
  const updated = await mutateDraft(db, owner.id, {
    action: 'save',
    id: edit.id,
    revision: edit.revision,
    step: 1,
    payload: edit.payload,
  });
  await mutateDraft(db, owner.id, {
    action: 'submit',
    id: edit.id,
    revision: updated.revision,
    consent: true,
  });
  v = await db.vehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.ok(v.dataDeclaredAt.toISOString() >= firstStamp);
  assert.equal(v.dataCorrectedAt, null);
  assert.deepEqual(v.dataCorrectedFields, []);
  assert.equal(
    (await db.listingRevision.findUniqueOrThrow({ where: { id: snapshot.id } })).snapshot.model,
    'Declared',
  );
  await reviewListing(db, moderator.id, review(v, { action: 'approve', corrections: [] }));
  v = await db.vehicle.findUniqueOrThrow({ where: { id: v.id }, include: publicVehicleInclude });
  assert.equal(v.dataCorrectedAt, null);
  assert.equal(vehicleDataOrigin(publicVehicle(v)).independentlyVerified, false);
  const legacy = await db.vehicle.create({
    data: {
      userId: owner.id,
      vinChassis: 'PM23LEGACY00000001',
      stammnummer: '123456789',
      make: 'Legacy',
      model: 'Unknown origin',
      firstRegistration: new Date('2020-01-01'),
      mileage: 0,
      canton: 'BE',
      mfkStatus: 'UNKNOWN',
      serviceHistory: 'NONE',
      tireCondition: 'Unknown',
      description: 'Synthetic',
      images: [],
      listingType: 'FIXED_PRICE_OFFERS',
      startPrice: 100,
      status: 'ACTIVE',
    },
    include: publicVehicleInclude,
  });
  assert.equal(legacy.dataDeclaredAt, null);
  assert.equal(vehicleDataOrigin(publicVehicle(legacy)).source, 'UNRECORDED');
  const filename2 = randomUUID() + '.jpg';
  await db.mediaAsset.create({
    data: { ownerId: owner.id, filename: filename2, status: 'READY', bytes: 10 },
  });
  const direct = {
    ...payload.draft,
    mileage: 100,
    vinChassis: 'PM231234567890124',
    mfkDate: null,
    images: ['/api/uploads/' + filename2],
    listingType: 'AUCTION_7_DAYS',
  };
  assert.equal(vehicleInput.safeParse({ ...direct, dataDeclaredAt: '2000-01-01' }).success, false);
  const createdVehicle = await createVehicle(owner.id, direct);
  assert.ok(
    (await db.vehicle.findUniqueOrThrow({ where: { id: createdVehicle.id } })).dataDeclaredAt,
  );
  assert.equal(
    await db.listingRevision.count({
      where: { vehicleId: createdVehicle.id, action: 'SUBMITTED' },
    }),
    1,
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
    'PASS: seller timestamp in both creation paths, unknown historical origin, actual admin changes only, immutable source snapshots, corrected resubmission, unchanged approval remains unverified, source spoof rejection and schema alignment.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm23_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe('DROP DATABASE "' + name + '" WITH (FORCE)');
  }
  await admin.$disconnect();
  console.log('PM23 isolated database removed.');
}
