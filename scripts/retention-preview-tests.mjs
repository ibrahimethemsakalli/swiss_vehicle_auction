import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { readRetentionInventory } from '../src/lib/retention-inventory.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm26d_${randomUUID().replaceAll('-', '')}_test`,
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()), {
  NODE_ENV: 'test',
  LOCAL_PROXY_ENGINE: 'true',
});
const control = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migrated.status, 0, migrated.stderr);
  const admin = await db.user.create({
    data: {
      email: 'admin-preview@test.invalid',
      phone: 'TEST-ADMIN',
      passwordHash: 'fixture',
      role: 'ADMIN',
    },
  });
  const buyer = await db.user.create({
    data: {
      email: 'buyer-preview@test.invalid',
      phone: 'TEST-BUYER',
      passwordHash: 'fixture',
      role: 'PRIVATE_USER',
    },
  });
  const old = new Date('2000-01-01'),
    recent = new Date(),
    future = new Date('2099-01-01');
  const fixture = async (kind) => {
    const v = await db.vehicle.create({
      data: {
        userId: admin.id,
        stammnummer: kind,
        vinChassis: randomUUID(),
        make: 'TEST',
        model: 'TEST',
        mileage: 1,
        mfkDate: old,
        canton: 'ZH',
        serviceHistory: 'UNKNOWN',
        tireCondition: 'UNKNOWN',
        description: 'PRIVATE DESCRIPTION',
        images: [],
        listingType: 'AUCTION_7_DAYS',
        startPrice: 1000,
      },
    });
    const c = await db.conversation.create({
      data: {
        vehicleId: v.id,
        sellerId: admin.id,
        buyerId: buyer.id,
        createdAt: kind === 'newConversation' ? recent : old,
        updatedAt: recent,
      },
    });
    const m = await db.chatMessage.create({
      data: {
        conversationId: c.id,
        senderId: buyer.id,
        requestId: randomUUID(),
        body: 'PRIVATE MESSAGE',
        createdAt: kind === 'recentMessage' ? recent : kind === 'future' ? future : old,
      },
    });
    if (
      [
        'PENDING',
        'ACCEPTED',
        'CANCELLED',
        'EXPIRED',
        'DECLINED',
        'recentAppointment',
        'mystery',
      ].includes(kind)
    ) {
      const date = kind === 'recentAppointment' ? recent : old;
      await db.appointment.create({
        data: {
          conversationId: c.id,
          proposerId: buyer.id,
          requestId: randomUUID(),
          location: 'PRIVATE LOCATION',
          startsAt: old,
          createdAt: date,
          updatedAt: date,
          status: kind === 'recentAppointment' ? 'CANCELLED' : kind,
        },
      });
      // Prisma @updatedAt may normalize fixture timestamps: set historical time explicitly.
      await db.$executeRaw`UPDATE "Appointment" SET "createdAt"=${date},"updatedAt"=${date} WHERE "conversationId"=${c.id}`;
    }
    if (kind === 'closedReport')
      await db.messageReport.create({
        data: {
          messageId: m.id,
          reporterId: buyer.id,
          category: 'OTHER',
          note: 'PRIVATE REASON',
          status: 'CLOSED',
        },
      });
    if (kind === 'listingReport')
      await db.listingReport.create({
        data: {
          vehicleId: v.id,
          reporterId: buyer.id,
          category: 'OTHER',
          note: 'PRIVATE REASON',
          status: 'CLOSED',
        },
      });
    if (kind === 'releasedHold')
      await db.paymentHold.create({
        data: {
          vehicleId: v.id,
          userId: buyer.id,
          gateway: 'local',
          status: 'RELEASED',
          expiresAt: old,
        },
      });
    return { v, c, m };
  };
  // Each fixture contains one message. No login, auction or payment workflows are replayed.
  const candidate = await fixture('candidate');
  for (const kind of [
    'newConversation',
    'recentMessage',
    'recentAppointment',
    'future',
    'PENDING',
    'ACCEPTED',
    'CANCELLED',
    'EXPIRED',
    'DECLINED',
    'closedReport',
    'listingReport',
    'releasedHold',
    'mystery',
  ])
    await fixture(kind);
  const before = await db.chatMessage.findMany();
  let r = await readRetentionInventory(db, admin.id);
  assert.deepEqual(r.messageAssessment, { elapsed: '4', evidence: '5', notDue: '3', unknown: '2' });
  assert.equal(r.rows.find((x) => x.table === 'ChatMessage').candidate, '4');
  assert.equal(r.candidateAssessment, 'message_preview_only');
  assert.equal(
    BigInt(r.totals.count),
    BigInt(r.totals.candidate) + BigInt(r.totals.protected) + BigInt(r.totals.unknown),
  );
  assert.deepEqual(await db.chatMessage.findMany(), before);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  assert.ok(!JSON.stringify(r).includes(candidate.c.id));
  // New evidence after a preview must remove the candidate on the next read.
  await db.messageReport.create({
    data: {
      messageId: candidate.m.id,
      reporterId: buyer.id,
      category: 'OTHER',
      note: 'new evidence',
      status: 'OPEN',
    },
  });
  r = await readRetentionInventory(db, admin.id);
  assert.equal(r.messageAssessment.elapsed, '3');
  assert.equal(r.messageAssessment.evidence, '6');
  assert.deepEqual(await db.chatMessage.findMany(), before);
  console.log(
    'PASS PM26D: candidate/activity selection, active and closed appointments, closed reports, released reservations, unknown/future data, refresh reclassification, exact totals and no writes.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm26d_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM26D isolated database removed.');
}
