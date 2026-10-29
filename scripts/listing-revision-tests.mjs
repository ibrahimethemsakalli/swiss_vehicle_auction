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
const name = `autoveri_pm12_${randomUUID().replaceAll('-', '')}_test`,
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
      phone: 'pm12-owner',
      passwordHash: 'test',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      isIdentityVerified: true,
    },
  });
  const outsider = await db.user.create({
    data: { email: 'outsider@example.invalid', phone: 'pm12-outsider', passwordHash: 'test' },
  });
  const release = await db.legalRelease.create({ data: { version: 'pm12-fixture' } });
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
  const filename = `${randomUUID()}.jpg`;
  await db.mediaAsset.create({ data: { ownerId: owner.id, filename, status: 'READY', bytes: 10 } });
  const payload = {
    draft: {
      make: 'PM12',
      model: 'Test',
      stammnummer: '123456789',
      vinChassis: 'PM121234567890123',
      firstRegistration: '2020-01-01',
      mileage: '0',
      canton: 'BE',
      mfkStatus: 'UNKNOWN',
      mfkDate: '',
      serviceHistory: 'NONE',
      tireCondition: 'Test',
      description: 'Original',
      startPrice: '100',
    },
    specs: {},
    equipment: [],
    images: [`/api/uploads/${filename}`],
    customMake: true,
    customModel: true,
    registrationYear: '2020',
    listingType: 'AUCTION_7_DAYS',
  };
  const moderator = await db.user.create({
    data: {
      email: 'pm12-admin@example.invalid',
      phone: 'pm12-admin',
      passwordHash: 'SECRET-TEST',
      role: 'ADMIN',
    },
  });
  const id = randomUUID();
  const saved = await mutateDraft(db, owner.id, {
    action: 'save',
    id,
    revision: 0,
    step: 1,
    payload,
  });
  const submittedVehicle = await mutateDraft(db, owner.id, {
    action: 'submit',
    id,
    revision: saved.revision,
    consent: true,
  });
  let v = await db.vehicle.findUniqueOrThrow({ where: { id: submittedVehicle.id } });
  const review = (vehicle, action = 'reject') => ({
    id: vehicle.id,
    version: vehicle.version,
    action,
    note: 'Please clarify description',
    corrections: ['DESCRIPTION'],
    make: vehicle.make,
    model: vehicle.model,
    stammnummer: vehicle.stammnummer,
    vinChassis: vehicle.vinChassis,
    firstRegistration: '2020-01-01',
    mfkStatus: 'UNKNOWN',
    mfkDate: null,
  });
  await assert.rejects(() => reviewListing(db, owner.id, review(v)), /FORBIDDEN/);
  await reviewListing(db, moderator.id, review(v));
  await assert.rejects(() => reviewListing(db, moderator.id, review(v)), /CONFLICT/);
  v = await db.vehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(v.status, 'REJECTED');
  const library = await readDrafts(db, owner.id, {});
  assert.equal(library.recoverable[0].revisions[0].note, 'Please clarify description');
  assert.equal((await readDrafts(db, outsider.id, {})).recoverable.length, 0);
  await assert.rejects(
    () => mutateDraft(db, outsider.id, { action: 'revise', vehicleId: v.id, version: v.version }),
    /FORBIDDEN/,
  );
  const revision = await mutateDraft(db, owner.id, {
    action: 'revise',
    vehicleId: v.id,
    version: v.version,
  });
  const revised = structuredClone(revision.payload);
  revised.draft.description = 'Corrected description';
  const resaved = await mutateDraft(db, owner.id, {
    action: 'save',
    id: revision.id,
    revision: revision.revision,
    step: 3,
    payload: revised,
  });
  await mutateDraft(db, owner.id, {
    action: 'submit',
    id: revision.id,
    revision: resaved.revision,
    consent: true,
  });
  v = await db.vehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(v.status, 'PENDING_VERIFICATION');
  assert.equal(v.description, 'Corrected description');
  assert.equal(v.auctionEndsAt, null);
  const snapshots = await db.listingRevision.findMany({ where: { vehicleId: v.id } });
  assert.equal(snapshots.find((r) => r.action === 'REJECTED').snapshot.description, 'Original');
  assert.ok(!JSON.stringify(snapshots).includes('passwordHash'));
  // Only a synthetic expired state: no prior auction/bid workflow is rerun.
  v = await db.vehicle.update({
    where: { id: v.id },
    data: {
      status: 'EXPIRED',
      auctionEndsAt: new Date('2020-01-08'),
      auctionStartAt: new Date('2020-01-01'),
    },
  });
  const relist = await mutateDraft(db, owner.id, {
    action: 'relist',
    vehicleId: v.id,
    version: v.version,
  });
  await assert.rejects(
    () => mutateDraft(db, owner.id, { action: 'relist', vehicleId: v.id, version: v.version }),
    /DRAFT_LOCKED/,
  );
  assert.equal(
    (
      await db.listingRevision.findFirstOrThrow({
        where: { vehicleId: v.id, action: 'RELIST_STARTED' },
      })
    ).snapshot.auctionEndsAt,
    '2020-01-08T00:00:00.000Z',
  );
  await mutateDraft(db, owner.id, {
    action: 'submit',
    id: relist.id,
    revision: relist.revision,
    consent: true,
  });
  v = await db.vehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(v.auctionEndsAt, null);
  await reviewListing(db, moderator.id, review(v, 'approve'));
  v = await db.vehicle.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(v.status, 'ACTIVE');
  assert.ok(
    (await readDrafts(db, owner.id, {})).recoverable.some(
      (row) => row.id === v.id && row.revisions.some((r) => r.action === 'APPROVED'),
    ),
  );
  assert.equal(v.auctionEndsAt.getTime() - v.auctionStartAt.getTime(), 7 * 86400000);
  v = await db.vehicle.update({
    where: { id: v.id },
    data: { status: 'EXPIRED', auctionEndsAt: new Date('2020-01-08') },
  });
  const hold = await db.paymentHold.create({
    data: { userId: outsider.id, vehicleId: v.id, gateway: 'LOCAL_TEST', expiresAt: new Date() },
  });
  const bid = await db.bid.create({
    data: {
      userId: outsider.id,
      vehicleId: v.id,
      holdId: hold.id,
      amount: 100,
      requestId: randomUUID(),
    },
  });
  await assert.rejects(
    () => mutateDraft(db, owner.id, { action: 'relist', vehicleId: v.id, version: v.version }),
    /DRAFT_LOCKED/,
  );
  assert.deepEqual(await db.bid.findUnique({ where: { id: bid.id } }), bid);
  assert.equal(await db.transaction.count(), 0);
  console.log(
    'PASS: rejection/checklist/private immutable revisions, seller correction/resubmission, expired recovery, review restart and history locks; no real providers',
  );
} finally {
  await db.$disconnect();
  const { db: globalDb } = await import('../src/lib/db.ts');
  await globalDb.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm12_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: isolated PM12 database removed');
