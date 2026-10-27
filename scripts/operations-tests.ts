import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client';
import {
  backupLocal,
  restoreLocal,
  verifyBackup,
  contained,
  assertEmptyRestoreDatabase,
} from './local-backup-lib';
import { WorkerMonitor } from '../src/lib/worker-monitor';

async function main() {
  const original = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1'].includes(original.hostname));
  assert.notEqual(process.env.NODE_ENV, 'production');
  const id = randomUUID().replaceAll('-', '');
  const sourceName = `autoveri_pm06_${id}_test`,
    targetName = `autoveri_restore_pm06_${id}_test`;
  const sourceUrl = new URL(original);
  sourceUrl.pathname = `/${sourceName}`;
  const targetUrl = new URL(original);
  targetUrl.pathname = `/${targetName}`;
  const maintenanceUrl = new URL(original);
  maintenanceUrl.pathname = '/postgres';
  const maintenance = createDatabaseClient(maintenanceUrl.toString());
  const source = createDatabaseClient(sourceUrl.toString());
  const target = createDatabaseClient(targetUrl.toString());
  const fixtureRoot = resolve(`.local/operations-fixture-${id}`),
    uploadRoot = join(fixtureRoot, 'uploads');
  const restoredUploads = resolve(`.local/restores/pm06-${id}`);
  const retryUploads = resolve(`.local/restores/pm06-retry-${id}`);
  let backup: string | undefined, shared: { $disconnect: () => Promise<void> } | undefined;
  const created: string[] = [];
  try {
    for (const name of [sourceName, targetName]) {
      assert.match(name, /^autoveri_(restore_)?pm06_[a-f0-9]+_test$/);
      await maintenance.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created.push(name);
    }
    await assertEmptyRestoreDatabase(target);
    await target.$executeRawUnsafe(
      'CREATE FUNCTION public.pm06_fixture_function() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
    );
    await assert.rejects(assertEmptyRestoreDatabase(target), /MUST_BE_EMPTY/);
    await target.$executeRawUnsafe('DROP FUNCTION public.pm06_fixture_function()');
    await assertEmptyRestoreDatabase(target);
    if (process.argv.includes('--restore-guards-only')) {
      console.log(
        'PASS: empty target accepted; function-only target rejected; no restore or existing workflow repeated.',
      );
      return;
    }
    const migration = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      { env: { ...process.env, DATABASE_URL: sourceUrl.toString() }, stdio: 'pipe' },
    );
    assert.equal(migration.status, 0, 'Isolated schema migration');
    await mkdir(uploadRoot, { recursive: true });
    const photo = Buffer.from('PM06 media integrity fixture; not a vehicle photo');
    const filename = `${randomUUID()}.jpg`;
    await writeFile(join(uploadRoot, filename), photo);
    const user = await source.user.create({
      data: {
        email: `${id}@operations.test`,
        phone: `PM06-${id}`,
        passwordHash: 'not-a-login-hash',
      },
    });
    await source.mediaAsset.create({
      data: {
        filename,
        ownerId: user.id,
        status: 'READY',
        bytes: photo.length,
        width: 1,
        height: 1,
      },
    });
    const triggerCount = await source.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) AS count FROM pg_trigger WHERE NOT tgisinternal`;
    await assert.rejects(
      backupLocal({ databaseUrl: sourceUrl.toString(), uploads: uploadRoot, quiesced: false }),
      /QUIESCED/,
    );
    backup = await backupLocal({
      databaseUrl: sourceUrl.toString(),
      uploads: uploadRoot,
      quiesced: true,
    });
    const manifest = await verifyBackup(backup);
    assert.equal(manifest.mediaIncluded, true);
    assert.equal(manifest.files.length, 2);
    assert.equal(JSON.stringify(manifest).includes(decodeURIComponent(original.password)), false);
    console.log(
      'PASS: full PostgreSQL custom-format backup + media hashes; no application workflow executed.',
    );
    await restoreLocal({
      folder: backup,
      databaseUrl: targetUrl.toString(),
      uploads: restoredUploads,
      quiesced: true,
    });
    assert.equal(
      (await target.user.findUniqueOrThrow({ where: { id: user.id } })).email,
      user.email,
    );
    assert.equal(
      (await target.mediaAsset.findUniqueOrThrow({ where: { filename } })).ownerId,
      user.id,
    );
    assert.deepEqual(await readFile(join(restoredUploads, filename)), photo);
    assert.deepEqual(
      await target.$queryRaw`SELECT COUNT(*) AS count FROM pg_trigger WHERE NOT tgisinternal`,
      triggerCount,
    );
    const [migrations] = await target.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    assert.ok(Number(migrations.count) > 0);
    console.log(
      'PASS: fresh-target restore preserves rows, ownership, media, migrations and application triggers.',
    );
    await assert.rejects(
      restoreLocal({
        folder: backup,
        databaseUrl: targetUrl.toString(),
        uploads: retryUploads,
        quiesced: true,
      }),
      /MUST_BE_EMPTY/,
    );
    assert.equal(await target.user.count(), 1);
    const mediaPath = join(backup, 'uploads', filename);
    await writeFile(mediaPath, 'tampered');
    await assert.rejects(verifyBackup(backup), /CHECKSUM/);
    await writeFile(mediaPath, photo);
    await verifyBackup(backup);
    const manifestPath = join(backup, 'manifest.json'),
      originalManifest = await readFile(manifestPath, 'utf8');
    const malicious = JSON.parse(originalManifest);
    malicious.files[1].path = 'uploads/../../.env';
    await writeFile(manifestPath, JSON.stringify(malicious));
    await assert.rejects(verifyBackup(backup), /INVALID_MANIFEST/);
    await writeFile(manifestPath, originalManifest);
    console.log(
      'PASS: occupied restore target, corruption and manifest traversal rejected; existing data unchanged.',
    );

    process.env.DATABASE_URL = sourceUrl.toString();
    process.env.OPERATIONS_DIR = join(fixtureRoot, 'runtime');
    const monitor = new WorkerMonitor(process.env.OPERATIONS_DIR);
    process.env.OPS_INSTANCE_ID = monitor.state.instanceId;
    const run = monitor.register('fixture.heartbeat', 15000, 10000);
    await run(async () => {});
    const { operationsSnapshot, readiness } = await import('../src/lib/operations');
    const { db } = await import('../src/lib/db');
    shared = db;
    assert.equal(await readiness(), true);
    const { GET } = await import('../src/app/api/health/ready/route');
    assert.equal((await GET()).status, 200);
    const snapshot = await operationsSnapshot();
    assert.equal(snapshot.runtime!.healthy, true);
    assert.equal(snapshot.queues.length, 5);
    assert.ok(snapshot.queues.every((q) => q.count === 0));
    monitor.state.stopping = true;
    await monitor.persist();
    assert.equal((await GET()).status, 503);
    console.log(
      'PASS: readiness 200 with real isolated DB + fresh worker; drain 503; empty queue metrics readable.',
    );
    console.log(`Restore rehearsal backup (synthetic data only): ${backup}`);
  } finally {
    await shared?.$disconnect();
    await source.$disconnect();
    await target.$disconnect();
    for (const name of created.reverse()) {
      assert.match(name, /^autoveri_(restore_)?pm06_[a-f0-9]+_test$/);
      await maintenance.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await maintenance.$disconnect();
    await rm(contained(resolve('.local'), fixtureRoot), { recursive: true, force: true });
    for (const path of [restoredUploads, retryUploads])
      await rm(contained(resolve('.local/restores'), path), { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'OPERATIONS_TEST_FAILED');
  process.exitCode = 1;
});
