import {
  refundAuthority,
  refundBinding,
  approvedRefundCase,
  assertRefundUnblocked,
} from './refund-decisions';
import { randomUUID } from 'node:crypto';
import { notifyRefundUpdate } from './refund-notifications';
import type { Pool, PoolClient } from 'pg';
import {
  queueRefund,
  startRefund,
  applyRefundEvidence,
  markRefundUnknown,
  refundTotals,
  type RefundCapture,
  type RefundPolicy,
  type RefundActor,
  type RefundProvider,
  type RefundEvidence,
} from './refund-domain';

const scopeKey = (c: RefundCapture) =>
  JSON.stringify([c.scope.provider, c.scope.merchant, c.scope.environment]);
type Claim = {
  id: string;
  key: string;
  token: string;
  mode: 'submit' | 'lookup';
  capture: RefundCapture;
};
/** Internal repository, not an HTTP authorization boundary. No real adapter is wired. */
export class RefundRepository {
  constructor(private pool: Pool) {}
  private async transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      const result = await fn(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }
  private async lock(tx: PoolClient, id: string): Promise<RefundCapture> {
    const r = await tx.query('SELECT "snapshot" FROM "RefundCaptureState" WHERE id=$1 FOR UPDATE', [
      id,
    ]);
    if (!r.rowCount) throw Error('NOT_FOUND');
    return r.rows[0].snapshot;
  }
  private async save(
    tx: PoolClient,
    id: string,
    old: RefundCapture,
    next: RefundCapture,
    kind: string,
    actor: string | null = null,
  ) {
    if (old === next) return;
    const r = await tx.query(
      'UPDATE "RefundCaptureState" SET snapshot=$1,version=$2 WHERE id=$3 AND version=$4',
      [JSON.stringify(next), next.version, id, old.version],
    );
    if (r.rowCount !== 1) throw Error('CONFLICT');
    await tx.query(
      'INSERT INTO "RefundStateEvent" ("captureId",version,kind,"actorId",snapshot) VALUES ($1,$2,$3,$4,$5)',
      [id, next.version, kind, actor, JSON.stringify(next)],
    );
  }
  /** Only trusted capture ingestion may call this; no synthetic migration of historic payments. */
  async register(id: string, c: RefundCapture) {
    refundTotals(c);
    if (c.operations.length || c.evidence.length || c.version !== 0)
      throw Error('INVALID_INITIAL_STATE');
    await this.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO "RefundCaptureState" (id,"scopeKey","captureRef",version,snapshot) VALUES ($1,$2,$3,0,$4)',
        [id, scopeKey(c), c.captureRef, JSON.stringify(c)],
      );
      await tx.query(
        'INSERT INTO "RefundStateEvent" ("captureId",version,kind,snapshot) VALUES ($1,0,$2,$3)',
        [id, 'REGISTER', JSON.stringify(c)],
      );
    });
  }
  async read(id: string): Promise<RefundCapture> {
    const r = await this.pool.query('SELECT snapshot FROM "RefundCaptureState" WHERE id=$1', [id]);
    if (!r.rowCount) throw Error('NOT_FOUND');
    return r.rows[0].snapshot;
  }
  async queue(id: string, input: Omit<Parameters<typeof queueRefund>[1], 'approvals'>) {
    return this.transaction(async (tx) => {
      const c = await this.lock(tx, id),
        a = await refundAuthority(tx);
      await refundBinding(tx, id, c);
      await assertRefundUnblocked(tx, id, c);
      const approvalIds = await approvedRefundCase(
        tx,
        id,
        input.caseId,
        input.decisionVersion,
        a.policy,
        input.amountMinor,
      );
      const approvals = approvalIds.map(
        (id) => a.actors.find((x) => x.id === id) ?? { id, active: false, capabilities: [] },
      );
      const next = queueRefund(c, { ...input, approvals }, a.policy);
      if (next !== c) {
        await tx.query(
          'INSERT INTO "RefundCommandState" (key,"captureId","caseId","decisionVersion") VALUES ($1,$2,$3,$4)',
          [input.key, id, input.caseId, input.decisionVersion],
        );
        await this.save(tx, id, c, next, 'QUEUE');
      }
      return next;
    });
  }
  async claim(id: string, key: string, actorId: string): Promise<Claim | null> {
    return this.transaction(async (tx) => {
      const c = await this.lock(tx, id);
      const r = await tx.query(
        'SELECT *, ("leaseUntil">clock_timestamp()) AS busy FROM "RefundCommandState" WHERE key=$1 AND "captureId"=$2 FOR UPDATE',
        [key, id],
      );
      if (!r.rowCount) throw Error('NOT_FOUND');
      if (r.rows[0].busy) return null;
      const op = c.operations.find((o) => o.key === key)!;
      if (!['QUEUED', 'SUBMITTING', 'PENDING', 'UNKNOWN'].includes(op.status)) return null;
      const a = await refundAuthority(tx),
        actor = a.actors.find((x) => x.id === actorId);
      if (
        !actor?.active ||
        !actor.capabilities.includes('refund.execute') ||
        c.participantIds.includes(actorId)
      )
        throw Error('FORBIDDEN');
      await refundBinding(tx, id, c);
      const mode = op.status === 'QUEUED' ? 'submit' : 'lookup';
      if (mode === 'submit') {
        await assertRefundUnblocked(tx, id, c);
        const approved = await approvedRefundCase(
          tx,
          id,
          op.caseId,
          op.decisionVersion,
          a.policy,
          op.amountMinor,
        );
        if (JSON.stringify([...approved].sort()) !== JSON.stringify([...op.approvalIds].sort()))
          throw Error('DECISION_REQUIRED');
      }
      const next =
        mode === 'submit' ? startRefund(c, key, c.version, actor, a.actors, a.policy) : c;
      const token = randomUUID();
      await tx.query(
        'UPDATE "RefundCommandState" SET "leaseToken"=$1,"leaseUntil"=clock_timestamp()+interval \'60 seconds\' WHERE key=$2',
        [token, key],
      );
      await this.save(tx, id, c, next, 'START', actorId);
      return { id, key, token, mode, capture: next };
    });
  }
  /** Late workers are fenced. Evidence is merged into the latest locked snapshot, never a stale one. */
  async finish(claim: Claim, e: RefundEvidence | null) {
    return this.transaction(async (tx) => {
      const c = await this.lock(tx, claim.id);
      const r = await tx.query(
        'SELECT "leaseToken" FROM "RefundCommandState" WHERE key=$1 AND "captureId"=$2 FOR UPDATE',
        [claim.key, claim.id],
      );
      if (r.rows[0]?.leaseToken !== claim.token) return false;
      let next = c;
      const op = c.operations.find((o) => o.key === claim.key)!;
      if (e) {
        next = applyRefundEvidence(
          c,
          e.key === claim.key ? e : { ...e, captureRef: 'INVALID_COMMAND_RESPONSE' },
        );
        const result = next.operations.find((o) => o.key === claim.key)!;
        if (result.status === 'SUCCEEDED' && result.refundRef) {
          const inserted = await tx.query(
            'INSERT INTO "RefundReceipt" ("scopeKey","refundRef","captureId","commandKey","amountMinor",currency) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING "commandKey"',
            [scopeKey(c), result.refundRef, claim.id, claim.key, result.amountMinor, c.currency],
          );
          if (!inserted.rowCount) {
            const existing = await tx.query(
              'SELECT "commandKey" FROM "RefundReceipt" WHERE "scopeKey"=$1 AND "refundRef"=$2',
              [scopeKey(c), result.refundRef],
            );
            if (existing.rows[0]?.commandKey !== claim.key)
              next = {
                ...next,
                blocked: true,
                findings: [...new Set([...next.findings, 'RECEIPT_CONFLICT'])],
              };
          }
          if (inserted.rowCount)
            await notifyRefundUpdate(tx, claim.id, `refund:receipt:${claim.key}`);
        }
      } else if (['SUBMITTING', 'PENDING', 'UNKNOWN'].includes(op.status))
        next = markRefundUnknown(c, claim.key);
      await this.save(tx, claim.id, c, next, 'RESULT');
      await tx.query(
        'UPDATE "RefundCommandState" SET "leaseToken"=NULL,"leaseUntil"=NULL WHERE key=$1',
        [claim.key],
      );
      return true;
    });
  }
  async run(id: string, key: string, actorId: string, port: RefundProvider) {
    const claim = await this.claim(id, key, actorId);
    if (!claim) return false;
    const c = claim.capture,
      op = c.operations.find((o) => o.key === key)!;
    let evidence: RefundEvidence | null = null;
    try {
      evidence =
        claim.mode === 'submit'
          ? await port.submit({
              scope: c.scope,
              captureRef: c.captureRef,
              currency: c.currency,
              amountMinor: op.amountMinor,
              key,
            })
          : await port.lookup(c.scope, key);
    } catch {
      /* Unknown outcome keeps its reservation and is recovered by lookup only. */
    }
    return this.finish(claim, evidence);
  }
}
