import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { createDatabaseClient } from '../src/lib/database-client';
import { RefundRepository } from '../src/lib/refund-repository';
import { RefundDecisions } from '../src/lib/refund-decisions';
import { approvedRefundPolicy } from '../src/lib/refund-policy';
import { remindRefundInformation } from '../src/lib/refund-notifications';
import { refundHandlers } from '../src/lib/refund-http';
import { refundReconciliation } from '../src/lib/refund-reconciliation';
import type { RefundCapture } from '../src/lib/refund-domain';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = 'autoveri_l11_policy_' + randomUUID().replaceAll('-', '') + '_test',
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
const control = new Pool({ connectionString: maintenance.toString() }),
  pool = new Pool({ connectionString: target.toString() }),
  db = createDatabaseClient(target.toString());
const repo = new RefundRepository(pool),
  service = new RefundDecisions(pool);
const reason = 'LOCAL TEST ONLY reason with sufficient explanation';
let created = false,
  groups = 0;
const pass = (s: string) => {
  groups++;
  console.log('PASS ' + s);
};
try {
  await control.query(`CREATE DATABASE "${name}"`);
  created = true;
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: target.toString() }, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migration.status, 0, migration.stderr);
  const makeUser = (role: 'ADMIN' | 'PRIVATE_USER') =>
    db.user.create({
      data: {
        email: randomUUID() + '@test.invalid',
        phone: randomUUID(),
        passwordHash: 'fixture',
        role,
      },
    });
  const [buyer, seller, other, admin, second, executor] = await Promise.all([
    makeUser('PRIVATE_USER'),
    makeUser('ADMIN'),
    makeUser('PRIVATE_USER'),
    makeUser('ADMIN'),
    makeUser('ADMIN'),
    makeUser('ADMIN'),
  ]);
  const grantIds = [admin.id, second.id, executor.id, seller.id, other.id];
  const policy = {
    version: 'TEST-ONLY',
    reviewRulesConfirmed: true,
    partialRefunds: false,
    requiredApprovals: 1,
    separateExecutor: true,
  };
  await pool.query('INSERT INTO "RefundRuntimePolicy" (id,policy,actors) VALUES ($1,$2,$3)', [
    'active',
    JSON.stringify(policy),
    JSON.stringify(
      grantIds.map((id) => ({
        id,
        active: true,
        capabilities: ['refund.review', 'refund.execute', 'payment.reconcile'],
      })),
    ),
  ]);
  async function fixture() {
    const v = await db.vehicle.create({
      data: {
        userId: seller.id,
        stammnummer: randomUUID(),
        vinChassis: randomUUID(),
        make: 'TEST',
        model: 'LOCAL',
        mileage: 0,
        mfkDate: new Date(),
        canton: 'ZH',
        serviceHistory: 'test',
        tireCondition: 'test',
        description: 'test',
        images: [],
        listingType: 'AUCTION_7_DAYS',
        startPrice: 100,
      },
    });
    const id = randomUUID(),
      ref = randomUUID();
    const hold = await db.paymentHold.create({
      data: {
        userId: buyer.id,
        vehicleId: v.id,
        gateway: 'fake',
        gatewayTransactionId: ref,
        status: 'CAPTURED_FEE',
        expiresAt: new Date(),
      },
    });
    const c: RefundCapture = {
      scope: { provider: 'fake', merchant: 'test', environment: 'test' },
      captureRef: ref,
      currency: 'CHF',
      amountMinor: 3000,
      confirmed: true,
      participantIds: [buyer.id, seller.id],
      version: 0,
      blocked: false,
      operations: [],
      evidence: [],
      findings: [],
    };
    await repo.register(id, c);
    await pool.query('INSERT INTO "RefundCaptureBinding" ("captureId","holdId") VALUES ($1,$2)', [
      id,
      hold.id,
    ]);
    return id;
  }

  // Only changed policy paths; no real provider may be contacted by this process.
  globalThis.fetch = async () => {
    throw Error('NETWORK_FORBIDDEN');
  };
  const open = async (captureId: string) =>
    service.request(buyer.id, { captureId, requestId: randomUUID(), reason });
  async function action(
    actor: string,
    id: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    const row = (await pool.query('SELECT version FROM "RefundCase" WHERE id=$1', [id])).rows[0];
    return service.workflow(actor, {
      caseId: id,
      requestId: randomUUID(),
      expectedVersion: row.version,
      action,
      reason,
      ...extra,
    });
  }
  async function vote(actor: string, id: string, outcome = 'APPROVE') {
    const row = (await pool.query('SELECT version FROM "RefundCase" WHERE id=$1', [id])).rows[0];
    return service.decide(actor, {
      caseId: id,
      requestId: randomUUID(),
      expectedVersion: row.version,
      outcome,
      reason,
    });
  }
  const id = await fixture();
  const requests = [
    { captureId: id, requestId: randomUUID(), reason },
    { captureId: id, requestId: randomUUID(), reason: reason + ' second' },
  ];
  const merged = await Promise.all(requests.map((i) => service.request(buyer.id, i)));
  assert.equal(merged[0].id, merged[1].id);
  const caseId = merged[0].id;
  assert.equal(
    (await pool.query('SELECT count(*)::int n FROM "RefundCase" WHERE "captureId"=$1', [id]))
      .rows[0].n,
    1,
  );
  const replay = await service.request(buyer.id, requests[1]);
  assert.equal(replay.id, caseId);
  assert.equal((await service.read(buyer.id, caseId)).activities.length, 2);
  pass('concurrent requests merge with durable reasons and idempotent replay');

  await assert.rejects(vote(admin.id, caseId), /EVIDENCE_REQUIRED/);
  await action(admin.id, caseId, 'REQUEST_INFORMATION');
  let detail = await service.read(buyer.id, caseId);
  assert.equal(detail.status, 'NEEDS_INFORMATION');
  assert.equal(detail.timing.businessCalendar, null);
  assert.equal(detail.timing.decisionDueAt, null);
  const due = new Date(detail.timing.informationDueAt!);
  assert.ok(due.getTime() > Date.now() + 9 * 86400000);
  await pool.query(
    `UPDATE "RefundCase" SET "informationDueAt"=clock_timestamp()-interval '1 second' WHERE id=$1`,
    [caseId],
  );
  assert.equal(await remindRefundInformation(pool), 1);
  assert.equal(await remindRefundInformation(pool), 0);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int n FROM "Notification" WHERE "eventKey" LIKE $1', [
        'refund:reminder:' + caseId + ':%',
      ])
    ).rows[0].n,
    1,
  );
  detail = await service.read(buyer.id, caseId);
  assert.equal(detail.status, 'NEEDS_INFORMATION');
  assert.equal(detail.timing.informationOverdue, true);
  await action(buyer.id, caseId, 'PROVIDE_INFORMATION');
  await action(admin.id, caseId, 'CONFIRM_EVIDENCE');
  assert.equal((await vote(admin.id, caseId)).status, 'IN_REVIEW'); // old runtime policy asked for only one approval
  await action(second.id, caseId, 'CONFIRM_EVIDENCE');
  assert.equal((await vote(admin.id, caseId)).status, 'IN_REVIEW'); // reconfirming evidence starts a fresh vote round
  await action(second.id, caseId, 'REQUEST_INFORMATION');
  await action(buyer.id, caseId, 'PROVIDE_INFORMATION');
  await action(second.id, caseId, 'CONFIRM_EVIDENCE');
  assert.equal((await vote(second.id, caseId)).status, 'IN_REVIEW'); // old vote did not carry over
  assert.equal((await vote(admin.id, caseId)).status, 'APPROVED');
  pass(
    'evidence gating, information target/reminder, no auto-rejection and fresh two-person votes',
  );

  const current = await service.read(buyer.id, caseId),
    key = randomUUID();
  await assert.rejects(
    repo.queue(id, {
      key,
      caseId,
      decisionVersion: current.version,
      expectedVersion: 0,
      amountMinor: 1500,
    }),
    /DECISION_REQUIRED|PARTIAL_REFUND_DISABLED/,
  );
  await repo.queue(id, {
    key,
    caseId,
    decisionVersion: current.version,
    expectedVersion: 0,
    amountMinor: 3000,
  });
  let submitCount = 0;
  const fake = {
    submit: async (i: any) => {
      submitCount++;
      return { ...i, eventId: randomUUID(), refundRef: randomUUID(), state: 'succeeded' as const };
    },
    lookup: async () => null,
  };
  await repo.run(id, key, admin.id, fake); // an approver may execute, no third person required
  assert.equal(submitCount, 1);
  assert.equal((await repo.read(id)).operations[0].amountMinor, 3000);
  assert.equal((await service.read(buyer.id, caseId)).receipts[0].amountMinor, 3000);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int n FROM "Notification" WHERE "eventKey"=$1', [
        'refund:receipt:' + key,
      ])
    ).rows[0].n,
    1,
  );
  pass(
    'approved full amount without fee deduction; approver executes fake refund and durable receipt notice',
  );

  const reopenId = await fixture(),
    first = await open(reopenId);
  await vote(admin.id, first.id, 'REJECT');
  const rejectedView = await service.read(buyer.id, first.id);
  assert.equal(rejectedView.publicDecision?.reason, reason);
  assert.equal('reviewerId' in (rejectedView.publicDecision ?? {}), false);
  await assert.rejects(open(reopenId), /REOPEN_REQUIRED/);
  const again = await service.request(buyer.id, {
    captureId: reopenId,
    requestId: randomUUID(),
    reason,
    previousCaseId: first.id,
    reviewBasis: 'EQUIVALENT',
  });
  await assert.rejects(
    action(admin.id, again.id, 'CONFIRM_EVIDENCE'),
    /DIFFERENT_REVIEWER_REQUIRED/,
  );
  await assert.rejects(vote(admin.id, again.id, 'REJECT'), /DIFFERENT_REVIEWER_REQUIRED/);
  await vote(second.id, again.id, 'REJECT');
  await assert.rejects(
    service.request(buyer.id, {
      captureId: reopenId,
      requestId: randomUUID(),
      reason,
      previousCaseId: again.id,
      reviewBasis: 'EQUIVALENT',
    }),
    /REVIEW_LIMIT/,
  );
  const fresh = await service.request(buyer.id, {
    captureId: reopenId,
    requestId: randomUUID(),
    reason: reason + ' new reference',
    previousCaseId: again.id,
    reviewBasis: 'NEW_EVIDENCE',
  });
  assert.equal(fresh.status, 'REQUESTED');
  pass('one same-evidence re-review, different reviewer, and significant-new-evidence route');

  const blockedId = await fixture(),
    blockedCase = await open(blockedId);
  const siblingId = await fixture(),
    sibling = await open(siblingId);
  await action(admin.id, sibling.id, 'CONFIRM_EVIDENCE');
  await action(admin.id, blockedCase.id, 'ACCOUNT_CONFLICT');
  await assert.rejects(vote(admin.id, sibling.id), /REVIEW_REQUIRED/);
  const block = (await service.read(admin.id, sibling.id)).blocks![0];
  assert.ok(
    (await refundReconciliation(pool, admin.id, 1)).rows
      .find((r) => r.id === siblingId)
      ?.codes.includes('REVIEW'),
  );
  await assert.rejects(
    action(admin.id, sibling.id, 'RESOLVE_BLOCK', { blockId: block.id }),
    /DIFFERENT_REVIEWER_REQUIRED/,
  );
  await action(second.id, sibling.id, 'RESOLVE_BLOCK', { blockId: block.id });
  await vote(admin.id, sibling.id);
  const approved = await vote(second.id, sibling.id);
  const blockedKey = randomUUID();
  await repo.queue(siblingId, {
    key: blockedKey,
    caseId: sibling.id,
    decisionVersion: approved.version,
    expectedVersion: 0,
    amountMinor: 3000,
  });
  await action(admin.id, sibling.id, 'CHARGEBACK');
  await assert.rejects(repo.run(siblingId, blockedKey, admin.id, fake), /REVIEW_REQUIRED/);
  assert.equal(submitCount, 1);
  assert.equal((await repo.read(siblingId)).operations[0].status, 'QUEUED');
  const chargeback = (await service.read(second.id, sibling.id)).blocks![0];
  await action(second.id, sibling.id, 'RESOLVE_BLOCK', { blockId: chargeback.id });
  await repo.run(siblingId, blockedKey, admin.id, fake);
  assert.equal(submitCount, 2);
  assert.equal((await repo.read(siblingId)).operations[0].status, 'SUCCEEDED');
  assert.ok(
    !(await refundReconciliation(pool, admin.id, 1)).rows
      .find((r) => r.id === siblingId)
      ?.codes.includes('DECISION'),
  );
  pass(
    'account-wide blocking in review/report, second-admin resolution and chargeback stops queued submission',
  );

  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  const handlers = refundHandlers(
    service,
    async () => buyer.id,
    async () => {},
  );
  const row = await service.read(buyer.id, fresh.id);
  const response = await handlers.POST(
    new Request('http://localhost:3000/api/refunds', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CONFIRM_EVIDENCE',
        caseId: fresh.id,
        expectedVersion: row.version,
        requestId: randomUUID(),
        reason,
      }),
    }),
  );
  assert.equal(response.status, 403);
  const adminHandlers = refundHandlers(
    service,
    async () => admin.id,
    async () => {},
  );
  const resp = await adminHandlers.POST(
    new Request('http://localhost:3000/api/refunds', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'REQUEST_INFORMATION',
        caseId: fresh.id,
        expectedVersion: row.version,
        requestId: randomUUID(),
        reason,
      }),
    }),
  );
  assert.equal(resp.status, 200);
  await assert.rejects(pool.query('DELETE FROM "RefundCaseActivity"'), /REFUND_APPEND_ONLY/);
  await assert.rejects(
    pool.query('DELETE FROM "RefundOperationalBlock"'),
    /immutable block history/,
  );
  assert.equal(approvedRefundPolicy.requiredApprovals, 2);
  pass('new HTTP actions use session authority; activity and resolved block history are immutable');
  console.log('PASS ' + groups + ' changed policy groups; no real API calls.');
} finally {
  await db.$disconnect();
  await pool.end();
  if (created) {
    assert.match(name, /^autoveri_l11_policy_[a-f0-9]{32}_test$/);
    await control.query('DROP DATABASE "' + name + '" WITH (FORCE)');
  }
  await control.end();
}
