import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { approvedRefundPolicy } from '../src/lib/refund-policy';
import { RefundRepository } from '../src/lib/refund-repository';
import {
  refundTotals,
  type RefundCapture,
  type RefundProvider,
  type RefundEvidence,
} from '../src/lib/refund-domain';

// Only this newly created loopback DB is written/dropped. No application imports or real ports.
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = 'autoveri_l11_' + randomUUID().replaceAll('-', '') + '_test';
const maintenance = new URL(source),
  target = new URL(source);
maintenance.pathname = '/postgres';
target.pathname = '/' + name;
const control = new Pool({ connectionString: maintenance.toString() }),
  pool = new Pool({ connectionString: target.toString(), max: 12 });
const repo = new RefundRepository(pool);
const fixtureDb = createDatabaseClient(target.toString());
// Historical repository tests now need real relational fixtures, not caller-supplied grants.
const register = repo.register.bind(repo),
  queue = repo.queue.bind(repo);
repo.register = async (id, c) => {
  const vehicle = await fixtureDb.vehicle.create({
    data: {
      userId: 'seller',
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
  const hold = await fixtureDb.paymentHold.create({
    data: {
      userId: 'buyer',
      vehicleId: vehicle.id,
      gateway: 'fake',
      gatewayTransactionId: c.captureRef,
      status: 'CAPTURED_FEE',
      expiresAt: new Date(),
    },
  });
  await register(id, c);
  await pool.query('INSERT INTO "RefundCaptureBinding" ("captureId","holdId") VALUES ($1,$2)', [
    id,
    hold.id,
  ]);
};
repo.queue = async (id, input) => {
  const policyRow = await pool.query('SELECT policy FROM "RefundRuntimePolicy" WHERE id=$1', [
    'active',
  ]);
  if (policyRow.rowCount) {
    await pool.query(
      'INSERT INTO "RefundCase" (id,"captureId","requesterId","requestId",reason,status,version,"policyVersion","amountMinor",currency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,3000,\'CHF\') ON CONFLICT DO NOTHING',
      [
        input.caseId,
        id,
        'buyer',
        input.caseId,
        'TEST ONLY approved fixture reason',
        'APPROVED',
        input.decisionVersion,
        approvedRefundPolicy.version,
      ],
    );
    await pool.query('UPDATE "RefundCase" SET "evidenceReadyAt"=clock_timestamp() WHERE id=$1', [
      input.caseId,
    ]);
    for (const reviewer of ['r', 'r2'])
      await pool.query(
        'INSERT INTO "RefundDecision" (id,"caseId","reviewerId","requestId",outcome,reason,"expectedVersion","policyVersion") VALUES ($1,$2,$3,$4,$5,$6,0,$7) ON CONFLICT DO NOTHING',
        [
          randomUUID(),
          input.caseId,
          reviewer,
          input.caseId,
          'APPROVE',
          'TEST ONLY approved fixture reason',
          approvedRefundPolicy.version,
        ],
      );
  }
  return queue(id, input);
};
const policy = {
  version: 'TEST-ONLY',
  reviewRulesConfirmed: true,
  partialRefunds: false,
  requiredApprovals: 1,
  separateExecutor: true,
};
const actors = [
  { id: 'r', active: true, capabilities: ['refund.review'] },
  { id: 'r2', active: true, capabilities: ['refund.review'] },
  { id: 'e', active: true, capabilities: ['refund.execute'] },
];
const initial = (ref: string): RefundCapture => ({
  scope: { provider: 'fake', merchant: 'fixture', environment: 'test' },
  captureRef: ref,
  currency: 'CHF',
  amountMinor: 3000,
  confirmed: true,
  participantIds: ['buyer', 'seller'],
  version: 0,
  blocked: false,
  operations: [],
  evidence: [],
  findings: [],
});
const command = (key: string) => ({
  key,
  caseId: key,
  decisionVersion: 1,
  expectedVersion: 0,
  amountMinor: 3000,
  approvalIds: ['r'],
});
class Fake implements RefundProvider {
  submits = 0;
  lookups = 0;
  lost = false;
  unavailable = false;
  results = new Map<string, RefundEvidence>();
  async submit(c: Parameters<RefundProvider['submit']>[0]) {
    this.submits++;
    const e: RefundEvidence = {
      ...c,
      eventId: 'event-' + c.key,
      refundRef: 'refund-' + c.key,
      state: 'succeeded',
    };
    this.results.set(c.key, e);
    if (this.lost) throw Error('lost reply');
    return e;
  }
  async lookup(_scope: RefundCapture['scope'], key: string) {
    this.lookups++;
    if (this.unavailable) throw Error('offline');
    return this.results.get(key) ?? null;
  }
}
let created = false,
  passed = 0;
const pass = (name: string) => {
  passed++;
  console.log('PASS ' + name);
};
try {
  await control.query(`CREATE DATABASE "${name}"`);
  created = true;
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: target.toString() }, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migrated.status, 0, migrated.stderr);
  for (const id of ['buyer', 'seller', 'r', 'r2', 'e'])
    await fixtureDb.user.create({
      data: {
        id,
        email: id + '@test.invalid',
        phone: id,
        passwordHash: 'fixture',
        role: ['r', 'r2', 'e'].includes(id) ? 'ADMIN' : 'PRIVATE_USER',
      },
    });
  await repo.register('no-policy', initial('no-policy'));
  await assert.rejects(repo.queue('no-policy', command('no-policy')), /POLICY_UNCONFIGURED/);
  assert.equal((await repo.read('no-policy')).version, 0);
  pass('missing policy rolls back');
  await pool.query('INSERT INTO "RefundRuntimePolicy" (id,policy,actors) VALUES ($1,$2,$3)', [
    'active',
    JSON.stringify(policy),
    JSON.stringify(actors),
  ]);
  await repo.register('race', initial('race'));
  const race = await Promise.allSettled([
    repo.queue('race', command('a')),
    repo.queue('race', command('b')),
  ]);
  assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(refundTotals(await repo.read('race')).reserved, 3000);
  pass('capture row lock prevents competing reservations');
  await repo.register('same', initial('same'));
  await Promise.all(Array.from({ length: 8 }, () => repo.queue('same', command('same'))));
  assert.equal((await repo.read('same')).operations.length, 1);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM "RefundCommandState" WHERE key=$1', ['same']))
      .rows[0].n,
    1,
  );
  pass('same-key concurrent requests persist once');
  const fake = new Fake();
  await Promise.all(Array.from({ length: 8 }, () => repo.run('same', 'same', 'e', fake)));
  assert.equal(fake.submits, 1);
  assert.equal((await repo.read('same')).operations[0].status, 'SUCCEEDED');
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM "RefundReceipt" WHERE "commandKey"=$1', [
        'same',
      ])
    ).rows[0].n,
    1,
  );
  pass('worker lease produces one call and receipt');
  await repo.register('rollback', initial('rollback'));
  await pool.query(
    `CREATE FUNCTION fail_refund_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."captureId"='rollback' AND NEW.kind='QUEUE' THEN RAISE EXCEPTION 'INJECTED'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_refund_event BEFORE INSERT ON "RefundStateEvent" FOR EACH ROW EXECUTE FUNCTION fail_refund_event();`,
  );
  await assert.rejects(repo.queue('rollback', command('rollback')), /INJECTED/);
  assert.equal((await repo.read('rollback')).operations.length, 0);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM "RefundCommandState" WHERE key=$1', [
        'rollback',
      ])
    ).rows[0].n,
    0,
  );
  pass('last-write failure rolls back snapshot and command');
  await repo.register('lost', initial('lost'));
  await repo.queue('lost', command('lost'));
  const lost = new Fake();
  lost.lost = true;
  await repo.run('lost', 'lost', 'e', lost);
  assert.equal((await repo.read('lost')).operations[0].status, 'UNKNOWN');
  const restarted = new RefundRepository(pool);
  await restarted.run('lost', 'lost', 'e', lost);
  assert.equal(lost.submits, 1);
  assert.equal(lost.lookups, 1);
  assert.equal((await repo.read('lost')).operations[0].status, 'SUCCEEDED');
  pass('lost response recovered by durable lookup only');
  await repo.register('crash', initial('crash'));
  await repo.queue('crash', command('crash'));
  const old = await repo.claim('crash', 'crash', 'e');
  assert.ok(old);
  const crash = new Fake();
  const e = await crash.submit({
    scope: old.capture.scope,
    captureRef: 'crash',
    currency: 'CHF',
    amountMinor: 3000,
    key: 'crash',
  });
  // Simulate process death after provider success, before DB finish; expire only this test lease.
  await pool.query(
    'UPDATE "RefundCommandState" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE key=$1',
    ['crash'],
  );
  const newClaim = await restarted.claim('crash', 'crash', 'e');
  assert.ok(newClaim);
  assert.equal(newClaim.mode, 'lookup');
  assert.equal(await repo.finish(old, e), false);
  assert.equal(
    await restarted.finish(newClaim, await crash.lookup(old.capture.scope, 'crash')),
    true,
  );
  assert.equal(crash.submits, 1);
  assert.equal((await repo.read('crash')).operations[0].status, 'SUCCEEDED');
  pass('crash recovery fences late worker and retains success');
  await repo.register('before-send', initial('before-send'));
  await repo.queue('before-send', command('before-send'));
  await repo.claim('before-send', 'before-send', 'e');
  await pool.query(
    'UPDATE "RefundCommandState" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE key=$1',
    ['before-send'],
  );
  const empty = new Fake();
  await restarted.run('before-send', 'before-send', 'e', empty);
  assert.equal(empty.submits, 0);
  assert.equal(refundTotals(await repo.read('before-send')).reserved, 3000);
  pass('crash before send never blindly submits on recovery');
  await repo.register('finish-fail', initial('finish-fail'));
  await repo.queue('finish-fail', command('finish-fail'));
  await pool.query(
    `CREATE FUNCTION fail_refund_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."captureId"='finish-fail' AND NEW.kind='RESULT' THEN RAISE EXCEPTION 'RESULT_INJECTED'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_refund_result BEFORE INSERT ON "RefundStateEvent" FOR EACH ROW EXECUTE FUNCTION fail_refund_result();`,
  );
  const finishFake = new Fake();
  await assert.rejects(repo.run('finish-fail', 'finish-fail', 'e', finishFake), /RESULT_INJECTED/);
  assert.equal((await repo.read('finish-fail')).operations[0].status, 'SUBMITTING');
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM "RefundReceipt" WHERE "commandKey"=$1', [
        'finish-fail',
      ])
    ).rows[0].n,
    0,
  );
  await pool.query('DROP TRIGGER fail_refund_result ON "RefundStateEvent"');
  await pool.query(
    'UPDATE "RefundCommandState" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE key=$1',
    ['finish-fail'],
  );
  await restarted.run('finish-fail', 'finish-fail', 'e', finishFake);
  assert.equal(finishFake.submits, 1);
  assert.equal((await repo.read('finish-fail')).operations[0].status, 'SUCCEEDED');
  pass('result persistence failure rolls back receipt and recovers without new payment');
  await repo.register('revoked', initial('revoked'));
  await repo.queue('revoked', command('revoked'));
  await pool.query('UPDATE "RefundRuntimePolicy" SET actors=$1 WHERE id=$2', [
    JSON.stringify(actors.map((a) => ({ ...a, active: false }))),
    'active',
  ]);
  const forbidden = new Fake();
  await assert.rejects(repo.run('revoked', 'revoked', 'e', forbidden), /FORBIDDEN/);
  assert.equal(forbidden.submits, 0);
  assert.equal((await repo.read('revoked')).operations[0].status, 'QUEUED');
  pass('authority reloaded under transaction before dispatch');
  await assert.rejects(
    pool.query('UPDATE "RefundReceipt" SET "amountMinor"=1'),
    /REFUND_APPEND_ONLY/,
  );
  await assert.rejects(pool.query('DELETE FROM "RefundStateEvent"'), /REFUND_APPEND_ONLY/);
  pass('receipts and audit history reject mutation');
  console.log(`PASS L11 persistence: ${passed} new groups; real provider calls 0.`);
} finally {
  await fixtureDb.$disconnect();
  await pool.end();
  if (created) {
    assert.match(name, /^autoveri_l11_[a-f0-9]{32}_test$/);
    await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.end();
}
