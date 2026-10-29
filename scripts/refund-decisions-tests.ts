import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { createDatabaseClient } from '../src/lib/database-client';
import { RefundRepository } from '../src/lib/refund-repository';
import { RefundDecisions } from '../src/lib/refund-decisions';
import type { RefundCapture } from '../src/lib/refund-domain';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = 'autoveri_l11_decisions_' + randomUUID().replaceAll('-', '') + '_test',
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
    requiredApprovals: 2,
    separateExecutor: true,
  };
  await pool.query('INSERT INTO "RefundRuntimePolicy" (id,policy,actors) VALUES ($1,$2,$3)', [
    'active',
    JSON.stringify(policy),
    JSON.stringify(
      grantIds.map((id) => ({
        id,
        active: true,
        capabilities: ['refund.review', 'refund.execute'],
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
  const id = await fixture(),
    request = { captureId: id, requestId: randomUUID(), reason };
  await assert.rejects(service.request(other.id, request), /FORBIDDEN/);
  await assert.rejects(service.request(seller.id, request), /FORBIDDEN/);
  await assert.rejects(service.request(buyer.id, { ...request, requesterId: other.id }));
  const opened = await service.request(buyer.id, request);
  assert.equal((await service.request(buyer.id, request)).id, opened.id);
  await assert.rejects(
    service.request(buyer.id, { ...request, reason: reason + ' changed' }),
    /CONFLICT/,
  );
  pass('DB payer ownership, strict input and request replay');
  const decision = {
    caseId: opened.id,
    requestId: randomUUID(),
    expectedVersion: 0,
    outcome: 'APPROVE',
    reason,
  };
  await assert.rejects(service.decide(other.id, decision), /FORBIDDEN/);
  await assert.rejects(service.decide(seller.id, decision), /FORBIDDEN/);
  await assert.rejects(service.decide(admin.id, { ...decision, reason: 'short' }));
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: new Date() } });
  await assert.rejects(service.decide(admin.id, decision), /FORBIDDEN/);
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: null } });
  pass('current role, suspension, party conflict and mandatory reason');
  await assert.rejects(
    repo.queue(id, {
      key: randomUUID(),
      caseId: opened.id,
      decisionVersion: 0,
      expectedVersion: 0,
      amountMinor: 3000,
    }),
    /DECISION_REQUIRED/,
  );
  await pool.query('UPDATE "RefundCase" SET "evidenceReadyAt"=clock_timestamp() WHERE id=$1', [
    opened.id,
  ]);
  const one = await service.decide(admin.id, decision);
  assert.equal(one.status, 'IN_REVIEW');
  assert.equal((await service.decide(admin.id, decision)).version, 1);
  await assert.rejects(
    service.decide(admin.id, { ...decision, reason: reason + ' changed' }),
    /CONFLICT/,
  );
  const two = await service.decide(second.id, {
    ...decision,
    requestId: randomUUID(),
    expectedVersion: 1,
  });
  assert.equal(two.status, 'APPROVED');
  const command = {
    key: randomUUID(),
    caseId: opened.id,
    decisionVersion: two.version,
    expectedVersion: 0,
    amountMinor: 3000,
  };
  await repo.queue(id, command);
  assert.deepEqual(
    [...(await repo.read(id)).operations[0].approvalIds].sort(),
    [admin.id, second.id].sort(),
  );
  pass('durable independent votes, no caller-supplied approval authority');
  await db.user.update({ where: { id: admin.id }, data: { role: 'PRIVATE_USER' } });
  await assert.rejects(repo.claim(id, command.key, executor.id), /FORBIDDEN/);
  await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  const claimed = await repo.claim(id, command.key, executor.id);
  assert.ok(claimed);
  pass('dispatch reloads real approver role');
  const publicView = await service.read(buyer.id, opened.id);
  assert.equal('decisions' in publicView, false);
  await assert.rejects(service.read(other.id, opened.id), /FORBIDDEN/);
  assert.equal(((await service.read(admin.id, opened.id)) as any).decisions.length, 2);
  pass('buyer view excludes internal decision history; outsider denied');
  const id2 = await fixture(),
    opened2 = await service.request(buyer.id, { captureId: id2, requestId: randomUUID(), reason });
  await pool.query('UPDATE "RefundCase" SET "evidenceReadyAt"=clock_timestamp() WHERE id=$1', [
    opened2.id,
  ]);
  const racing = await Promise.allSettled([
    service.decide(admin.id, { ...decision, caseId: opened2.id, requestId: randomUUID() }),
    service.decide(second.id, {
      ...decision,
      caseId: opened2.id,
      requestId: randomUUID(),
      outcome: 'REJECT',
    }),
  ]);
  assert.equal(racing.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int n FROM "RefundDecision" WHERE "caseId"=$1', [
        opened2.id,
      ])
    ).rows[0].n,
    1,
  );
  pass('opposing decisions serialize on capture and case version');
  const id3 = await fixture(),
    opened3 = await service.request(buyer.id, { captureId: id3, requestId: randomUUID(), reason });
  await pool.query('UPDATE "RefundRuntimePolicy" SET policy=$1 WHERE id=$2', [
    JSON.stringify({ ...policy, requiredApprovals: null }),
    'active',
  ]);
  assert.equal((await service.list(admin.id, true, 1)).policyReady, true);
  assert.equal((await service.read(buyer.id, opened3.id)).version, 0);
  await pool.query('UPDATE "RefundRuntimePolicy" SET policy=$1 WHERE id=$2', [
    JSON.stringify(policy),
    'active',
  ]);
  pass('legacy policy fields cannot override the owner-approved policy');
  const rejectedCapture = await fixture();
  const rejectedCase = await service.request(buyer.id, {
    captureId: rejectedCapture,
    requestId: randomUUID(),
    reason,
  });
  const rejected = await service.decide(admin.id, {
    ...decision,
    caseId: rejectedCase.id,
    requestId: randomUUID(),
    outcome: 'REJECT',
  });
  await assert.rejects(
    repo.queue(rejectedCapture, {
      key: randomUUID(),
      caseId: rejectedCase.id,
      decisionVersion: rejected.version,
      expectedVersion: 0,
      amountMinor: 3000,
    }),
    /DECISION_REQUIRED/,
  );
  await db.user.update({ where: { id: admin.id }, data: { isSample: true } });
  await assert.rejects(
    service.decide(admin.id, { ...decision, caseId: opened3.id, requestId: randomUUID() }),
    /FORBIDDEN/,
  );
  await db.user.update({ where: { id: admin.id }, data: { isSample: false } });
  await pool.query('UPDATE "RefundRuntimePolicy" SET actors=$1 WHERE id=$2', [
    JSON.stringify(
      grantIds
        .filter((id) => id !== admin.id)
        .map((id) => ({ id, active: true, capabilities: ['refund.review', 'refund.execute'] })),
    ),
    'active',
  ]);
  await assert.rejects(
    service.decide(admin.id, { ...decision, caseId: opened3.id, requestId: randomUUID() }),
    /FORBIDDEN/,
  );
  await pool.query('UPDATE "RefundRuntimePolicy" SET actors=$1 WHERE id=$2', [
    JSON.stringify(
      grantIds.map((id) => ({
        id,
        active: true,
        capabilities: ['refund.review', 'refund.execute'],
      })),
    ),
    'active',
  ]);
  const mismatch = await fixture();
  await pool.query(
    'UPDATE "PaymentHold" SET status=$1 WHERE id=(SELECT "holdId" FROM "RefundCaptureBinding" WHERE "captureId"=$2)',
    ['RELEASED', mismatch],
  );
  await assert.rejects(
    service.request(buyer.id, { captureId: mismatch, requestId: randomUUID(), reason }),
    /CAPTURE_BINDING_REQUIRED/,
  );
  pass('rejection, sample account, missing capability and invalid capture block execution');
  await pool.query('UPDATE "RefundCase" SET "evidenceReadyAt"=clock_timestamp() WHERE id=$1', [
    opened3.id,
  ]);
  await pool.query(
    `CREATE FUNCTION fail_refund_case() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_CASE_FAILURE'; END; $$; CREATE TRIGGER fail_refund_case BEFORE UPDATE ON "RefundCase" FOR EACH ROW EXECUTE FUNCTION fail_refund_case();`,
  );
  await assert.rejects(
    service.decide(admin.id, { ...decision, caseId: opened3.id, requestId: randomUUID() }),
    /INJECTED_CASE_FAILURE/,
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int n FROM "RefundDecision" WHERE "caseId"=$1', [
        opened3.id,
      ])
    ).rows[0].n,
    0,
  );
  await assert.rejects(pool.query('DELETE FROM "RefundDecision"'), /REFUND_APPEND_ONLY/);
  pass('decision and case rollback together; rationale immutable');
  console.log(`PASS ${groups} new decision/auth groups; provider calls 0.`);
} finally {
  await db.$disconnect();
  await pool.end();
  if (created) {
    assert.match(name, /^autoveri_l11_decisions_[a-f0-9]{32}_test$/);
    await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.end();
}
