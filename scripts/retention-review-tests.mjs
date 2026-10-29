import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import {
  protectConversation,
  protectionHandlers,
  protectionQueue,
} from '../src/lib/retention-protection.ts';
import { runRetentionReview, lockRetentionSources } from '../src/lib/retention-review.ts';
import { readRetentionInventory } from '../src/lib/retention-inventory.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm26g_${randomUUID().replaceAll('-', '')}_test`,
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()), {
  NODE_ENV: 'test',
  LOCAL_PROXY_ENGINE: 'true',
  NEXTAUTH_URL: 'http://localhost:3000',
});
const control = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString()),
  sql = new pg.Pool({ connectionString: target.toString() });
let created = false;
try {
  await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  // Apply exact existing SQL, then exercise migration on a real PM26E legacy record.
  const newest = '202610280021_retention_review';
  for (const dir of readdirSync('prisma/migrations')
    .filter((x) => /^\d/.test(x) && x < newest)
    .sort())
    await sql.query(readFileSync(`prisma/migrations/${dir}/migration.sql`, 'utf8'));
  const user = async (role, label) =>
    db.user.create({
      data: {
        role,
        email: label + '@test.invalid',
        phone: 'TEST-' + label,
        passwordHash: 'fixture',
      },
    });
  const a = await user('ADMIN', 'admin-a'),
    b = await user('ADMIN', 'admin-b'),
    seller = await user('ADMIN', 'seller-admin'),
    buyer = await user('PRIVATE_USER', 'buyer');
  const old = new Date('2000-01-01');
  async function fixture() {
    const v = await db.vehicle.create({
      data: {
        userId: seller.id,
        stammnummer: randomUUID(),
        vinChassis: randomUUID(),
        make: 'LOCAL TEST',
        model: 'PM26G',
        mileage: 1,
        mfkDate: old,
        canton: 'ZH',
        serviceHistory: 'UNKNOWN',
        tireCondition: 'UNKNOWN',
        description: 'fixture',
        images: [],
        listingType: 'AUCTION_7_DAYS',
        startPrice: 1000,
      },
    });
    const c = await db.conversation.create({
      data: { vehicleId: v.id, sellerId: seller.id, buyerId: buyer.id, createdAt: old },
    });
    const m = await db.chatMessage.create({
      data: {
        conversationId: c.id,
        senderId: buyer.id,
        requestId: randomUUID(),
        createdAt: old,
        body: 'Evidence: the previous manual protection was assigned in error.',
      },
    });
    return { v, c, m };
  }
  const f = await fixture();
  const legacy = randomUUID();
  await sql.query(
    'INSERT INTO "RetentionProtection" (id,"conversationId",reason,"createdById","reviewedById","reviewedAt","reviewNote","createdAt") VALUES ($1,$2,$3,$4,$5,\'2000-01-02\',$6,\'2000-01-01\')',
    [legacy, f.c.id, 'Legacy preservation reason', a.id, b.id, 'Legacy review, keep all evidence'],
  );
  await sql.query(readFileSync(`prisma/migrations/${newest}/migration.sql`, 'utf8'));
  for (const dir of readdirSync('prisma/migrations')
    .filter((x) => /^\d/.test(x) && x > newest)
    .sort())
    await sql.query(readFileSync(`prisma/migrations/${dir}/migration.sql`, 'utf8'));
  const p = await db.retentionProtection.findUniqueOrThrow({ where: { id: legacy } });
  assert.equal(p.status, 'ACTIVE');
  assert.equal(p.reviewNote, 'Legacy review, keep all evidence');
  assert.equal(await db.retentionReviewEvent.count({ where: { protectionId: p.id } }), 2);
  const command = (action, id, version, extra = {}) => ({
    action,
    id,
    version,
    commandId: randomUUID(),
    note: 'Evidence assessed without assigning a retention deadline',
    ...extra,
  });
  const request = () =>
    command('request', p.id, 1, {
      reasonCode: 'WRONG_CONVERSATION',
      evidence: [{ type: 'MESSAGE', id: f.m.id }],
    });
  await assert.rejects(runRetentionReview(db, seller.id, request()), /PARTICIPANT/);
  await assert.rejects(runRetentionReview(db, buyer.id, request()), /FORBIDDEN/);
  await assert.rejects(
    runRetentionReview(db, a.id, {
      ...request(),
      evidence: [{ type: 'MESSAGE', id: randomUUID() }],
    }),
    /INVALID_EVIDENCE/,
  );
  await assert.rejects(
    protectConversation(db, b.id, {
      action: 'review',
      id: p.id,
      note: 'Legacy action must not bypass review',
    }),
    /LEGACY_REVIEW_DISABLED/,
  );
  const reqCmd = request();
  await runRetentionReview(db, a.id, reqCmd);
  assert.equal((await runRetentionReview(db, a.id, reqCmd)).replayed, true);
  await assert.rejects(
    runRetentionReview(db, a.id, { ...reqCmd, note: 'Different payload using the same command' }),
    /CONFLICT/,
  );
  let req = await db.retentionReviewRequest.findFirstOrThrow({ where: { protectionId: p.id } });
  await assert.rejects(
    runRetentionReview(db, a.id, command('approve', req.id, req.version)),
    /SECOND_ADMIN_REQUIRED/,
  );
  await assert.rejects(
    runRetentionReview(db, seller.id, command('approve', req.id, req.version)),
    /PARTICIPANT/,
  );
  await runRetentionReview(db, b.id, command('info', req.id, req.version));
  req = await db.retentionReviewRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(req.status, 'NEEDS_INFO');
  await assert.rejects(
    runRetentionReview(db, b.id, command('approve', req.id, req.version)),
    /STALE_REVIEW/,
  );
  await runRetentionReview(
    db,
    a.id,
    command('supplement', req.id, req.version, { evidence: [{ type: 'MESSAGE', id: f.m.id }] }),
  );
  req = await db.retentionReviewRequest.findUniqueOrThrow({ where: { id: req.id } });
  await db.chatMessage.update({
    where: { id: f.m.id },
    data: { body: 'Updated internal evidence requires a new assessment.' },
  });
  await assert.rejects(
    runRetentionReview(db, b.id, command('approve', req.id, req.version)),
    /STALE_REVIEW/,
  );
  await runRetentionReview(
    db,
    a.id,
    command('supplement', req.id, req.version, { evidence: [{ type: 'MESSAGE', id: f.m.id }] }),
  );
  req = await db.retentionReviewRequest.findUniqueOrThrow({ where: { id: req.id } });
  await db.user.update({ where: { id: a.id }, data: { suspendedAt: new Date() } });
  await assert.rejects(
    runRetentionReview(db, b.id, command('approve', req.id, req.version)),
    /FORBIDDEN/,
  );
  await db.user.update({ where: { id: a.id }, data: { suspendedAt: null } });
  const before = await db.chatMessage.findMany();
  const approve = command('approve', req.id, req.version);
  const attempts = await Promise.all([
    runRetentionReview(db, b.id, approve),
    runRetentionReview(db, b.id, approve),
  ]);
  assert.equal(attempts.filter((x) => x.replayed).length, 1);
  assert.equal(
    (await db.retentionProtection.findUniqueOrThrow({ where: { id: p.id } })).status,
    'RELEASED',
  );
  assert.equal((await readRetentionInventory(db, a.id)).messageAssessment.elapsed, '1');
  assert.deepEqual(await db.chatMessage.findMany(), before);
  await assert.rejects(
    db.retentionReviewEvent.updateMany({
      where: { protectionId: p.id },
      data: { kind: 'TAMPERED' },
    }),
    /RETENTION_EVENT_IMMUTABLE/,
  );
  const renewed = await protectConversation(db, a.id, {
    action: 'create',
    conversationId: f.c.id,
    reason: 'New evidence requires another protection period',
  });
  assert.notEqual(renewed.id, p.id);
  assert.equal((await readRetentionInventory(db, a.id)).messageAssessment.evidence, '1');
  const history = await protectionQueue(db, a.id, { history: p.id });
  assert.equal(history.events[0].kind, 'LEGACY_CREATE');
  assert.equal(history.events.at(-1).kind, 'RELEASED');
  assert.equal(
    (await protectionQueue(db, a.id, { history: p.id, after: history.events[0].id })).events.length,
    history.events.length - 1,
  );
  // Closed requests can be reopened without losing history; neither keep nor withdraw releases.
  for (const action of ['keep', 'withdraw']) {
    await runRetentionReview(
      db,
      a.id,
      command('request', renewed.id, 1, {
        reasonCode: 'REASON_CHANGED',
        evidence: [{ type: 'MESSAGE', id: f.m.id }],
      }),
    );
    const q = await db.retentionReviewRequest.findFirstOrThrow({
      where: { protectionId: renewed.id, status: 'OPEN' },
    });
    await runRetentionReview(db, action === 'keep' ? b.id : a.id, command(action, q.id, 1));
    assert.equal(
      (await db.retentionProtection.findUniqueOrThrow({ where: { id: renewed.id } })).status,
      'ACTIVE',
    );
  }
  const ap = await fixture();
  const appointment = await db.appointment.create({
    data: {
      conversationId: ap.c.id,
      proposerId: buyer.id,
      requestId: randomUUID(),
      location: 'LOCAL TEST',
      startsAt: old,
      status: 'CANCELLED',
    },
  });
  const apHold = await protectConversation(db, a.id, {
    action: 'create',
    conversationId: ap.c.id,
    reason: 'Cancelled appointment evidence review',
  });
  await runRetentionReview(
    db,
    a.id,
    command('request', apHold.id, 1, {
      reasonCode: 'CASE_CHANGED',
      evidence: [{ type: 'APPOINTMENT', id: appointment.id }],
    }),
  );
  const apRequest = await db.retentionReviewRequest.findFirstOrThrow({
    where: { protectionId: apHold.id },
  });
  // Failed audit write must roll back both release and request decision.
  await sql.query(
    `CREATE FUNCTION pm26g_reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='RELEASED' THEN RAISE EXCEPTION 'TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER pm26g_reject_event BEFORE INSERT ON "RetentionReviewEvent" FOR EACH ROW EXECUTE FUNCTION pm26g_reject_event();`,
  );
  await assert.rejects(
    runRetentionReview(db, b.id, command('approve', apRequest.id, 1)),
    /TEST_AUDIT_FAILURE/,
  );
  assert.equal(
    (await db.retentionProtection.findUniqueOrThrow({ where: { id: apHold.id } })).status,
    'ACTIVE',
  );
  assert.equal(
    (await db.retentionReviewRequest.findUniqueOrThrow({ where: { id: apRequest.id } })).status,
    'OPEN',
  );
  await sql.query(
    'DROP TRIGGER pm26g_reject_event ON "RetentionReviewEvent"; DROP FUNCTION pm26g_reject_event();',
  );
  await runRetentionReview(db, b.id, command('approve', apRequest.id, 1));
  assert.equal(
    (await db.retentionProtection.findUniqueOrThrow({ where: { id: apHold.id } })).status,
    'RELEASED',
  );
  assert.equal((await readRetentionInventory(db, a.id)).messageAssessment.notDue, '1');
  // Approval-first lock: an independent source writer cannot cross the critical section.
  await db.$transaction(async (tx) => {
    await lockRetentionSources(tx);
    const w = await sql.connect();
    try {
      await w.query('BEGIN');
      await w.query("SET LOCAL lock_timeout='100ms'");
      await assert.rejects(
        w.query('UPDATE "ChatMessage" SET body=body WHERE id=$1', [f.m.id]),
        (e) => e.code === '55P03',
      );
    } finally {
      await w.query('ROLLBACK');
      w.release();
    }
  });
  // New fixtures test only release blockers, not the old auction/payment workflows.
  for (const blocker of [
    'report',
    'hold',
    'future',
    'unknownAppointment',
    'bid',
    'sale',
    'listingReport',
    'appointment',
    'hidden',
    'unrelated',
  ]) {
    const x = await fixture();
    const hold = await protectConversation(db, a.id, {
      action: 'create',
      conversationId: x.c.id,
      reason: 'Release blocker scenario protection',
    });
    const r = command('request', hold.id, 1, {
      reasonCode: 'CASE_CHANGED',
      evidence: [{ type: 'MESSAGE', id: x.m.id }],
    });
    await runRetentionReview(db, a.id, r);
    const q = await db.retentionReviewRequest.findFirstOrThrow({
      where: { protectionId: hold.id },
    });
    if (blocker === 'report')
      await db.messageReport.create({
        data: {
          messageId: x.m.id,
          reporterId: buyer.id,
          category: 'OTHER',
          note: 'closed report evidence',
          status: 'CLOSED',
        },
      });
    if (blocker === 'hold')
      await db.paymentHold.create({
        data: {
          vehicleId: x.v.id,
          userId: buyer.id,
          gateway: 'local',
          status: 'RELEASED',
          expiresAt: old,
        },
      });
    if (blocker === 'future')
      await db.chatMessage.update({
        where: { id: x.m.id },
        data: { createdAt: new Date('2099-01-01') },
      });
    if (['unknownAppointment', 'appointment'].includes(blocker))
      await db.appointment.create({
        data: {
          conversationId: x.c.id,
          proposerId: buyer.id,
          requestId: randomUUID(),
          location: 'TEST',
          startsAt: old,
          status: blocker === 'appointment' ? 'PENDING' : 'MYSTERY',
        },
      });
    if (['bid', 'sale'].includes(blocker)) {
      const hold = await db.paymentHold.create({
        data: {
          vehicleId: x.v.id,
          userId: buyer.id,
          gateway: 'local',
          status: 'RELEASED',
          expiresAt: old,
        },
      });
      const bid = await db.bid.create({
        data: {
          vehicleId: x.v.id,
          userId: buyer.id,
          amount: 1000,
          holdId: hold.id,
          requestId: randomUUID(),
        },
      });
      if (blocker === 'sale')
        await db.settlement.create({ data: { vehicleId: x.v.id, bidId: bid.id } });
    }
    if (blocker === 'listingReport')
      await db.listingReport.create({
        data: {
          vehicleId: x.v.id,
          reporterId: buyer.id,
          category: 'OTHER',
          note: 'closed listing report',
          status: 'CLOSED',
        },
      });
    if (blocker === 'hidden')
      await db.chatMessage.update({ where: { id: x.m.id }, data: { hiddenAt: new Date() } });
    if (blocker === 'unrelated')
      await db.retentionReviewRequest.update({
        where: { id: q.id },
        data: { evidence: [{ type: 'MESSAGE', id: f.m.id }] },
      });
    await assert.rejects(
      runRetentionReview(db, b.id, command('approve', q.id, 1)),
      /AUTOMATIC_PROTECTION|UNCERTAIN|INVALID_EVIDENCE/,
    );
    assert.equal(
      (await db.retentionProtection.findUniqueOrThrow({ where: { id: hold.id } })).status,
      'ACTIVE',
    );
  }
  // Writer-first race: approval waits for an uncommitted report, then sees and blocks it.
  const race = await fixture();
  const hp = await protectConversation(db, a.id, {
    action: 'create',
    conversationId: race.c.id,
    reason: 'Race condition fixture protection',
  });
  await runRetentionReview(
    db,
    a.id,
    command('request', hp.id, 1, {
      reasonCode: 'NEW_EVIDENCE',
      evidence: [{ type: 'MESSAGE', id: race.m.id }],
    }),
  );
  const rq = await db.retentionReviewRequest.findFirstOrThrow({ where: { protectionId: hp.id } });
  const writer = await sql.connect();
  await writer.query('BEGIN');
  await writer.query(
    'INSERT INTO "MessageReport" (id,"messageId","reporterId",category,note,status) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), race.m.id, buyer.id, 'OTHER', 'race evidence', 'OPEN'],
  );
  const pending = runRetentionReview(db, b.id, command('approve', rq.id, 1)).then(
    () => null,
    (e) => e.message,
  );
  await writer.query('COMMIT');
  writer.release();
  assert.equal(await pending, 'AUTOMATIC_PROTECTION');
  const http = protectionHandlers(db, async () => b.id);
  const post = (body, origin = 'http://localhost:3000') =>
    new Request('http://localhost:3000/api/admin/retention/protections', {
      method: 'POST',
      headers: { origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await http.POST(post(command('approve', rq.id, 1), 'https://bad.invalid'))).status,
    403,
  );
  assert.equal((await http.POST(post(command('approve', rq.id, 1)))).status, 409);
  process.env.LOCAL_PROXY_ENGINE = 'false';
  assert.equal((await http.POST(post(command('approve', rq.id, 1)))).status, 404);
  console.log(
    'PASS PM26G: legacy migration, evidence, two-admin/participant/role gates, resubmission and stale snapshots, atomic replay, immutable history, new periods, blockers, writer race, HTTP isolation, unchanged messages.',
  );
} finally {
  await sql.end();
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm26g_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM26G isolated database removed.');
}
