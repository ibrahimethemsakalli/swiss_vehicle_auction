import 'dotenv/config';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { RefundRepository } from '../src/lib/refund-repository';
import type { RefundEvidence, RefundProvider } from '../src/lib/refund-domain';

const url = new URL(process.env.DATABASE_URL ?? '');
assert.ok(process.env.NODE_ENV !== 'production');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/autoveri');
assert.equal(process.env.LOCAL_TEST_PAYMENTS, 'true');
assert.ok(!process.env.STRIPE_SECRET_KEY);
globalThis.fetch = async () => {
  throw Error('REAL_NETWORK_FORBIDDEN');
};
const demo = JSON.parse(readFileSync('.local/l11-demo.json', 'utf8'));
assert.equal(demo.synthetic, true);
assert.equal(demo.caseId, '084fb584-cf70-4d07-a3d9-aa07bf130ae1');
const key = 'l11-local-refund:' + demo.caseId;
const providerFile = '.local/l11-demo-refund-provider.json';
const pool = new Pool({ connectionString: url.toString() });
const guard = await pool.connect();
const repo = new RefundRepository(pool);
let submits = 0,
  lookups = 0;
try {
  await guard.query("SELECT pg_advisory_lock(hashtextextended('l11-demo-refund-run',0))");
  const row = (await guard.query('SELECT * FROM "RefundCase" WHERE id=$1', [demo.caseId])).rows[0];
  assert.equal(row.status, 'APPROVED');
  assert.equal(row.captureId, demo.captureId);
  assert.equal(row.amountMinor, 3000);
  const capture = await repo.read(demo.captureId);
  assert.equal(capture.scope.provider, 'fake');
  assert.equal(capture.scope.environment, 'test');
  assert.equal(capture.scope.merchant, 'LOCAL-L11-DEMO-NOT-A-MERCHANT');
  assert.equal(capture.captureRef, demo.captureRef);
  assert.equal(capture.amountMinor, 3000);
  assert.equal(capture.currency, 'CHF');
  assert.equal(capture.blocked, false);
  assert.equal(capture.findings.length, 0);
  assert.ok(capture.operations.every((o) => o.key === key && o.caseId === demo.caseId));
  const binding = (
    await guard.query(
      'SELECT h.id,h.gateway,h."userId",h.status,h.amount FROM "RefundCaptureBinding" b JOIN "PaymentHold" h ON h.id=b."holdId" WHERE b."captureId"=$1',
      [demo.captureId],
    )
  ).rows[0];
  assert.equal(binding.id, demo.holdId);
  assert.equal(binding.gateway, 'fake');
  assert.equal(binding.userId, demo.buyerId);
  assert.equal(binding.status, 'CAPTURED_FEE');
  assert.equal(Number(binding.amount), 30);
  const expected: RefundEvidence = {
    scope: capture.scope,
    captureRef: capture.captureRef,
    currency: 'CHF',
    amountMinor: 3000,
    key,
    eventId: 'local-demo-event:' + demo.caseId,
    refundRef: 'local-demo-refund:' + demo.caseId,
    state: 'succeeded',
  };
  function saved(): RefundEvidence | null {
    if (!existsSync(providerFile)) return null;
    const record = JSON.parse(readFileSync(providerFile, 'utf8'));
    assert.equal(record.synthetic, true);
    assert.equal(record.economicRefundCount, 1);
    assert.deepEqual(record.evidence, expected);
    return record.evidence;
  }
  const fake: RefundProvider = {
    submit: async (command) => {
      submits++;
      assert.deepEqual(command, {
        scope: capture.scope,
        captureRef: capture.captureRef,
        currency: 'CHF',
        amountMinor: 3000,
        key,
      });
      if (!saved())
        writeFileSync(
          providerFile,
          JSON.stringify(
            {
              synthetic: true,
              economicRefundCount: 1,
              evidence: expected,
              createdAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          { flag: 'wx', mode: 0o600 },
        );
      return saved()!;
    },
    lookup: async (scope, lookupKey) => {
      lookups++;
      assert.deepEqual(scope, capture.scope);
      assert.equal(lookupKey, key);
      return saved();
    },
  };
  if (!capture.operations.length)
    await repo.queue(demo.captureId, {
      key,
      caseId: demo.caseId,
      decisionVersion: row.approvedVersion,
      expectedVersion: capture.version,
      amountMinor: 3000,
    });
  const executed = await repo.run(demo.captureId, key, demo.adminIds[1], fake);
  const callsAfterFirst = { submits, lookups };
  const repeated = await repo.run(demo.captureId, key, demo.adminIds[1], fake);
  assert.equal(repeated, false);
  assert.deepEqual({ submits, lookups }, callsAfterFirst);
  assert.ok(saved());
  const after = await repo.read(demo.captureId);
  assert.equal(after.operations.length, 1);
  assert.equal(after.operations[0].status, 'SUCCEEDED');
  assert.equal(after.operations[0].amountMinor, 3000);
  const receipt = (
    await guard.query(
      'SELECT "commandKey","amountMinor",currency FROM "RefundReceipt" WHERE "captureId"=$1',
      [demo.captureId],
    )
  ).rows;
  assert.equal(receipt.length, 1);
  assert.equal(receipt[0].commandKey, key);
  assert.equal(receipt[0].amountMinor, 3000);
  const notices = (
    await guard.query(
      'SELECT count(*)::int n FROM "Notification" WHERE "eventKey"=$1 AND "userId"=$2',
      ['refund:receipt:' + key, demo.buyerId],
    )
  ).rows[0].n;
  assert.equal(notices, 1);
  const result = {
    at: new Date().toISOString(),
    caseId: demo.caseId,
    captureId: demo.captureId,
    key,
    synthetic: true,
    status: 'SUCCEEDED',
    amountMinor: 3000,
    currency: 'CHF',
    executed,
    repeated,
    submits,
    lookups,
    economicRefundCount: 1,
    receipts: 1,
    notifications: 1,
    realApiCalls: 0,
  };
  writeFileSync('.local/l11-demo-refund-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await guard.query("SELECT pg_advisory_unlock(hashtextextended('l11-demo-refund-run',0))");
  guard.release();
  await pool.end();
}
