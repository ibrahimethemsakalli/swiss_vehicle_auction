import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

mkdirSync('.local', { recursive: true });
const settingsPath = '.local/postgres.json';
if (!existsSync(settingsPath))
  writeFileSync(
    settingsPath,
    JSON.stringify({ password: randomBytes(32).toString('hex'), port: 55432 }),
    { flag: 'wx', mode: 0o600 },
  );
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
if (!existsSync('.env'))
  writeFileSync(
    '.env',
    `DATABASE_URL="postgresql://postgres:${settings.password}@127.0.0.1:${settings.port}/autoveri?schema=public"\nNEXTAUTH_URL="http://localhost:3000"\nNEXTAUTH_SECRET="${randomBytes(48).toString('hex')}"\nOCR_ENABLED=false\nSTRIPE_SECRET_KEY=\nNEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=\nSTRIPE_WEBHOOK_SECRET=\nSTRIPE_ALLOW_LIVE=false\nTWILIO_ACCOUNT_SID=\nTWILIO_AUTH_TOKEN=\nTWILIO_VERIFY_SERVICE_SID=\n`,
    { flag: 'wx', mode: 0o600 },
  );
const postgres = new EmbeddedPostgres({
  databaseDir: path.resolve('.local/postgres'),
  user: 'postgres',
  password: settings.password,
  port: settings.port,
  persistent: true,
  authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {},
  onError: () => {},
});
if (!existsSync('.local/postgres/PG_VERSION')) await postgres.initialise();
await postgres.start();
const client = postgres.getPgClient('postgres', '127.0.0.1');
await client.connect();
for (const name of ['autoveri', 'autoveri_test']) {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!result.rowCount) await client.query(`CREATE DATABASE ${name}`);
}
await client.end();
console.log(
  `PostgreSQL ready on 127.0.0.1:${settings.port}. Data persists in .local/postgres. Keep this terminal running.`,
);
setInterval(() => {}, 60000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await postgres.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
