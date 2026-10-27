import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export type DatabasePoolSettings = {
  max?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
};

function positiveInteger(value: number | string | undefined, fallback: number, name: string) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`INVALID_${name}`);
  return parsed;
}

export function databaseOptions(
  connectionString: string | undefined,
  settings: DatabasePoolSettings = {},
) {
  if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('INVALID_DATABASE_URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('POSTGRESQL_URL_REQUIRED');
  const schema = url.searchParams.get('schema') || 'public';
  url.searchParams.delete('schema');
  // Rust-engine flags are not interpreted by node-postgres. Fail explicitly rather
  // than silently ignoring an operator's pool or transaction-proxy settings.
  for (const key of ['connection_limit', 'pool_timeout', 'connect_timeout', 'pgbouncer']) {
    if (url.searchParams.has(key)) throw new Error('LEGACY_PRISMA_CONNECTION_OPTION');
  }
  return {
    schema,
    pool: {
      connectionString: url.toString(),
      max: positiveInteger(settings.max ?? process.env.DB_POOL_MAX, 10, 'DB_POOL_MAX'),
      connectionTimeoutMillis: positiveInteger(
        settings.connectionTimeoutMillis ?? process.env.DB_CONNECT_TIMEOUT_MS,
        5000,
        'DB_CONNECT_TIMEOUT_MS',
      ),
      idleTimeoutMillis: positiveInteger(
        settings.idleTimeoutMillis ?? process.env.DB_IDLE_TIMEOUT_MS,
        10000,
        'DB_IDLE_TIMEOUT_MS',
      ),
    },
  };
}

export function createDatabaseClient(
  connectionString = process.env.DATABASE_URL,
  settings: DatabasePoolSettings = {},
) {
  const { pool, schema } = databaseOptions(connectionString, settings);
  return new PrismaClient({
    adapter: new PrismaPg(pool, { schema }),
    transactionOptions: { maxWait: 2000, timeout: 5000 },
  });
}
