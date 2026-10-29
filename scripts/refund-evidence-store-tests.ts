import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { createDatabaseClient } from '../src/lib/database-client';
import { SyntheticEvidenceStore } from '../src/lib/refund-evidence-store';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = 'autoveri_l11_import_' + randomUUID().replaceAll('-', '') + '_test',
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
const control = new Pool({ connectionString: maintenance.toString() }),
  pool = new Pool({ connectionString: target.toString() }),
  db = createDatabaseClient(target.toString()),
  store = new SyntheticEvidenceStore(pool);
const fixture = () => JSON.parse(readFileSync('tests/fixtures/l11-external-evidence.json', 'utf8'));
const text = (f: unknown) => JSON.stringify(f);
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
  const [admin, outsider, reviewer] = await Promise.all([
    user('ADMIN'),
    user('PRIVATE_USER'),
    user('ADMIN'),
  ]);
  await pool.query('INSERT INTO "RefundRuntimePolicy" (id,policy,actors) VALUES ($1,$2,$3)', [
    'active',
    '{}',
    JSON.stringify([
      { id: admin.id, active: true, capabilities: ['payment.evidence.import'] },
      { id: reviewer.id, active: true, capabilities: ['payment.reconcile'] },
      { id: outsider.id, active: true, capabilities: ['payment.evidence.import'] },
    ]),
  ]);
  const counts = async () =>
    (
      await pool.query(
        `SELECT (SELECT count(*) FROM "SyntheticEvidenceImport")::int imports,(SELECT count(*) FROM "SyntheticEvidenceAttempt")::int attempts,(SELECT count(*) FROM "SyntheticEvidenceEvent")::int events,(SELECT count(*) FROM "SyntheticEvidenceLink")::int links`,
      )
    ).rows[0];
  await assert.rejects(store.ingest(outsider.id, randomUUID(), text(fixture())), /FORBIDDEN/);
  await assert.rejects(store.ingest(reviewer.id, randomUUID(), text(fixture())), /FORBIDDEN/);
  const request = randomUUID();
  const race = await Promise.all(
    Array.from({ length: 6 }, () => store.ingest(admin.id, request, text(fixture()))),
  );
  assert.equal(new Set(race.map((r) => r.id)).size, 1);
  assert.deepEqual(await counts(), { imports: 1, attempts: 1, events: 2, links: 2 });
  assert.equal(
    (await new SyntheticEvidenceStore(pool).read(reviewer.id, race[0].id)).status,
    'STAGED_SYNTHETIC',
  );
  pass('persisted restart read, explicit role and idempotent concurrent request');
  const changed = fixture();
  changed.manifest.closingBalanceMinor = '999';
  await assert.rejects(store.ingest(admin.id, request, text(changed)), /CONFLICT/);
  const order = fixture();
  order.pages.reverse();
  const replay = await store.ingest(admin.id, randomUUID(), text(order));
  assert.equal(replay.id, race[0].id);
  assert.equal((await counts()).events, 2);
  pass('request content conflict and canonical batch dedup');
  const partial = fixture();
  partial.manifest.batchId = 'partial';
  partial.pages.forEach((p: any) => (p.batchId = 'partial'));
  partial.pages.pop();
  const pending = await store.ingest(admin.id, randomUUID(), text(partial));
  assert.equal(pending.status, 'QUARANTINED');
  assert.equal((await counts()).events, 2);
  const completed = fixture();
  completed.manifest.batchId = 'partial';
  completed.pages.forEach((p: any) => (p.batchId = 'partial'));
  const complete = await store.ingest(admin.id, randomUUID(), text(completed));
  assert.equal(complete.status, 'STAGED_SYNTHETIC');
  assert.notEqual(complete.id, pending.id);
  assert.equal((await store.read(admin.id, pending.id)).status, 'QUARANTINED');
  assert.equal((await counts()).events, 2);
  pass(
    'partial quarantine retained; completed revision links existing events without duplicate money records',
  );
  const conflict = fixture();
  conflict.pages[0].events[0].amountMinor = '3100';
  conflict.manifest.closingBalanceMinor = '200';
  const rejected = await store.ingest(admin.id, randomUUID(), text(conflict));
  assert.equal(rejected.status, 'QUARANTINED');
  assert.ok((rejected.summary.findings as string[]).includes('BATCH_CONFLICT'));
  assert.equal((await counts()).events, 2);
  pass('changed accepted batch quarantined atomically');
  const across = fixture();
  across.manifest.batchId = 'across';
  across.pages.forEach((p: any) => (p.batchId = 'across'));
  across.pages[0].events[0].eventId = 'different-event';
  const economic = await store.ingest(admin.id, randomUUID(), text(across));
  assert.equal(economic.status, 'QUARANTINED');
  assert.ok((economic.summary.findings as string[]).includes('STORED_ECONOMIC_CONFLICT'));
  pass('cross-batch economic duplicate quarantined');
  const bad = fixture();
  bad.pages[0].secret = 'SHOULD_NOT_BE_STORED';
  const invalid = await store.ingest(admin.id, randomUUID(), text(bad));
  assert.equal(invalid.status, 'QUARANTINED');
  const saved = (
    await pool.query('SELECT pages,summary FROM "SyntheticEvidenceImport" WHERE id=$1', [
      invalid.id,
    ])
  ).rows[0];
  assert.equal(saved.pages, null);
  assert.ok(!JSON.stringify(saved).includes('SHOULD_NOT_BE_STORED'));
  pass('malformed pages quarantined without unsafe raw payload');
  const before = await counts();
  const live = fixture();
  live.manifest.scope.environment = 'live';
  await assert.rejects(store.ingest(admin.id, randomUUID(), text(live)), /LOCAL_SYNTHETIC_ONLY/);
  await assert.rejects(
    store.ingest(admin.id, randomUUID(), ' '.repeat(2 * 1024 * 1024 + 1)),
    /INPUT_LIMIT/,
  );
  assert.deepEqual(await counts(), before);
  pass('real environment and oversized input cannot persist');
  const fresh = fixture();
  fresh.manifest.scope.account = 'rollback-account';
  fresh.pages.forEach((p: any) => (p.scope.account = 'rollback-account'));
  await pool.query(
    `CREATE FUNCTION evidence_fail_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED'; END; $$; CREATE TRIGGER evidence_fail_attempt BEFORE INSERT ON "SyntheticEvidenceAttempt" FOR EACH ROW EXECUTE FUNCTION evidence_fail_attempt();`,
  );
  await assert.rejects(store.ingest(admin.id, randomUUID(), text(fresh)), /INJECTED/);
  assert.deepEqual(await counts(), before);
  await pool.query('DROP TRIGGER evidence_fail_attempt ON "SyntheticEvidenceAttempt"');
  pass('last audit failure rolls back import, events and links');
  const opposite = fixture();
  opposite.manifest.scope.account = 'race-account';
  opposite.pages.forEach((p: any) => (p.scope.account = 'race-account'));
  const opposite2 = structuredClone(opposite);
  opposite2.pages[0].events[0].amountMinor = '3100';
  opposite2.manifest.closingBalanceMinor = '200';
  const results = await Promise.all([
    store.ingest(admin.id, randomUUID(), text(opposite)),
    store.ingest(admin.id, randomUUID(), text(opposite2)),
  ]);
  assert.equal(results.filter((r) => r.status === 'STAGED_SYNTHETIC').length, 1);
  assert.equal(results.filter((r) => r.status === 'QUARANTINED').length, 1);
  pass('scope lock serializes conflicting imports');
  await assert.rejects(pool.query('DELETE FROM "SyntheticEvidenceImport"'), /REFUND_APPEND_ONLY/);
  await assert.rejects(
    pool.query('UPDATE "SyntheticEvidenceEvent" SET payload=$1', ['{}']),
    /REFUND_APPEND_ONLY/,
  );
  await db.user.update({ where: { id: admin.id }, data: { suspendedAt: new Date() } });
  await assert.rejects(store.ingest(admin.id, request, text(fixture())), /FORBIDDEN/);
  await assert.rejects(store.read(outsider.id, race[0].id), /FORBIDDEN/);
  pass('immutable evidence and current authorization even on replay');
  assert.equal((await pool.query('SELECT count(*)::int n FROM "RefundReceipt"')).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM "RefundCommandState"')).rows[0].n, 0);
  console.log(
    `PASS ${groups} new evidence persistence groups; no payment writes or provider calls.`,
  );
} finally {
  await db.$disconnect();
  await pool.end();
  if (created) {
    assert.match(name, /^autoveri_l11_import_[a-f0-9]{32}_test$/);
    await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.end();
}
