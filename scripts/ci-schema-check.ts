import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Loopback CI database required');
  assert.match(url.pathname, /^\/[a-z0-9_]+_test$/, 'Isolated _test database required');
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, stdio: 'inherit' },
  );
  assert.equal(migration.status, 0, 'Migration deploy');
  const db = createDatabaseClient();
  try {
    const pending = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    assert.equal(Number(pending[0].count), 0);
    for (const table of [
      'User',
      'Vehicle',
      'PaymentHold',
      'MediaAsset',
      'LegalRelease',
      'LegalAcceptance',
      'AccountChallenge',
    ]) {
      const rows = await db.$queryRaw<
        { name: string | null }[]
      >`SELECT to_regclass(${`public."${table}"`})::text AS name`;
      assert.ok(rows[0].name, table);
    }
    const [column] = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='emailVerifiedAt'`;
    assert.equal(Number(column.count), 1);
    const [triggers] = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('LegalRelease','LegalDocument','LegalAcceptance')`;
    assert.ok(Number(triggers.count) >= 3, 'Immutable legal-document triggers');
    console.log(
      'PASS: isolated CI migrations and required schema objects; no business workflow or provider called.',
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error('CI_SCHEMA_CHECK_FAILED');
  process.exitCode = 1;
});
