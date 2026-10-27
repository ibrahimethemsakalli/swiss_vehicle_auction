import { db } from './db';
import { readRuntime, runtimeHealthy, workerIsStale } from './worker-monitor';

export async function databaseReady() {
  if (!process.env.DATABASE_URL) return false;
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '2000ms'");
        const [result] = await tx.$queryRaw<{ ready: boolean }[]>`SELECT
        to_regclass('public."User"') IS NOT NULL AND to_regclass('public."Vehicle"') IS NOT NULL
        AND to_regclass('public."Transaction"') IS NOT NULL AND to_regclass('public."OutboxEvent"') IS NOT NULL AS ready`;
        return result.ready;
      },
      { maxWait: 2000, timeout: 3000 },
    );
  } catch {
    return false;
  }
}
let probe: Promise<boolean> | null = null;
export async function readiness() {
  // Coalesce concurrent probes; a database outage must not create an unbounded query queue.
  if (!probe) {
    probe = Promise.all([databaseReady(), readRuntime()])
      .then(([database, runtime]) => database && runtime !== null && runtimeHealthy(runtime))
      .catch(() => false)
      .finally(() => {
        probe = null;
      });
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      probe,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 3500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function operationsSnapshot() {
  const runtime = await readRuntime();
  const rows = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '2000ms'");
      return tx.$queryRaw<{ kind: string; count: bigint; oldestAt: Date | null }[]>`
      SELECT 'payment_pending' AS kind, COUNT(*) AS count, MIN("createdAt") AS "oldestAt" FROM "Transaction" WHERE status='PENDING'
      UNION ALL SELECT 'payment_retrying', COUNT(*), MIN("createdAt") FROM "Transaction" WHERE status='PENDING' AND attempts>0
      UNION ALL SELECT 'payment_failed', COUNT(*), MIN("createdAt") FROM "Transaction" WHERE status='FAILED'
      UNION ALL SELECT 'payment_stuck', COUNT(*), MIN("lockedAt") FROM "Transaction" WHERE status='PROCESSING' AND "lockedAt"<NOW()-INTERVAL '2 minutes'
      UNION ALL SELECT 'outbox_pending', COUNT(*), MIN("createdAt") FROM "OutboxEvent" WHERE "deliveredAt" IS NULL AND kind='auction.updated'
    `;
    },
    { maxWait: 2000, timeout: 3000 },
  );
  return {
    runtime: runtime
      ? {
          ...runtime,
          healthy: runtimeHealthy(runtime),
          workers: runtime.workers.map((w) => ({ ...w, stale: workerIsStale(w) })),
        }
      : null,
    queues: rows.map((row) => ({
      kind: row.kind,
      count: Number(row.count),
      oldestAgeSeconds: row.oldestAt
        ? Math.max(0, Math.floor((Date.now() - row.oldestAt.getTime()) / 1000))
        : null,
    })),
    observedAt: new Date().toISOString(),
  };
}
