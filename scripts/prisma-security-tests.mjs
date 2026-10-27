import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { ciEnvironment } from './ci-environment.mjs';

// Only synthetic data in a newly created loopback database; never migrate the user's DB.
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname), 'Local PostgreSQL required');
const name = `autoveri_prisma7_${randomUUID().replaceAll('-', '')}_test`;
const target = new URL(source);
target.pathname = `/${name}`;
const maintenance = new URL(source);
maintenance.pathname = '/postgres';
const env = ciEnvironment(process.env, target.toString());
Object.assign(process.env, env);
const cli = (args, expected = 0) => {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  // Never include connection URLs or credentials in assertion output.
  if (args[0] === 'migrate' && args[1] === 'diff' && result.status === 2)
    console.error(result.stdout);
  assert.equal(result.status, expected, `Prisma ${args.slice(0, 2).join(' ')} failed`);
  return result.stdout;
};

cli(['generate']);
cli(['validate']);
const { Prisma } = await import('../src/generated/prisma/client.ts');
const { createDatabaseClient, databaseOptions } = await import('../src/lib/database-client.ts');
assert.equal(Prisma.prismaVersion.client, '7.10.1');
console.log('PASS: schema validation and generated ESM client 7.10.1');

const prismaRequire = createRequire(import.meta.resolve('prisma/package.json'));
const configPath = prismaRequire.resolve('@prisma/config');
const configRequire = createRequire(configPath);
assert.equal(configRequire('effect/package.json').version, '3.20.0');
const mergeEntry = configRequire.resolve('deepmerge-ts');
const mergePackage = JSON.parse(
  await readFile(resolve(dirname(mergeEntry), '../package.json'), 'utf8'),
);
assert.equal(mergePackage.version, '8.0.2');
const { deepmerge } = await import(pathToFileURL(configRequire.resolve('deepmerge-ts')).href);
assert.deepEqual(deepmerge({ nested: { a: 1 } }, { nested: { b: 2 } }), { nested: { a: 1, b: 2 } });
const a = {};
a.self = a;
const b = {};
b.self = b;
const merged = deepmerge(a, b);
assert.equal(merged.self, merged, 'Recursive objects terminate and preserve cycles');
await mkdir(resolve('.local'), { recursive: true });
const fixture = await mkdtemp(resolve('.local/pm07c-config-'));
try {
  const configFile = join(fixture, 'prisma.config.mjs');
  await writeFile(
    configFile,
    `export default ${JSON.stringify({
      schema: resolve('prisma/schema.prisma'),
      migrations: { path: resolve('prisma/migrations') },
    })};`,
  );
  const { loadConfigFromFile } = prismaRequire('@prisma/config');
  const loaded = await loadConfigFromFile({ configFile, configRoot: fixture });
  assert.equal(loaded.error, undefined, 'c12 / effect / deepmerge config loader');
  assert.equal(loaded.config.schema, resolve('prisma/schema.prisma'));
  assert.equal(loaded.config.migrations.path, resolve('prisma/migrations'));
  cli(['validate', '--config', configFile]);
  console.log(
    'PASS: patched dependency resolution, recursive merge and actual Prisma config loading',
  );
} finally {
  assert.equal(dirname(fixture), resolve('.local'));
  await rm(fixture, { recursive: true });
}

const admin = createDatabaseClient(maintenance.toString());
const db = createDatabaseClient(target.toString());
let created = false;
try {
  assert.match(name, /^autoveri_prisma7_[a-f0-9]{32}_test$/);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  cli(['migrate', 'deploy']);
  cli(['migrate', 'deploy']);
  cli(['migrate', 'status']);
  const migrations =
    await db.$queryRaw`SELECT migration_name, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL`;
  const folders = (await readdir('prisma/migrations', { withFileTypes: true })).filter((x) =>
    x.isDirectory(),
  );
  assert.equal(migrations.length, folders.length);
  assert.ok(migrations.every((x) => x.finished_at));
  cli([
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--exit-code',
  ]);
  console.log('PASS: fresh migrations, repeat deploy, migration status and zero schema drift');

  assert.throws(() => databaseOptions(''), /DATABASE_URL_REQUIRED/);
  assert.throws(() => databaseOptions('https://example.invalid'), /POSTGRESQL_URL_REQUIRED/);
  assert.throws(() => databaseOptions(target.toString(), { max: 0 }), /INVALID_DB_POOL_MAX/);
  const legacy = new URL(target);
  legacy.searchParams.set('connection_limit', '1');
  assert.throws(() => databaseOptions(legacy.toString()), /LEGACY_PRISMA_CONNECTION_OPTION/);
  const defaults = databaseOptions(target.toString());
  assert.equal(defaults.pool.max, 10);
  assert.equal(defaults.pool.connectionTimeoutMillis, 5000);
  assert.equal(defaults.pool.idleTimeoutMillis, 10000);
  assert.equal(defaults.pool.ssl, undefined, 'TLS verification is never disabled');
  // Import is safe without a URL; an actual connection fails closed.
  process.env.DATABASE_URL = '';
  const { db: shared } = await import('../src/lib/db.ts');
  await shared.$disconnect();
  assert.throws(() => shared.$connect, /DATABASE_URL_REQUIRED/);
  process.env.DATABASE_URL = target.toString();
  try {
    await shared.$connect();
    assert.equal((await shared.$queryRaw`SELECT current_database() AS name`)[0].name, name);
  } finally {
    await shared.$disconnect();
  }

  // schema= must select the adapter schema, rather than silently querying public.
  await db.$executeRawUnsafe('CREATE SCHEMA prisma7_probe');
  await db.$executeRawUnsafe(
    'CREATE TABLE prisma7_probe."AccountChallenge" (LIKE public."AccountChallenge" INCLUDING ALL)',
  );
  const schemaUrl = new URL(target);
  schemaUrl.searchParams.set('schema', 'prisma7_probe');
  const schemaDb = createDatabaseClient(schemaUrl.toString());
  try {
    await schemaDb.accountChallenge.create({
      data: {
        id: randomUUID(),
        userId: randomUUID(),
        purpose: 'EMAIL',
        tokenHash: 'synthetic',
        expiresAt: new Date(),
      },
    });
    assert.equal(await schemaDb.accountChallenge.count(), 1);
    assert.equal(await db.accountChallenge.count(), 0);
  } finally {
    await schemaDb.$disconnect();
  }
  console.log('PASS: connection configuration, lazy shared client and non-public schema isolation');

  const user = await db.user.create({
    data: {
      email: `${name}@example.invalid`,
      phone: `+4179${name}`,
      passwordHash: 'synthetic-not-a-login',
    },
  });
  assert.equal(user.role, 'PRIVATE_USER');
  const vehicle = await db.vehicle.create({
    data: {
      userId: user.id,
      stammnummer: 'test',
      vinChassis: name,
      make: 'Test',
      model: 'Fixture',
      mileage: 1,
      canton: 'ZH',
      mfkDate: new Date(),
      serviceHistory: 'test',
      tireCondition: 'test',
      description: 'Synthetic Prisma compatibility fixture',
      images: [],
      listingType: 'AUCTION_7_DAYS',
      startPrice: new Prisma.Decimal('1234.56'),
    },
  });
  const hold = await db.paymentHold.create({
    data: {
      userId: user.id,
      vehicleId: vehicle.id,
      gateway: 'TEST_NO_PROVIDER',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  assert.equal(hold.amount.toFixed(2), '30.00');
  assert.equal(hold.currency, 'CHF');
  assert.equal(vehicle.startPrice.toFixed(2), '1234.56');
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { vehicles: true } }))
      .vehicles.length,
    1,
  );
  await assert.rejects(
    db.user.create({ data: { email: user.email, phone: 'duplicate-test', passwordHash: 'test' } }),
    { code: 'P2002' },
  );
  await assert.rejects(
    db.accountChallenge.create({
      data: {
        id: randomUUID(),
        userId: randomUUID(),
        purpose: 'EMAIL',
        tokenHash: 'test',
        expiresAt: new Date(),
      },
    }),
    { code: 'P2003' },
  );
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicle.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(70703)::text`;
    await tx.vehicle.update({ where: { id: vehicle.id }, data: { version: { increment: 1 } } });
    const [row] =
      await tx.$queryRaw`SELECT ${JSON.stringify({ nested: { ok: true } })}::jsonb AS value`;
    assert.equal(row.value.nested.ok, true);
  });
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.vehicle.update({ where: { id: vehicle.id }, data: { version: 99 } });
      throw new Error('INTENTIONAL_ROLLBACK');
    }),
    /INTENTIONAL_ROLLBACK/,
  );
  assert.equal((await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).version, 1);
  await db.$transaction([
    db.paymentHold.delete({ where: { id: hold.id } }),
    db.vehicle.delete({ where: { id: vehicle.id } }),
    db.user.delete({ where: { id: user.id } }),
  ]);
  console.log(
    'PASS: CRUD, relations, Decimal/defaults, unique/FK errors, JSONB, locks, commit/rollback and array transactions',
  );
  const limited = createDatabaseClient(target.toString(), { max: 1, connectionTimeoutMillis: 250 });
  let unlock;
  const gate = new Promise((resolve) => {
    unlock = resolve;
  });
  let occupied;
  const acquired = new Promise((resolve) => {
    occupied = resolve;
  });
  const held = limited.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1`;
    occupied();
    await gate;
  });
  try {
    await Promise.race([
      acquired,
      held.then(() => {
        throw new Error('POOL_NOT_ACQUIRED');
      }),
    ]);
    const start = Date.now();
    await assert.rejects(limited.$queryRaw`SELECT 1`);
    assert.ok(Date.now() - start < 3000, 'Pool acquisition is bounded');
  } finally {
    unlock();
    await held;
    await limited.$disconnect();
  }
  await db.$disconnect();
  assert.equal((await db.$queryRaw`SELECT 1 AS value`)[0].value, 1, 'Reconnect after disconnect');

  // A local TCP listener accepts but never speaks PostgreSQL: bounded handshake timeout.
  const sockets = new Set();
  const stalled = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    stalled.once('error', reject);
    stalled.listen(0, '127.0.0.1', resolve);
  });
  const unavailable = createDatabaseClient(
    `postgresql://test:test@127.0.0.1:${stalled.address().port}/test`,
    { connectionTimeoutMillis: 250 },
  );
  try {
    const start = Date.now();
    await assert.rejects(unavailable.$queryRaw`SELECT 1`);
    assert.ok(Date.now() - start < 3000, 'Connection handshake is bounded');
  } finally {
    await unavailable.$disconnect();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => stalled.close(resolve));
  }
  console.log('PASS: bounded pool/connection timeouts, pool disposal and reconnect');
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_prisma7_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: temporary database removed; no business workflow or payment/SMS API invoked');
