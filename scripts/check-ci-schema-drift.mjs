import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { ciEnvironment } from './ci-environment.mjs';

// Only the failed migration/schema comparison, in a disposable local database.
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = `autoveri_drift_${randomUUID().replaceAll('-', '')}_test`;
const maintenance = new URL(source);
maintenance.pathname = '/postgres';
const target = new URL(source);
target.pathname = '/' + name;
const client = new pg.Client({ connectionString: maintenance.toString() });
const env = ciEnvironment(process.env, target.toString());
let created = false;
await client.connect();
try {
  await client.query(`CREATE DATABASE "${name}"`);
  created = true;
  for (const args of [
    ['migrate', 'deploy'],
    [
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
  ]) {
    const r = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
      env,
      encoding: 'utf8',
      timeout: 120000,
    });
    if (args[1] === 'diff') console.log(r.stdout);
    assert.equal(r.status, 0, `Prisma ${args[1]} failed (details omitted to protect credentials)`);
  }
  console.log(
    'PASS: isolated migration history matches schema; no application data or providers used',
  );
} finally {
  if (created) await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await client.end();
}
