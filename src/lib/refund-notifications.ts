import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export async function notifyRefundUpdate(tx: PoolClient, captureId: string, eventKey: string) {
  await tx.query(
    `INSERT INTO "Notification" (id,"userId","eventKey",kind,"vehicleId","vehicleName")
    SELECT $1,h."userId",$2,'REFUND_UPDATE',h."vehicleId",left(v.make || ' ' || v.model,181)
    FROM "RefundCaptureBinding" b JOIN "PaymentHold" h ON h.id=b."holdId"
    JOIN "Vehicle" v ON v.id=h."vehicleId" WHERE b."captureId"=$3
    ON CONFLICT ("userId","eventKey") DO NOTHING`,
    [randomUUID(), eventKey, captureId],
  );
}

/** Internal local worker; one durable reminder per information request, never rejects or pays. */
export async function remindRefundInformation(pool: Pool) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const rows = await tx.query(`SELECT id,"captureId","informationDueAt" FROM "RefundCase"
      WHERE status='NEEDS_INFORMATION' AND "informationDueAt"<=clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM "Notification" n WHERE n."eventKey"=
        'refund:reminder:' || "RefundCase".id || ':' ||
        to_char("informationDueAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      ORDER BY "informationDueAt",id LIMIT 100 FOR UPDATE SKIP LOCKED`);
    for (const row of rows.rows)
      await notifyRefundUpdate(
        tx,
        row.captureId,
        `refund:reminder:${row.id}:${row.informationDueAt.toISOString()}`,
      );
    await tx.query('COMMIT');
    return rows.rowCount;
  } catch (e) {
    await tx.query('ROLLBACK');
    throw e;
  } finally {
    tx.release();
  }
}
