import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { createDatabaseClient } from '../src/lib/database-client';
import { RefundRepository } from '../src/lib/refund-repository';
import { refundReconciliation } from '../src/lib/refund-reconciliation';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = 'autoveri_l11_report_' + randomUUID().replaceAll('-', '') + '_test',
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
const control = new Pool({ connectionString: maintenance.toString() }),
  pool = new Pool({ connectionString: target.toString() }),
  db = createDatabaseClient(target.toString()),
  repo = new RefundRepository(pool);
let created = false;
try {
  await control.query(`CREATE DATABASE "${name}"`);
  created = true;
  const result = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: target.toString() }, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const user = (role: 'ADMIN' | 'PRIVATE_USER') =>
    db.user.create({
      data: {
        role,
        email: randomUUID() + '@test.invalid',
        phone: randomUUID(),
        passwordHash: 'fixture',
      },
    });
  const [admin, reviewer, buyer] = await Promise.all([
    user('ADMIN'),
    user('ADMIN'),
    user('PRIVATE_USER'),
  ]);
  await pool.query('INSERT INTO "RefundRuntimePolicy" (id,policy,actors) VALUES ($1,$2,$3)', [
    'active',
    JSON.stringify({}),
    JSON.stringify([
      { id: admin.id, active: true, capabilities: ['payment.reconcile'] },
      { id: reviewer.id, active: true, capabilities: ['refund.review'] },
      { id: buyer.id, active: true, capabilities: ['payment.reconcile'] },
    ]),
  ]);
  for (let i = 0; i < 22; i++)
    await repo.register(String(i).padStart(2, '0'), {
      scope: { provider: 'fake', merchant: 'test', environment: i === 0 ? 'live' : 'test' },
      captureRef: 'ref-' + i,
      currency: 'CHF',
      amountMinor: 3000,
      confirmed: true,
      participantIds: [],
      version: 0,
      blocked: false,
      operations: [],
      evidence: [],
      findings: [],
    });
  // Deliberately incomplete trusted fixture: no external provider calls, missing bindings expected.
  await pool.query(
    'UPDATE "RefundCaptureState" SET snapshot=jsonb_set(snapshot,\'{operations}\',$1::jsonb) WHERE id=$2',
    [
      JSON.stringify([
        {
          key: 'missing-command',
          caseId: 'missing-case',
          decisionVersion: 1,
          policyVersion: 'test',
          amountMinor: 3000,
          status: 'SUCCEEDED',
          refundRef: 'missing-receipt',
        },
      ]),
      '00',
    ],
  );
  await pool.query('UPDATE "RefundCaptureState" SET snapshot=$1 WHERE id=$2', [
    JSON.stringify({ version: 0 }),
    '21',
  ]);
  const counts = async () =>
    (
      await pool.query(
        `SELECT (SELECT count(*) FROM "RefundCaptureState") AS captures,(SELECT count(*) FROM "RefundStateEvent") AS events,(SELECT count(*) FROM "RefundReceipt") AS receipts,(SELECT count(*) FROM "RefundCommandState") AS commands`,
      )
    ).rows[0];
  const before = await counts();
  await assert.rejects(refundReconciliation(pool, reviewer.id, 1), /FORBIDDEN/);
  await assert.rejects(refundReconciliation(pool, buyer.id, 1), /FORBIDDEN/);
  const first = await refundReconciliation(pool, admin.id, 1);
  assert.equal(first.rows.length, 20);
  assert.equal(first.more, true);
  assert.equal(first.totals.live.captured, '3000');
  assert.equal(first.totals.test.captured, '57000');
  for (const code of ['BINDING', 'COMMAND_MISSING', 'DECISION', 'RECEIPT_MISSING', 'AUDIT'])
    assert.ok(first.rows[0].codes.includes(code as any));
  const second = await refundReconciliation(pool, admin.id, 2);
  assert.equal(second.rows.length, 2);
  assert.equal(second.more, false);
  assert.equal(second.incomplete, true);
  assert.equal(second.totals.test.captured, '3000');
  assert.equal(JSON.stringify(first).includes('missing-receipt'), false);
  assert.deepEqual(await counts(), before);
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: new Date() } });
  await assert.rejects(refundReconciliation(pool, admin.id, 1), /FORBIDDEN/);
  console.log(
    'PASS new reconciliation DB: explicit capability/current role, pagination, environment totals, missing/conflicting/invalid records, private DTO, unchanged tables, suspension. No provider calls.',
  );
} finally {
  await db.$disconnect();
  await pool.end();
  if (created) {
    assert.match(name, /^autoveri_l11_report_[a-f0-9]{32}_test$/);
    await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.end();
}
