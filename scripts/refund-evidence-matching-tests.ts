import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { createDatabaseClient } from '../src/lib/database-client';
import { SyntheticEvidenceMatcher } from '../src/lib/refund-evidence-matching';
import { RefundRepository } from '../src/lib/refund-repository';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = 'autoveri_l11_match_' + randomUUID().replaceAll('-', '') + '_test',
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
const control = new Pool({ connectionString: maintenance.toString() }),
  pool = new Pool({ connectionString: target.toString() }),
  db = createDatabaseClient(target.toString()),
  matcher = new SyntheticEvidenceMatcher(pool),
  repo = new RefundRepository(pool);
const fixture = () => JSON.parse(readFileSync('tests/fixtures/l11-external-evidence.json', 'utf8'));
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
  const user = (role: 'ADMIN' | 'PRIVATE_USER') =>
    db.user.create({
      data: {
        role,
        email: randomUUID() + '@test.invalid',
        phone: randomUUID(),
        passwordHash: 'fixture',
      },
    });
  const [admin, reader, buyer, seller] = await Promise.all([
    user('ADMIN'),
    user('ADMIN'),
    user('PRIVATE_USER'),
    user('PRIVATE_USER'),
  ]);
  await pool.query('INSERT INTO "RefundRuntimePolicy" (id,policy,actors) VALUES ($1,$2,$3)', [
    'active',
    '{}',
    JSON.stringify([
      { id: admin.id, active: true, capabilities: ['payment.evidence.import'] },
      { id: reader.id, active: true, capabilities: ['payment.reconcile'] },
    ]),
  ]);
  const v = await db.vehicle.create({
    data: {
      userId: seller.id,
      stammnummer: randomUUID(),
      vinChassis: randomUUID(),
      make: 'LOCAL',
      model: 'MATCH TEST',
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
  const hold = await db.paymentHold.create({
    data: {
      userId: buyer.id,
      vehicleId: v.id,
      gateway: 'synthetic-provider',
      gatewayTransactionId: 'local-capture',
      status: 'CAPTURED_FEE',
      expiresAt: new Date(),
    },
  });
  const c = {
    scope: {
      provider: 'synthetic-provider',
      merchant: 'synthetic-merchant',
      environment: 'test' as const,
    },
    captureRef: 'local-capture',
    currency: 'CHF' as const,
    amountMinor: 3000,
    confirmed: true,
    participantIds: [buyer.id, seller.id],
    version: 0,
    blocked: false,
    operations: [],
    evidence: [],
    findings: [],
  };
  await repo.register('capture', c);
  await pool.query('INSERT INTO "RefundCaptureBinding" ("captureId","holdId") VALUES ($1,$2)', [
    'capture',
    hold.id,
  ]);
  const withRefund = {
    ...c,
    operations: [
      {
        key: 'refund-command',
        caseId: 'fixture',
        decisionVersion: 1,
        policyVersion: 'fixture',
        amountMinor: 3000,
        status: 'SUCCEEDED',
        refundRef: 'local-refund',
      },
    ],
  };
  await pool.query('UPDATE "RefundCaptureState" SET snapshot=$1 WHERE id=$2', [
    JSON.stringify(withRefund),
    'capture',
  ]);
  await pool.query(
    'INSERT INTO "RefundCommandState" (key,"captureId","caseId","decisionVersion") VALUES ($1,$2,$3,1)',
    ['refund-command', 'capture', 'fixture'],
  );
  await pool.query(
    'INSERT INTO "RefundReceipt" ("scopeKey","refundRef","captureId","commandKey","amountMinor",currency) VALUES ($1,$2,$3,$4,3000,$5)',
    [
      JSON.stringify(['synthetic-provider', 'synthetic-merchant', 'test']),
      'local-refund',
      'capture',
      'refund-command',
      'CHF',
    ],
  );
  const staged = await matcher.ingest(admin.id, randomUUID(), JSON.stringify(fixture()));
  const report = await matcher.report(reader.id, staged.id);
  assert.equal(report.matched, 0);
  assert.equal(report.unresolved, 2);
  const capture = report.rows.find((r) => r.kind === 'CAPTURE')!,
    refund = report.rows.find((r) => r.kind === 'REFUND')!;
  const command = {
    importId: staged.id,
    eventId: capture.eventId,
    targetKind: 'CAPTURE',
    targetId: 'capture',
    reason: 'Explicit synthetic account and reference mapping for this test',
  };
  await assert.rejects(matcher.map(reader.id, command), /FORBIDDEN/);
  await assert.rejects(matcher.report(buyer.id, staged.id), /FORBIDDEN/);
  await assert.rejects(matcher.map(admin.id, { ...command, reason: 'short' }));
  pass('no amount/date auto-match; explicit permission and reason required');
  await assert.rejects(matcher.map(admin.id, { ...command, targetId: 'missing' }), /LOCAL_MISSING/);
  const before = (
    await pool.query('SELECT snapshot FROM "RefundCaptureState" WHERE id=$1', ['capture'])
  ).rows[0].snapshot;
  await Promise.all([matcher.map(admin.id, command), matcher.map(admin.id, command)]);
  await matcher.map(admin.id, {
    ...command,
    eventId: refund.eventId,
    targetKind: 'REFUND',
    targetId: 'refund-command',
  });
  const matched = await new SyntheticEvidenceMatcher(pool).report(reader.id, staged.id);
  assert.equal(matched.matched, 2);
  assert.equal(matched.authentic, false);
  assert.equal(matched.coverage, 'IMPORTED_EVENTS_ONLY');
  assert.equal(
    (await pool.query('SELECT count(*)::int n FROM "SyntheticEvidenceMapping"')).rows[0].n,
    2,
  );
  pass('capture and receipt matching persist once and survive new service instance');
  await assert.rejects(
    matcher.map(admin.id, { ...command, reason: command.reason + ' changed' }),
    /CONFLICT/,
  );
  await pool.query('UPDATE "RefundCaptureState" SET snapshot=$1 WHERE id=$2', [
    JSON.stringify({ ...withRefund, amountMinor: 3100 }),
    'capture',
  ]);
  assert.equal(
    (await matcher.report(reader.id, staged.id)).rows.find((r) => r.kind === 'CAPTURE')!.code,
    'AMOUNT_MISMATCH',
  );
  await pool.query('UPDATE "RefundCaptureState" SET snapshot=$1 WHERE id=$2', [
    JSON.stringify({ ...withRefund, scope: { ...c.scope, environment: 'live' } }),
    'capture',
  ]);
  assert.ok(
    (await matcher.report(reader.id, staged.id)).rows.every((r) => r.code === 'SCOPE_MISMATCH'),
  );
  await pool.query('UPDATE "RefundCaptureState" SET snapshot=$1 WHERE id=$2', [
    JSON.stringify(before),
    'capture',
  ]);
  pass('current local changes expose amount and environment conflicts without remapping');
  const partial = fixture();
  partial.pages.pop();
  const quarantined = await matcher.ingest(admin.id, randomUUID(), JSON.stringify(partial));
  await assert.rejects(matcher.report(reader.id, quarantined.id), /QUARANTINED/);
  pass('quarantine never matches');
  const other = fixture();
  other.manifest.scope.account = 'different-account';
  other.pages.forEach((p: any) => (p.scope.account = 'different-account'));
  const different = await matcher.ingest(admin.id, randomUUID(), JSON.stringify(other));
  const otherCapture = (await matcher.report(reader.id, different.id)).rows.find(
    (r) => r.kind === 'CAPTURE',
  )!;
  await assert.rejects(
    matcher.map(admin.id, { ...command, importId: different.id, eventId: otherCapture.eventId }),
    /CONFLICT/,
  );
  pass('second account cannot silently reuse an already mapped local target');
  const paymentBefore = (
    await pool.query(
      'SELECT (SELECT count(*) FROM "RefundReceipt") receipts,(SELECT count(*) FROM "RefundCommandState") commands',
    )
  ).rows[0];
  await matcher.report(reader.id, staged.id);
  assert.deepEqual(
    (await pool.query('SELECT snapshot FROM "RefundCaptureState" WHERE id=$1', ['capture'])).rows[0]
      .snapshot,
    before,
  );
  assert.deepEqual(
    (
      await pool.query(
        'SELECT (SELECT count(*) FROM "RefundReceipt") receipts,(SELECT count(*) FROM "RefundCommandState") commands',
      )
    ).rows[0],
    paymentBefore,
  );
  await assert.rejects(pool.query('DELETE FROM "SyntheticEvidenceMapping"'), /REFUND_APPEND_ONLY/);
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: new Date() } });
  await assert.rejects(matcher.map(admin.id, command), /FORBIDDEN/);
  pass('immutable mapping, current authorization and no payment corrections');
  console.log(`PASS ${groups} new matching groups; zero real API calls.`);
} finally {
  await db.$disconnect();
  await pool.end();
  if (created) {
    assert.match(name, /^autoveri_l11_match_[a-f0-9]{32}_test$/);
    await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.end();
}
