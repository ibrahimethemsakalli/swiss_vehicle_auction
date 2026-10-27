import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  WorkerMonitor,
  runtimeHealthy,
  runtimePath,
  workerIsStale,
} from '../src/lib/worker-monitor';
import { contained, localDatabase, verifyBackup } from '../scripts/local-backup-lib';

test('worker status persists successes, sanitized failures and recovery without replaying business tasks', async () => {
  const parent = resolve('.local/operations-tests');
  await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(join(parent, 'run-'));
  let now = Date.now();
  const monitor = new WorkerMonitor(folder, () => now);
  const run = monitor.register('fixture.worker', 1000, 2000);
  const log = console.error;
  const logs: string[] = [];
  try {
    await run(async () => {});
    assert.equal(monitor.state.workers[0].state, 'ok');
    now += 100;
    console.error = (value) => {
      logs.push(String(value));
    };
    await run(async () => {
      throw Error('SECRET_CONNECTION_PASSWORD');
    });
    const failed = JSON.parse(
      await readFile(runtimePath(monitor.state.instanceId, folder), 'utf8'),
    );
    assert.equal(failed.workers[0].consecutiveFailures, 1);
    assert.equal(failed.workers[0].lastErrorCode, 'WORKER_FAILED');
    assert.equal(runtimeHealthy(failed, now), false);
    assert.equal(JSON.stringify(failed).includes('SECRET_CONNECTION_PASSWORD'), false);
    assert.equal(logs.join('').includes('SECRET_CONNECTION_PASSWORD'), false);
    now += 100;
    await run(async () => {});
    assert.equal(monitor.state.workers[0].consecutiveFailures, 0);
    assert.equal(monitor.state.workers[0].totalFailures, 1);
    assert.ok(runtimeHealthy(monitor.state, now));
    now += 21000;
    assert.equal(runtimeHealthy(monitor.state, now), false);
  } finally {
    console.error = log;
    await rm(contained(parent, folder), { recursive: true, force: true });
  }
});

test('worker overlap, disabled state, hung run, stale schedule and draining are distinct', async () => {
  const parent = resolve('.local/operations-tests');
  await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(join(parent, 'run-'));
  let now = Date.now();
  const monitor = new WorkerMonitor(folder, () => now);
  const run = monitor.register('fixture', 1000, 2000),
    disabled = monitor.register('disabled', 1000, 1000, false);
  let release!: () => void, started!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await disabled(async () => {
      throw Error('Should never run');
    });
    const pending = run(async () => {
      started();
      await barrier;
    });
    await start;
    await run(async () => {
      throw Error('Overlap');
    });
    assert.equal(monitor.state.workers[0].skippedOverlaps, 1);
    now += 2001;
    assert.equal(workerIsStale(monitor.state.workers[0], now), true);
    release();
    await pending;
    now += 5001;
    assert.equal(workerIsStale(monitor.state.workers[0], now), true);
    monitor.state.stopping = true;
    await monitor.persist();
    assert.equal(runtimeHealthy(monitor.state, now), false);
    assert.equal(workerIsStale(monitor.state.workers[1], now), false);
  } finally {
    release();
    await rm(contained(parent, folder), { recursive: true, force: true });
  }
});

test('backup guards reject production, remote databases, active data target and traversal', async () => {
  await assert.rejects(verifyBackup('.local/backups/fixture.incomplete'), /INCOMPLETE_BACKUP/);
  assert.equal(localDatabase('postgresql://fixture:fixture@127.0.0.1/autoveri').name, 'autoveri');
  for (const url of [
    'postgresql://u:p@remote.example/autoveri',
    'postgresql://u:p@127.0.0.1/production',
    'postgresql://u:p@127.0.0.1/autoveri',
  ]) {
    assert.throws(() => localDatabase(url, true));
  }
  assert.ok(localDatabase('postgresql://u:p@localhost/autoveri_restore_fixture_test', true));
  const root = resolve('.local/restores');
  assert.throws(() => contained(root, resolve('.env')));
  assert.throws(() => contained(root, root));
  const old = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  try {
    assert.throws(() => localDatabase('postgresql://u:p@127.0.0.1/autoveri'));
  } finally {
    Object.assign(process.env, { NODE_ENV: old });
  }
});

test('health liveness is dependency-free; uninitialized runtime readiness is 503 without details', async () => {
  const { GET: live } = await import('../src/app/api/health/live/route');
  const { GET: ready } = await import('../src/app/api/health/ready/route');
  const old = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const alive = live();
    assert.equal(alive.status, 200);
    assert.equal(alive.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await alive.json(), { status: 'alive' });
    const result = await ready();
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { status: 'not_ready' });
  } finally {
    if (old === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = old;
  }
});
