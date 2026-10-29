import type { PoolClient } from 'pg';
import { z } from 'zod';
import { SyntheticEvidenceStore } from './refund-evidence-store';
import { canonical, manifestSchema } from './refund-external-evidence';
const mapping = z
  .object({
    importId: z.uuid(),
    eventId: z.uuid(),
    targetKind: z.enum(['CAPTURE', 'REFUND']),
    targetId: z.string().min(1).max(160),
    reason: z.string().trim().min(20).max(2000),
  })
  .strict();
export type EvidenceMatchCode =
  | 'MATCHED_SYNTHETIC'
  | 'UNMAPPED'
  | 'UNSUPPORTED'
  | 'LOCAL_MISSING'
  | 'SCOPE_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'STATE_MISMATCH';
export class SyntheticEvidenceMatcher extends SyntheticEvidenceStore {
  private async imported(tx: PoolClient, id: string) {
    const row = (await tx.query('SELECT * FROM "SyntheticEvidenceImport" WHERE id=$1', [id]))
      .rows[0];
    if (!row) throw Error('NOT_FOUND');
    if (row.status !== 'STAGED_SYNTHETIC') throw Error('QUARANTINED');
    const manifest = manifestSchema.parse(row.manifest);
    if (manifest.scope.environment !== 'test') throw Error('LOCAL_SYNTHETIC_ONLY');
    return { ...row, manifest };
  }
  private async inspect(
    tx: PoolClient,
    scope: any,
    event: any,
    targetKind: string,
    targetId: string,
  ): Promise<EvidenceMatchCode> {
    if (!['CAPTURE', 'REFUND'].includes(event.kind) || event.kind !== targetKind)
      return 'UNSUPPORTED';
    let c: any, amount: string, currency: string;
    if (targetKind === 'CAPTURE') {
      const row = (await tx.query('SELECT * FROM "RefundCaptureState" WHERE id=$1', [targetId]))
        .rows[0];
      if (!row) return 'LOCAL_MISSING';
      c = row.snapshot;
      amount = String(c.amountMinor);
      currency = c.currency;
      if (!c.confirmed || c.blocked || c.findings?.length) return 'STATE_MISMATCH';
      if (
        row.captureRef !== c.captureRef ||
        row.scopeKey !==
          JSON.stringify([c.scope?.provider, c.scope?.merchant, c.scope?.environment])
      )
        return 'SCOPE_MISMATCH';
      const hold = (
        await tx.query(
          'SELECT h.status,h.amount,h.currency,h.gateway,h."gatewayTransactionId" FROM "RefundCaptureBinding" b JOIN "PaymentHold" h ON h.id=b."holdId" WHERE b."captureId"=$1',
          [targetId],
        )
      ).rows[0];
      if (!hold) return 'LOCAL_MISSING';
      if (!['CAPTURED_FEE', 'CAPTURED_COMPENSATION'].includes(hold.status)) return 'STATE_MISMATCH';
      if (
        hold.gateway !== c.scope.provider ||
        hold.gatewayTransactionId !== c.captureRef ||
        hold.currency !== currency
      )
        return 'SCOPE_MISMATCH';
      if (Number(hold.amount) * 100 !== c.amountMinor) return 'AMOUNT_MISMATCH';
    } else {
      const row = (
        await tx.query(
          'SELECT r.*,s.snapshot FROM "RefundReceipt" r JOIN "RefundCaptureState" s ON s.id=r."captureId" WHERE r."commandKey"=$1',
          [targetId],
        )
      ).rows[0];
      if (!row) return 'LOCAL_MISSING';
      c = row.snapshot;
      amount = String(row.amountMinor);
      currency = row.currency;
      const op = c.operations?.find((o: any) => o.key === targetId);
      if (!op || op.status !== 'SUCCEEDED' || c.blocked || c.findings?.length)
        return 'STATE_MISMATCH';
      if (
        op.refundRef !== row.refundRef ||
        row.scopeKey !==
          JSON.stringify([c.scope?.provider, c.scope?.merchant, c.scope?.environment])
      )
        return 'SCOPE_MISMATCH';
      if (String(op.amountMinor) !== amount) return 'AMOUNT_MISMATCH';
    }
    if (
      c.scope?.environment !== 'test' ||
      scope.provider !== c.scope?.provider ||
      scope.merchant !== c.scope?.merchant ||
      scope.currency !== currency ||
      event.currency !== currency
    )
      return 'SCOPE_MISMATCH';
    if (!/^[1-9][0-9]*$/.test(amount) || BigInt(amount) !== BigInt(event.amountMinor))
      return 'AMOUNT_MISMATCH';
    if (event.direction !== (targetKind === 'CAPTURE' ? 'credit' : 'debit'))
      return 'STATE_MISMATCH';
    return 'MATCHED_SYNTHETIC';
  }
  /** Explicit, reasoned synthetic account/reference assertion. Not provider identity verification. */
  async map(userId: string, raw: unknown) {
    const input = mapping.parse(raw);
    return this.tx(userId, true, async (tx) => {
      const imported = await this.imported(tx, input.importId);
      if (imported.manifest.source !== 'provider') throw Error('UNSUPPORTED');
      const event = (
        await tx.query(
          'SELECT e.* FROM "SyntheticEvidenceEvent" e JOIN "SyntheticEvidenceLink" l ON l."eventId"=e.id WHERE l."importId"=$1 AND e.id=$2',
          [input.importId, input.eventId],
        )
      ).rows[0];
      if (!event) throw Error('NOT_FOUND');
      if (event.scopeKey !== imported.scopeKey) throw Error('SCOPE_MISMATCH');
      // Fixed advisory lock order serializes concurrent maps to the same event or target.
      const locks = [
        canonical(['map-event', input.eventId]),
        canonical(['map-target', input.targetKind, input.targetId]),
      ].sort();
      for (const key of locks)
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      const old = (
        await tx.query(
          'SELECT * FROM "SyntheticEvidenceMapping" WHERE "eventId"=$1 OR ("targetKind"=$2 AND "targetId"=$3)',
          [input.eventId, input.targetKind, input.targetId],
        )
      ).rows;
      if (old.length) {
        const same = old.find((r) => r.eventId === input.eventId);
        if (
          old.length !== 1 ||
          !same ||
          same.targetKind !== input.targetKind ||
          same.targetId !== input.targetId ||
          same.reason !== input.reason ||
          same.actorId !== userId
        )
          throw Error('CONFLICT');
        return {
          eventId: input.eventId,
          code: await this.inspect(
            tx,
            imported.manifest.scope,
            event.payload,
            input.targetKind,
            input.targetId,
          ),
        };
      }
      const code = await this.inspect(
        tx,
        imported.manifest.scope,
        event.payload,
        input.targetKind,
        input.targetId,
      );
      if (code !== 'MATCHED_SYNTHETIC') throw Error(code);
      await tx.query(
        'INSERT INTO "SyntheticEvidenceMapping" ("eventId","targetKind","targetId","actorId",reason) VALUES ($1,$2,$3,$4,$5)',
        [input.eventId, input.targetKind, input.targetId, userId, input.reason],
      );
      return { eventId: input.eventId, code };
    });
  }
  async report(userId: string, importId: string) {
    z.uuid().parse(importId);
    return this.tx(userId, false, async (tx) => {
      const imported = await this.imported(tx, importId);
      const events = (
        await tx.query(
          'SELECT e.id,e.payload,e."scopeKey",m."targetKind",m."targetId" FROM "SyntheticEvidenceEvent" e JOIN "SyntheticEvidenceLink" l ON l."eventId"=e.id LEFT JOIN "SyntheticEvidenceMapping" m ON m."eventId"=e.id WHERE l."importId"=$1 ORDER BY e.id',
          [importId],
        )
      ).rows;
      const rows = [];
      for (const event of events) {
        const code: EvidenceMatchCode =
          event.scopeKey !== imported.scopeKey
            ? 'SCOPE_MISMATCH'
            : imported.manifest.source !== 'provider' ||
                !['CAPTURE', 'REFUND'].includes(event.payload.kind)
              ? 'UNSUPPORTED'
              : !event.targetId
                ? 'UNMAPPED'
                : await this.inspect(
                    tx,
                    imported.manifest.scope,
                    event.payload,
                    event.targetKind,
                    event.targetId,
                  );
        rows.push({
          eventId: event.id,
          kind: event.payload.kind,
          code,
          targetId: event.targetId ?? null,
        });
      }
      return {
        importId,
        authentic: false,
        automaticCorrection: false,
        rows,
        matched: rows.filter((r) => r.code === 'MATCHED_SYNTHETIC').length,
        unresolved: rows.filter((r) => r.code !== 'MATCHED_SYNTHETIC').length,
        coverage: 'IMPORTED_EVENTS_ONLY' as const,
      };
    });
  }
}
