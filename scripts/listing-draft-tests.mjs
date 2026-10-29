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
const name = `autoveri_pm10_${randomUUID().replaceAll('-', '')}_test`,
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
      phone: 'pm10-owner',
      passwordHash: 'test',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      isIdentityVerified: true,
    },
  });
  const outsider = await db.user.create({
    data: { email: 'outsider@example.invalid', phone: 'pm10-outsider', passwordHash: 'test' },
  });
  const release = await db.legalRelease.create({ data: { version: 'pm10-fixture' } });
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
  const payload = {
    draft: { make: 'PM10' },
    specs: {},
    equipment: [],
    images: [],
    customMake: true,
    customModel: true,
    registrationYear: '',
    listingType: 'AUCTION_7_DAYS',
  };
  const id = randomUUID(),
    save = (revision, p = payload) =>
      mutateDraft(db, owner.id, { action: 'save', id, revision, step: 2, payload: p });
  let row = await save(0);
  assert.equal(row.step, 2);
  assert.equal(await db.vehicle.count(), 0, 'Saving does not publish/create a vehicle');
  await db.$disconnect();
  assert.equal((await readDrafts(db, owner.id, { id })).payload.draft.make, 'PM10');
  await assert.rejects(() => readDrafts(db, outsider.id, { id }), /FORBIDDEN/);
  await assert.rejects(
    () => mutateDraft(db, outsider.id, { action: 'save', id, revision: 1, step: 0, payload }),
    /FORBIDDEN/,
  );
  const race = await Promise.allSettled([
    save(1, { ...payload, draft: { make: 'First' } }),
    save(1, { ...payload, draft: { make: 'Second' } }),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(race.filter((r) => r.status === 'rejected').length, 1);
  assert.equal((await db.listingDraft.findUniqueOrThrow({ where: { id } })).revision, 2);
  await assert.rejects(() =>
    mutateDraft(db, owner.id, { action: 'submit', id, revision: 2, consent: true }),
  );
  assert.equal(await db.vehicle.count(), 0);
  console.log(
    'PASS: private incomplete persistence, resume step, user isolation, concurrent revision protection and full validation at submit',
  );
  const photo = await db.mediaAsset.create({
    data: { ownerId: owner.id, filename: `${randomUUID()}.jpg`, status: 'READY', bytes: 100 },
  });
  const foreign = await db.mediaAsset.create({
    data: { ownerId: outsider.id, filename: `${randomUUID()}.jpg`, status: 'READY', bytes: 100 },
  });
  const url = `/api/uploads/${photo.filename}`;
  await assert.rejects(
    () => save(2, { ...payload, images: [`/api/uploads/${foreign.filename}`] }),
    /PHOTO_OWNERSHIP_REQUIRED/,
  );
  assert.equal(
    (await db.listingDraft.findUniqueOrThrow({ where: { id } })).revision,
    2,
    'Photo errors roll back save',
  );
  const complete = {
    ...payload,
    draft: {
      make: 'PM10',
      model: 'Fixture',
      stammnummer: '123456789',
      vinChassis: 'WBA12345678901234',
      firstRegistration: '2020-01-01',
      mileage: '100',
      canton: 'ZH',
      mfkDate: '2026-01-01',
      serviceHistory: 'FULL',
      tireCondition: 'Test',
      startPrice: '1000',
      description: 'PM10 local fixture',
    },
    images: [url],
    specs: { fuelType: 'PETROL', powerKw: '100' },
  };
  // powerKw belongs in base draft, not specs.
  complete.specs = { fuelType: 'PETROL' };
  complete.draft.powerKw = '100';
  row = await save(2, complete);
  await db.mediaAsset.update({
    where: { id: photo.id },
    data: { createdAt: new Date(Date.now() - 3 * 86400000) },
  });
  const { cleanupMedia, photoAccess } = await import('../src/lib/media.ts');
  const clean = await cleanupMedia({ apply: false });
  assert.equal(clean.eligible, 0, 'Draft-linked photo survives orphan cutoff');
  assert.equal(await photoAccess(photo.filename), null);
  assert.equal(await photoAccess(photo.filename, owner.id), 'private');
  const submitted = await mutateDraft(db, owner.id, {
    action: 'submit',
    id,
    revision: row.revision,
    consent: true,
  });
  assert.equal(
    (
      await mutateDraft(db, owner.id, {
        action: 'submit',
        id,
        revision: row.revision,
        consent: true,
      })
    ).id,
    submitted.id,
  );
  let vehicle = await db.vehicle.findUniqueOrThrow({ where: { id: submitted.id } });
  assert.equal(vehicle.status, 'PENDING_VERIFICATION');
  assert.equal(vehicle.auctionEndsAt, null);
  assert.equal(vehicle.auctionStartAt, null);
  assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } })).draftId, null);
  assert.equal(await db.vehicle.count(), 1);
  console.log(
    'PASS: photo ownership, atomic rollback, saved-photo cleanup exclusion/privacy and single pending submission',
  );
  const edited = await mutateDraft(db, owner.id, {
    action: 'edit',
    vehicleId: vehicle.id,
    version: vehicle.version,
  });
  assert.equal((await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status, 'DRAFT');
  const replacement = await db.mediaAsset.create({
    data: { ownerId: owner.id, filename: `${randomUUID()}.jpg`, status: 'READY', bytes: 100 },
  });
  const revised = {
    ...edited.payload,
    draft: { ...edited.payload.draft, description: 'Changed before approval', powerKw: '' },
    specs: {},
    images: [`/api/uploads/${replacement.filename}`],
  };
  row = await mutateDraft(db, owner.id, {
    action: 'save',
    id: edited.id,
    revision: edited.revision,
    step: 3,
    payload: revised,
  });
  await mutateDraft(db, owner.id, {
    action: 'submit',
    id: row.id,
    revision: row.revision,
    consent: true,
  });
  const updated = await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
  assert.equal(updated.id, vehicle.id);
  assert.equal(updated.description, 'Changed before approval');
  assert.equal(updated.fuelType, null);
  assert.equal(updated.powerKw, null);
  assert.throws(() => assertReviewVersion(updated.version, vehicle.version), /CONFLICT/);
  assert.equal(
    (await db.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } })).vehicleId,
    null,
    'Removed photos detach',
  );
  for (const status of ['ACTIVE', 'SOLD', 'EXPIRED', 'CANCELLED']) {
    await db.vehicle.update({ where: { id: vehicle.id }, data: { status } });
    await assert.rejects(
      () =>
        mutateDraft(db, owner.id, {
          action: 'edit',
          vehicleId: vehicle.id,
          version: updated.version,
        }),
      /DRAFT_LOCKED/,
    );
  }
  await db.vehicle.update({ where: { id: vehicle.id }, data: { status: 'PENDING_VERIFICATION' } });
  const quotaIds = Array.from({ length: 20 }, () => randomUUID());
  await db.listingDraft.createMany({
    data: quotaIds.map((id) => ({ id, ownerId: owner.id, payload })),
  });
  await assert.rejects(
    () =>
      mutateDraft(db, owner.id, {
        action: 'edit',
        vehicleId: vehicle.id,
        version: updated.version,
      }),
    /DRAFT_QUOTA/,
  );
  assert.equal(
    (await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status,
    'PENDING_VERIFICATION',
  );
  await assert.rejects(
    () =>
      mutateDraft(db, owner.id, {
        action: 'save',
        id: randomUUID(),
        revision: 0,
        step: 0,
        payload,
      }),
    /DRAFT_QUOTA/,
  );
  await db.listingDraft.deleteMany({ where: { id: { in: quotaIds } } });
  const hold = await db.paymentHold.create({
    data: {
      userId: outsider.id,
      vehicleId: vehicle.id,
      gateway: 'LOCAL_TEST',
      expiresAt: new Date(),
    },
  });
  await db.bid.create({
    data: {
      userId: outsider.id,
      vehicleId: vehicle.id,
      holdId: hold.id,
      amount: 100,
      requestId: randomUUID(),
    },
  });
  await assert.rejects(
    () =>
      mutateDraft(db, owner.id, {
        action: 'edit',
        vehicleId: vehicle.id,
        version: updated.version,
      }),
    /DRAFT_LOCKED/,
  );
  console.log(
    'PASS: withdraw/edit/resubmit same listing, optional-field clearing, stale admin version and active/bid-bearing locks',
  );
  const http = draftHandlers(db, async () => owner.id),
    unauth = draftHandlers(db, async () => {
      throw Error('UNAUTHORIZED');
    });
  const origin = process.env.NEXTAUTH_URL;
  assert.equal((await unauth.GET(new Request(`${origin}/api/listing-drafts`))).status, 401);
  const post = (body, from = origin) =>
    http.POST(
      new Request(`${origin}/api/listing-drafts`, {
        method: 'POST',
        headers: { origin: from },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await post({}, 'https://other.invalid')).status, 403);
  assert.equal((await post({ x: 'x'.repeat(48001) })).status, 400);
  assert.match(
    (await http.GET(new Request(`${origin}/api/listing-drafts`))).headers.get('cache-control'),
    /private.*no-store/,
  );
  const fresh = randomUUID();
  const newRow = await mutateDraft(db, owner.id, {
    action: 'save',
    id: fresh,
    revision: 0,
    step: 0,
    payload,
  });
  await mutateDraft(db, owner.id, { action: 'discard', id: fresh, revision: newRow.revision });
  assert.equal(await db.listingDraft.count({ where: { id: fresh } }), 0);
  await db.user.update({ where: { id: owner.id }, data: { suspendedAt: new Date() } });
  assert.equal((await http.GET(new Request(`${origin}/api/listing-drafts`))).status, 403);
  assert.equal(await db.transaction.count(), 0);
  console.log(
    'PASS: HTTP origin/auth/body bounds, private cache, discard and suspended-user guard; no payment/API workflow',
  );
} finally {
  await db.$disconnect();
  const { db: globalDb } = await import('../src/lib/db.ts');
  await globalDb.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm10_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: isolated PM10 database removed');
