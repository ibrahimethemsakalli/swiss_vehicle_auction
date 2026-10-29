import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { protectConversation, protectionQueue } from '../src/lib/retention-protection.ts';
import { runRetentionReview } from '../src/lib/retention-review.ts';
import { readAdminQueue, assignAdminWork } from '../src/lib/admin-queue.ts';
import { adminQueueHandlers } from '../src/lib/admin-queue-http.ts';
import { listNotifications, readNotification } from '../src/lib/notifications.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm26h_${randomUUID().replaceAll('-', '')}_test`,
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
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migrated.status, 0, migrated.stderr);
  const user = (role, label, extra = {}) =>
    db.user.create({
      data: {
        role,
        email: label + '@test.invalid',
        phone: 'TEST-' + label,
        passwordHash: 'fixture',
        ...extra,
      },
    });
  const a = await user('ADMIN', 'requester'),
    b = await user('ADMIN', 'reviewer'),
    seller = await user('ADMIN', 'seller'),
    buyer = await user('PRIVATE_USER', 'buyer');
  await user('ADMIN', 'suspended', { suspendedAt: new Date() });
  await user('ADMIN', 'sample', { isSample: true });
  const old = new Date('2000-01-01');
  async function fixture() {
    const v = await db.vehicle.create({
      data: {
        userId: seller.id,
        stammnummer: randomUUID(),
        vinChassis: randomUUID(),
        make: 'PRIVATE MAKE',
        model: 'PRIVATE MODEL',
        description: 'PRIVATE DESCRIPTION',
        images: [],
        mileage: 1,
        mfkDate: old,
        canton: 'ZH',
        serviceHistory: 'UNKNOWN',
        tireCondition: 'UNKNOWN',
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
        body: 'PRIVATE EVIDENCE',
        createdAt: old,
      },
    });
    const p = await protectConversation(db, a.id, {
      action: 'create',
      conversationId: c.id,
      reason: 'PRIVATE PRESERVATION REASON',
    });
    return { v, c, m, p };
  }
  const x = await fixture();
  const cmd = (action, id, version, extra = {}) => ({
    action,
    id,
    version,
    commandId: randomUUID(),
    note: 'PRIVATE REVIEW NOTE',
    ...extra,
  });
  const request = cmd('request', x.p.id, 1, {
    reasonCode: 'WRONG_CONVERSATION',
    evidence: [{ type: 'MESSAGE', id: x.m.id }],
  });
  await runRetentionReview(db, a.id, request);
  await runRetentionReview(db, a.id, request);
  const r = await db.retentionReviewRequest.findFirstOrThrow({ where: { protectionId: x.p.id } });
  let notices = await db.notification.findMany();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].userId, b.id);
  assert.equal(notices[0].retentionRequestId, r.id);
  assert.equal(notices[0].vehicleName, '');
  assert.ok(!JSON.stringify(notices).includes('PRIVATE'));
  let q = await readAdminQueue(db, b.id, { kind: 'retention', status: 'OPEN', q: r.id });
  assert.equal(q.total, 1);
  assert.equal(q.items[0].canClaim, true);
  assert.equal(q.items[0].noReviewer, false);
  assert.ok(!JSON.stringify(q).includes('PRIVATE'));
  assert.equal((await readAdminQueue(db, a.id, { kind: 'retention' })).items[0].canClaim, false);
  assert.equal((await readAdminQueue(db, seller.id, { kind: 'retention' })).total, 0);
  await assert.rejects(readAdminQueue(db, buyer.id, { kind: 'retention' }), /FORBIDDEN/);
  const claim = {
    kind: 'retention',
    id: r.id,
    action: 'claim',
    version: 0,
    note: 'Independent review coordination',
  };
  await assert.rejects(assignAdminWork(db, a.id, claim), /FORBIDDEN/);
  await assert.rejects(assignAdminWork(db, seller.id, claim), /PARTICIPANT/);
  const claims = await Promise.all([
    assignAdminWork(db, b.id, claim).then(
      () => 200,
      (e) => e.message,
    ),
    assignAdminWork(db, b.id, claim).then(
      () => 200,
      (e) => e.message,
    ),
  ]);
  assert.ok(claims.includes(200) && claims.includes('CONFLICT'));
  await assert.rejects(
    runRetentionReview(db, a.id, cmd('approve', r.id, 1)),
    /SECOND_ADMIN_REQUIRED/,
  );
  const inbox = await listNotifications(db, b.id, {});
  assert.equal(inbox.items[0].retentionRequestId, r.id);
  assert.equal(inbox.unreadCount, 1);
  await readNotification(db, a.id, { id: notices[0].id });
  assert.equal((await listNotifications(db, b.id, { summary: 'true' })).unreadCount, 1);
  await readNotification(db, b.id, { id: notices[0].id });
  const readAt = (await db.notification.findUniqueOrThrow({ where: { id: notices[0].id } })).readAt;
  await readNotification(db, b.id, { id: notices[0].id });
  assert.deepEqual(
    (await db.notification.findUniqueOrThrow({ where: { id: notices[0].id } })).readAt,
    readAt,
  );
  await runRetentionReview(db, b.id, cmd('info', r.id, 1));
  assert.equal((await listNotifications(db, a.id, {})).items[0].kind, 'RETENTION_INFO');
  assert.equal(
    (await readAdminQueue(db, b.id, { kind: 'retention', status: 'NEEDS_INFO' })).total,
    1,
  );
  await assert.rejects(assignAdminWork(db, b.id, { ...claim, version: 1 }), /CONFLICT/);
  await runRetentionReview(
    db,
    a.id,
    cmd('supplement', r.id, 2, { evidence: [{ type: 'MESSAGE', id: x.m.id }] }),
  );
  assert.equal(
    await db.notification.count({ where: { userId: b.id, kind: 'RETENTION_REVIEW' } }),
    2,
  );
  await db.user.update({ where: { id: b.id }, data: { role: 'PRIVATE_USER' } });
  assert.equal((await listNotifications(db, b.id, {})).items.length, 0);
  assert.equal((await listNotifications(db, b.id, { summary: 'true' })).unreadCount, 0);
  await assert.rejects(protectionQueue(db, b.id, { request: r.id }), /FORBIDDEN/);
  await db.user.update({ where: { id: b.id }, data: { role: 'ADMIN' } });
  await runRetentionReview(db, b.id, cmd('keep', r.id, 3));
  assert.equal(
    (
      await db.adminWorkItem.findUniqueOrThrow({
        where: { kind_recordId: { kind: 'retention', recordId: r.id } },
      })
    ).ownerId,
    null,
  );
  assert.equal((await listNotifications(db, a.id, {})).items[0].kind, 'RETENTION_KEPT');
  await assert.rejects(assignAdminWork(db, b.id, { ...claim, version: 2 }), /CONFLICT/);
  const oldLink = await protectionQueue(db, a.id, { request: r.id });
  assert.equal(oldLink.rows[0].requests[0].status, 'KEPT');
  await assert.rejects(protectionQueue(db, seller.id, { request: r.id }), /FORBIDDEN/);
  // No suitable second admin: request survives without notification or approval fallback.
  await db.user.update({ where: { id: b.id }, data: { suspendedAt: new Date() } });
  const request2 = cmd('request', x.p.id, 1, {
    reasonCode: 'NEW_EVIDENCE',
    evidence: [{ type: 'MESSAGE', id: x.m.id }],
  });
  const count = await db.notification.count();
  await runRetentionReview(db, a.id, request2);
  assert.equal(await db.notification.count(), count);
  const pending = await db.retentionReviewRequest.findFirstOrThrow({
    where: { protectionId: x.p.id, status: 'OPEN' },
  });
  assert.equal(
    (await readAdminQueue(db, a.id, { kind: 'retention', status: 'OPEN' })).items[0].noReviewer,
    true,
  );
  assert.equal((await protectionQueue(db, a.id, { request: r.id })).rows[0].requests[0].id, r.id);
  await db.user.update({ where: { id: b.id }, data: { suspendedAt: null } });
  await assignAdminWork(db, b.id, { ...claim, id: pending.id });
  await runRetentionReview(db, a.id, cmd('withdraw', pending.id, 1));
  assert.equal((await listNotifications(db, b.id, {})).items[0].kind, 'RETENTION_WITHDRAWN');
  // Final decision routes to requester; no change to the original two-admin rule.
  const y = await fixture();
  await runRetentionReview(
    db,
    a.id,
    cmd('request', y.p.id, 1, {
      reasonCode: 'WRONG_CONVERSATION',
      evidence: [{ type: 'MESSAGE', id: y.m.id }],
    }),
  );
  const yr = await db.retentionReviewRequest.findFirstOrThrow({ where: { protectionId: y.p.id } });
  await runRetentionReview(db, b.id, cmd('approve', yr.id, 1));
  assert.equal((await listNotifications(db, a.id, {})).items[0].kind, 'RETENTION_RELEASED');
  assert.equal(
    (await readAdminQueue(db, a.id, { kind: 'retention', status: 'RELEASED' })).total,
    1,
  );
  // Delivery failure rolls back the request and its audit event; no orphan task or duplicate notice.
  const z = await fixture();
  await sql.query(
    `CREATE FUNCTION pm26h_notice_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind LIKE 'RETENTION_%' THEN RAISE EXCEPTION 'TEST_NOTICE_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER pm26h_notice_fail BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION pm26h_notice_fail();`,
  );
  await assert.rejects(
    runRetentionReview(
      db,
      a.id,
      cmd('request', z.p.id, 1, {
        reasonCode: 'NEW_EVIDENCE',
        evidence: [{ type: 'MESSAGE', id: z.m.id }],
      }),
    ),
    /TEST_NOTICE_FAILURE/,
  );
  assert.equal(await db.retentionReviewRequest.count({ where: { protectionId: z.p.id } }), 0);
  assert.equal(
    await db.retentionReviewEvent.count({ where: { protectionId: z.p.id, kind: 'REQUEST' } }),
    0,
  );
  const handler = adminQueueHandlers(db, async () => b.id);
  process.env.LOCAL_PROXY_ENGINE = 'false';
  assert.equal(
    (await handler.GET(new Request('http://localhost:3000/api/admin/work?kind=retention'))).status,
    404,
  );
  assert.equal((await listNotifications(db, b.id, {})).items.length, 0);
  assert.equal((await listNotifications(db, b.id, { summary: 'true' })).unreadCount, 0);
  assert.equal(await db.chatMessage.count(), 3);
  console.log(
    'PASS PM26H: eligible recipients, atomic/idempotent notifications, queue/claim rights, exact deep links, read ownership, revoked access, no-reviewer queue, close cleanup and delivery rollback.',
  );
} finally {
  await sql.end();
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm26h_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM26H isolated database removed.');
}
