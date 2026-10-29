import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { RefundCapture, RefundPolicy, RefundActor } from './refund-domain';
import { approvedRefundPolicy, informationDeadline, refundTiming } from './refund-policy';
import { notifyRefundUpdate } from './refund-notifications';

const reason = z.string().trim().min(20).max(2000);
const requestInput = z
  .object({
    captureId: z.string().min(1).max(100),
    requestId: z.uuid(),
    reason,
    previousCaseId: z.uuid().optional(),
    reviewBasis: z.enum(['EQUIVALENT', 'NEW_EVIDENCE', 'ERROR']).optional(),
  })
  .strict();
export const refundWorkflowInput = z
  .object({
    action: z.enum([
      'REQUEST_INFORMATION',
      'PROVIDE_INFORMATION',
      'CONFIRM_EVIDENCE',
      'STATUS_UPDATE',
      'CHARGEBACK',
      'CAPTURE_CONFLICT',
      'ACCOUNT_CONFLICT',
      'RESOLVE_BLOCK',
    ]),
    caseId: z.uuid(),
    requestId: z.uuid(),
    expectedVersion: z.number().int().min(0),
    reason,
    blockId: z.uuid().optional(),
  })
  .strict();
const decisionInput = z
  .object({
    caseId: z.uuid(),
    requestId: z.uuid(),
    expectedVersion: z.number().int().min(0),
    outcome: z.enum(['APPROVE', 'REJECT']),
    reason,
  })
  .strict();
export async function refundAuthority(tx: PoolClient) {
  const r = await tx.query(
    'SELECT policy,actors FROM "RefundRuntimePolicy" WHERE id=$1 FOR SHARE',
    ['active'],
  );
  if (!r.rowCount) throw Error('POLICY_UNCONFIGURED');
  const policy = approvedRefundPolicy,
    grants = r.rows[0].actors as RefundActor[];
  const users = await tx.query(
    'SELECT id,role,"suspendedAt","isSample" FROM "User" WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE',
    [grants.map((a) => a.id)],
  );
  const actors = grants.map((a) => {
    const u = users.rows.find((u) => u.id === a.id);
    return {
      ...a,
      active: !!(a.active && u && u.role === 'ADMIN' && !u.suspendedAt && !u.isSample),
    };
  });
  return { policy, actors };
}
export async function refundBinding(tx: PoolClient, id: string, c: RefundCapture) {
  const r = await tx.query(
    'SELECT h."userId" AS buyer,v."userId" AS seller,h.status,h."gatewayTransactionId",h.gateway,h.currency,h.amount FROM "RefundCaptureBinding" b JOIN "PaymentHold" h ON h.id=b."holdId" JOIN "Vehicle" v ON v.id=h."vehicleId" WHERE b."captureId"=$1 FOR SHARE OF b,h,v',
    [id],
  );
  const b = r.rows[0];
  if (
    !b ||
    !['CAPTURED_FEE', 'CAPTURED_COMPENSATION'].includes(b.status) ||
    b.gatewayTransactionId !== c.captureRef ||
    b.gateway !== c.scope.provider ||
    b.currency !== c.currency ||
    Number(b.amount) * 100 !== c.amountMinor ||
    JSON.stringify([...new Set([b.buyer, b.seller])].sort()) !==
      JSON.stringify([...new Set(c.participantIds)].sort())
  )
    throw Error('CAPTURE_BINDING_REQUIRED');
  return b as { buyer: string; seller: string };
}
export async function approvedRefundCase(
  tx: PoolClient,
  captureId: string,
  caseId: string,
  version: number,
  policy: RefundPolicy,
  amountMinor: number,
) {
  const r = await tx.query('SELECT * FROM "RefundCase" WHERE id=$1 AND "captureId"=$2 FOR SHARE', [
    caseId,
    captureId,
  ]);
  const c = r.rows[0];
  if (
    !c ||
    c.status !== 'APPROVED' ||
    !c.evidenceReadyAt ||
    (c.approvedVersion ?? c.version) !== version ||
    c.policyVersion !== policy.version ||
    c.amountMinor !== amountMinor ||
    c.currency !== 'CHF'
  )
    throw Error('DECISION_REQUIRED');
  const votes = await tx.query(
    'SELECT "reviewerId" FROM "RefundDecision" WHERE "caseId"=$1 AND outcome=$2 AND "policyVersion"=$3 AND "reviewRound"=$4 ORDER BY "reviewerId"',
    ['' + caseId, 'APPROVE', policy.version, c.reviewRound],
  );
  return votes.rows.map((r) => r.reviewerId as string);
}
export async function assertRefundUnblocked(tx: PoolClient, id: string, c: RefundCapture) {
  const scope = JSON.stringify([c.scope.provider, c.scope.merchant, c.scope.environment]);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['refund-risk:' + scope]);
  const blocks = await tx.query(
    'SELECT 1 FROM "RefundOperationalBlock" WHERE "scopeKey"=$1 AND "resolvedAt" IS NULL AND ("captureId" IS NULL OR "captureId"=$2)',
    [scope, id],
  );
  if (blocks.rowCount || c.blocked || c.findings.length) throw Error('REVIEW_REQUIRED');
}
/** userId must come from authenticated server session, never request JSON. No provider calls. */
export class RefundDecisions {
  constructor(private pool: Pool) {}
  async list(userId: string, admin: boolean, page: number) {
    return this.tx(async (tx) => {
      await this.user(tx, userId);
      let policyReady = false;
      if (admin) {
        const a = await refundAuthority(tx);
        if (
          !a.actors.some(
            (x) =>
              x.id === userId &&
              x.active &&
              (x.capabilities.includes('refund.review') ||
                x.capabilities.includes('payment.reconcile')),
          )
        )
          throw Error('FORBIDDEN');
        policyReady =
          a.actors.some(
            (x) => x.id === userId && x.active && x.capabilities.includes('refund.review'),
          ) &&
          !!a.policy.version &&
          a.policy.reviewRulesConfirmed === true &&
          Number.isSafeInteger(a.policy.requiredApprovals) &&
          a.policy.requiredApprovals! > 0;
      }
      const cases = await tx.query(
        `SELECT c.id,c.reason,c.status,c.version,c."amountMinor",c.currency,c."createdAt"
        FROM "RefundCase" c JOIN "RefundCaptureBinding" b ON b."captureId"=c."captureId"
        JOIN "PaymentHold" h ON h.id=b."holdId" JOIN "Vehicle" v ON v.id=h."vehicleId"
        WHERE ${admin ? 'h."userId"<>$1 AND v."userId"<>$1' : 'c."requesterId"=$1'}
        ORDER BY c."createdAt" DESC,c.id DESC LIMIT 21 OFFSET $2`,
        [userId, (page - 1) * 20],
      );
      // Selection is bounded and paginated too; references/secrets are never returned.
      const captures = admin
        ? { rows: [] }
        : await tx.query(
            `SELECT s.id,h.amount,v.make,v.model
        FROM "RefundCaptureState" s JOIN "RefundCaptureBinding" b ON b."captureId"=s.id
        JOIN "PaymentHold" h ON h.id=b."holdId" JOIN "Vehicle" v ON v.id=h."vehicleId"
        WHERE h."userId"=$1 AND h.status IN ('CAPTURED_FEE','CAPTURED_COMPENSATION')
        ORDER BY h."createdAt" DESC,s.id DESC LIMIT 21 OFFSET $2`,
            [userId, (page - 1) * 20],
          );
      return {
        cases: cases.rows.slice(0, 20),
        captures: captures.rows.slice(0, 20),
        more: cases.rows.length > 20 || captures.rows.length > 20,
        policyReady,
      };
    });
  }
  private async tx<T>(fn: (tx: PoolClient) => Promise<T>) {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      const v = await fn(tx);
      await tx.query('COMMIT');
      return v;
    } catch (e) {
      await tx.query('ROLLBACK');
      throw e;
    } finally {
      tx.release();
    }
  }
  private async user(tx: PoolClient, id: string) {
    const r = await tx.query(
      'SELECT id,role,"suspendedAt","isSample" FROM "User" WHERE id=$1 FOR SHARE',
      [id],
    );
    const u = r.rows[0];
    if (!u || u.suspendedAt || u.isSample) throw Error('FORBIDDEN');
    return u;
  }
  private async capture(tx: PoolClient, id: string) {
    const r = await tx.query('SELECT snapshot FROM "RefundCaptureState" WHERE id=$1 FOR UPDATE', [
      id,
    ]);
    if (!r.rowCount) throw Error('NOT_FOUND');
    const c = r.rows[0].snapshot as RefundCapture;
    const binding = await refundBinding(tx, id, c);
    return { c, binding };
  }
  private async activity(
    tx: PoolClient,
    caseId: string,
    actor: string,
    requestId: string,
    action: string,
    note: string,
    hash: string,
  ) {
    await tx.query(
      'INSERT INTO "RefundCaseActivity" (id,"caseId","actorId","requestId",action,reason,"payloadHash") VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), caseId, actor, requestId, action, note, hash],
    );
  }
  private async independentReviewer(
    tx: PoolClient,
    row: { previousCaseId?: string },
    actor: string,
  ) {
    if (
      row.previousCaseId &&
      (
        await tx.query('SELECT 1 FROM "RefundDecision" WHERE "caseId"=$1 AND "reviewerId"=$2', [
          row.previousCaseId,
          actor,
        ])
      ).rowCount
    )
      throw Error('DIFFERENT_REVIEWER_REQUIRED');
  }
  async workflow(userId: string, raw: unknown) {
    const i = refundWorkflowInput.parse(raw);
    return this.tx(async (tx) => {
      const first = await tx.query('SELECT "captureId" FROM "RefundCase" WHERE id=$1', [i.caseId]);
      if (!first.rowCount) throw Error('NOT_FOUND');
      const captureId = first.rows[0].captureId;
      const { c, binding } = await this.capture(tx, captureId);
      await this.user(tx, userId);
      const row = (await tx.query('SELECT * FROM "RefundCase" WHERE id=$1 FOR UPDATE', [i.caseId]))
        .rows[0];
      const risk = ['CHARGEBACK', 'CAPTURE_CONFLICT', 'ACCOUNT_CONFLICT', 'RESOLVE_BLOCK'].includes(
        i.action,
      );
      if (i.action === 'PROVIDE_INFORMATION') {
        if (binding.buyer !== userId) throw Error('FORBIDDEN');
      } else {
        const a = await refundAuthority(tx);
        const actor = a.actors.find((x) => x.id === userId);
        if (
          !actor?.active ||
          !actor.capabilities.includes(risk ? 'payment.reconcile' : 'refund.review') ||
          c.participantIds.includes(userId)
        )
          throw Error('FORBIDDEN');
        if (!risk) await this.independentReviewer(tx, row, userId);
      }
      const hash = createHash('sha256').update(JSON.stringify(i)).digest('hex');
      const old = await tx.query(
        'SELECT * FROM "RefundCaseActivity" WHERE "actorId"=$1 AND "requestId"=$2',
        [userId, i.requestId],
      );
      if (old.rowCount) {
        if (old.rows[0].payloadHash !== hash) throw Error('CONFLICT');
        return { id: row.id, status: row.status, version: row.version };
      }
      if (row.version !== i.expectedVersion) throw Error('CONFLICT');
      let status = row.status;
      if (risk) {
        const scope = JSON.stringify([c.scope.provider, c.scope.merchant, c.scope.environment]);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'refund-risk:' + scope,
        ]);
        if (i.action === 'RESOLVE_BLOCK') {
          if (!i.blockId) throw Error('INVALID_BODY');
          const b = (
            await tx.query(
              'SELECT * FROM "RefundOperationalBlock" WHERE id=$1 AND "scopeKey"=$2 FOR UPDATE',
              [i.blockId, scope],
            )
          ).rows[0];
          if (!b || b.resolvedAt || (b.captureId && b.captureId !== captureId))
            throw Error('CONFLICT');
          if (b.openedBy === userId) throw Error('DIFFERENT_REVIEWER_REQUIRED');
          await tx.query(
            'UPDATE "RefundOperationalBlock" SET "resolvedBy"=$1,"resolvedReason"=$2,"resolvedAt"=clock_timestamp() WHERE id=$3',
            [userId, i.reason, i.blockId],
          );
        } else {
          await tx.query(
            'INSERT INTO "RefundOperationalBlock" (id,"scopeKey","captureId",kind,"openedBy","openedReason") VALUES ($1,$2,$3,$4,$5,$6)',
            [
              randomUUID(),
              scope,
              i.action === 'ACCOUNT_CONFLICT' ? null : captureId,
              i.action,
              userId,
              i.reason,
            ],
          );
        }
      } else {
        if (!['REQUESTED', 'IN_REVIEW', 'NEEDS_INFORMATION'].includes(row.status))
          throw Error('CONFLICT');
        if (i.action === 'REQUEST_INFORMATION') {
          status = 'NEEDS_INFORMATION';
          await tx.query(
            'UPDATE "RefundCase" SET "informationDueAt"=$1,"evidenceReadyAt"=NULL,"reviewRound"="reviewRound"+1 WHERE id=$2',
            [informationDeadline(new Date()), row.id],
          );
        } else if (i.action === 'PROVIDE_INFORMATION') {
          if (row.status !== 'NEEDS_INFORMATION') throw Error('CONFLICT');
          status = 'IN_REVIEW';
          await tx.query(
            'UPDATE "RefundCase" SET "informationDueAt"=NULL,"evidenceReadyAt"=NULL,"reviewRound"="reviewRound"+1 WHERE id=$1',
            [row.id],
          );
        } else if (i.action === 'CONFIRM_EVIDENCE') {
          if (row.status === 'NEEDS_INFORMATION') throw Error('EVIDENCE_REQUIRED');
          status = 'IN_REVIEW';
          // Reviewer records the checked platform/transaction evidence in the reason.
          await tx.query(
            'UPDATE "RefundCase" SET "evidenceReadyAt"=clock_timestamp(),"informationDueAt"=NULL,"reviewRound"="reviewRound"+1 WHERE id=$1',
            [row.id],
          );
        }
      }
      await this.activity(tx, row.id, userId, i.requestId, i.action, i.reason, hash);
      if (['REQUEST_INFORMATION', 'STATUS_UPDATE'].includes(i.action))
        await notifyRefundUpdate(tx, captureId, `refund:activity:${i.requestId}`);
      await tx.query(
        'UPDATE "RefundCase" SET status=$1,version=version+1,"lastStatusAt"=clock_timestamp() WHERE id=$2',
        [status, row.id],
      );
      return { id: row.id, status, version: row.version + 1 };
    });
  }
  async request(userId: string, raw: unknown) {
    const i = requestInput.parse(raw);
    return this.tx(async (tx) => {
      const { c, binding } = await this.capture(tx, i.captureId);
      await this.user(tx, userId);
      if (binding.buyer !== userId) throw Error('FORBIDDEN');
      if (!!i.previousCaseId !== !!i.reviewBasis) throw Error('INVALID_BODY');
      const hash = createHash('sha256').update(JSON.stringify(i)).digest('hex');
      const activity = await tx.query(
        'SELECT * FROM "RefundCaseActivity" WHERE "actorId"=$1 AND "requestId"=$2',
        [userId, i.requestId],
      );
      if (activity.rowCount) {
        if (activity.rows[0].payloadHash !== hash) throw Error('CONFLICT');
        const saved = await tx.query('SELECT id,status,version FROM "RefundCase" WHERE id=$1', [
          activity.rows[0].caseId,
        ]);
        return saved.rows[0];
      }
      const old = await tx.query(
        'SELECT * FROM "RefundCase" WHERE "requesterId"=$1 AND "requestId"=$2',
        [userId, i.requestId],
      );
      if (old.rowCount) {
        const o = old.rows[0];
        if (o.captureId !== i.captureId || o.reason !== i.reason) throw Error('CONFLICT');
        return { id: o.id, status: o.status, version: o.version };
      }
      const all = await tx.query(
        'SELECT * FROM "RefundCase" WHERE "captureId"=$1 ORDER BY "createdAt",id',
        [i.captureId],
      );
      const active = all.rows.find((r) => r.status !== 'REJECTED');
      if (active) {
        if (active.status === 'APPROVED') throw Error('REVIEW_REQUIRED');
        await this.activity(tx, active.id, userId, i.requestId, 'MERGED_REQUEST', i.reason, hash);
        // New information invalidates previous evidence confirmation and votes.
        await tx.query(
          'UPDATE "RefundCase" SET version=version+1,"reviewRound"="reviewRound"+1,"evidenceReadyAt"=NULL WHERE id=$1',
          [active.id],
        );
        return { id: active.id, status: active.status, version: active.version + 1 };
      }
      if (all.rows.length) {
        const previous = all.rows.at(-1);
        if (i.previousCaseId !== previous.id || !i.reviewBasis) throw Error('REOPEN_REQUIRED');
        if (i.reviewBasis === 'EQUIVALENT' && all.rows.some((r) => r.reviewBasis === 'EQUIVALENT'))
          throw Error('REVIEW_LIMIT');
      } else if (i.previousCaseId) throw Error('CONFLICT');
      const id = randomUUID();
      await tx.query(
        'INSERT INTO "RefundCase" (id,"captureId","requesterId","requestId",reason,"amountMinor",currency,"previousCaseId","reviewBasis") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          id,
          i.captureId,
          userId,
          i.requestId,
          i.reason,
          c.amountMinor,
          c.currency,
          i.previousCaseId ?? null,
          i.reviewBasis ?? null,
        ],
      );
      await this.activity(tx, id, userId, i.requestId, 'REQUEST', i.reason, hash);
      return { id, status: 'REQUESTED', version: 0 };
    });
  }
  async decide(userId: string, raw: unknown) {
    const i = decisionInput.parse(raw);
    return this.tx(async (tx) => {
      const first = await tx.query('SELECT "captureId" FROM "RefundCase" WHERE id=$1', [i.caseId]);
      if (!first.rowCount) throw Error('NOT_FOUND');
      const { c } = await this.capture(tx, first.rows[0].captureId);
      const a = await refundAuthority(tx),
        actor = a.actors.find((x) => x.id === userId);
      if (
        !actor?.active ||
        !actor.capabilities.includes('refund.review') ||
        c.participantIds.includes(userId)
      )
        throw Error('FORBIDDEN');
      const p = a.policy;
      if (
        !p.version ||
        p.reviewRulesConfirmed !== true ||
        !Number.isSafeInteger(p.requiredApprovals) ||
        p.requiredApprovals! < 1
      )
        throw Error('POLICY_UNCONFIGURED');
      const row = (await tx.query('SELECT * FROM "RefundCase" WHERE id=$1 FOR UPDATE', [i.caseId]))
        .rows[0];
      const old = await tx.query(
        'SELECT * FROM "RefundDecision" WHERE "reviewerId"=$1 AND "requestId"=$2',
        [userId, i.requestId],
      );
      if (old.rowCount) {
        const o = old.rows[0];
        if (
          o.caseId !== i.caseId ||
          o.reason !== i.reason ||
          o.outcome !== i.outcome ||
          o.expectedVersion !== i.expectedVersion
        )
          throw Error('CONFLICT');
        return { id: row.id, status: row.status, version: row.version };
      }
      if (row.version !== i.expectedVersion || !['REQUESTED', 'IN_REVIEW'].includes(row.status))
        throw Error('CONFLICT');
      if (row.policyVersion && row.policyVersion !== p.version) throw Error('POLICY_CHANGED');
      await this.independentReviewer(tx, row, userId);
      if (i.outcome === 'APPROVE') {
        if (!row.evidenceReadyAt) throw Error('EVIDENCE_REQUIRED');
        await assertRefundUnblocked(tx, first.rows[0].captureId, c);
      }
      if (
        (
          await tx.query(
            'SELECT 1 FROM "RefundDecision" WHERE "caseId"=$1 AND "reviewerId"=$2 AND "reviewRound"=$3',
            [i.caseId, userId, row.reviewRound],
          )
        ).rowCount
      )
        throw Error('CONFLICT');
      await tx.query(
        'INSERT INTO "RefundDecision" (id,"caseId","reviewerId","requestId",outcome,reason,"expectedVersion","policyVersion","reviewRound") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          randomUUID(),
          i.caseId,
          userId,
          i.requestId,
          i.outcome,
          i.reason,
          i.expectedVersion,
          p.version,
          row.reviewRound,
        ],
      );
      const votes = await tx.query(
        'SELECT "reviewerId" FROM "RefundDecision" WHERE "caseId"=$1 AND outcome=$2 AND "reviewRound"=$3',
        [i.caseId, 'APPROVE', row.reviewRound],
      );
      const count = votes.rows.filter((v) =>
        a.actors.some(
          (x) =>
            x.id === v.reviewerId &&
            x.active &&
            x.capabilities.includes('refund.review') &&
            !c.participantIds.includes(x.id),
        ),
      ).length;
      const status =
        i.outcome === 'REJECT'
          ? 'REJECTED'
          : count >= p.requiredApprovals!
            ? 'APPROVED'
            : 'IN_REVIEW';
      await tx.query(
        'UPDATE "RefundCase" SET status=$1,version=version+1,"policyVersion"=$2,"approvedVersion"=CASE WHEN $1=\'APPROVED\' THEN version+1 ELSE NULL END WHERE id=$3',
        [status, p.version, i.caseId],
      );
      await notifyRefundUpdate(tx, first.rows[0].captureId, `refund:decision:${i.requestId}`);
      return { id: row.id, status, version: row.version + 1 };
    });
  }
  async read(userId: string, caseId: string) {
    return this.tx(async (tx) => {
      const r = await tx.query('SELECT * FROM "RefundCase" WHERE id=$1', [caseId]);
      if (!r.rowCount) throw Error('NOT_FOUND');
      const row = r.rows[0];
      const { c } = await this.capture(tx, row.captureId);
      const u = await this.user(tx, userId);
      const publicActivities = (
        await tx.query(
          "SELECT action,reason,\"createdAt\" FROM \"RefundCaseActivity\" WHERE \"caseId\"=$1 AND action IN ('REQUEST','MERGED_REQUEST','REQUEST_INFORMATION','PROVIDE_INFORMATION','STATUS_UPDATE') ORDER BY \"createdAt\",id",
          [caseId],
        )
      ).rows;
      const timing = refundTiming(row);
      const publicDecision =
        (
          await tx.query(
            'SELECT outcome,reason,"createdAt" FROM "RefundDecision" WHERE "caseId"=$1 AND "policyVersion"=$2 AND "reviewRound"=$3 ORDER BY "createdAt" DESC,id DESC LIMIT 1',
            [caseId, approvedRefundPolicy.version, row.reviewRound],
          )
        ).rows[0] ?? null;
      const receipts = (
        await tx.query(
          'SELECT "commandKey" AS reference,"amountMinor" FROM "RefundReceipt" WHERE "captureId"=$1',
          [row.captureId],
        )
      ).rows;
      if (u.id === row.requesterId)
        return {
          id: row.id,
          reason: row.reason,
          status: row.status,
          version: row.version,
          amountMinor: row.amountMinor,
          currency: row.currency,
          canReview: false,
          captureId: row.captureId,
          activities: publicActivities,
          timing,
          receipts,
          publicDecision,
          canReopen: row.status === 'REJECTED',
        };
      const a = await refundAuthority(tx);
      if (
        !a.actors.some(
          (x) =>
            x.id === userId &&
            x.active &&
            (x.capabilities.includes('refund.review') ||
              x.capabilities.includes('payment.reconcile')),
        ) ||
        c.participantIds.includes(userId)
      )
        throw Error('FORBIDDEN');
      return {
        id: row.id,
        reason: row.reason,
        status: row.status,
        version: row.version,
        amountMinor: row.amountMinor,
        currency: row.currency,
        timing,
        receipts,
        // Authorised, non-participant admins need the checked evidence rationale
        // before casting an independent vote. The buyer DTO above stays filtered.
        activities: (
          await tx.query(
            'SELECT action,reason,"createdAt" FROM "RefundCaseActivity" WHERE "caseId"=$1 ORDER BY "createdAt",id',
            [caseId],
          )
        ).rows,
        evidenceReady: !!row.evidenceReadyAt,
        canManage:
          a.actors.some(
            (x) => x.id === userId && x.active && x.capabilities.includes('refund.review'),
          ) &&
          ['REQUESTED', 'IN_REVIEW', 'NEEDS_INFORMATION'].includes(row.status) &&
          !(
            row.previousCaseId &&
            (
              await tx.query(
                'SELECT 1 FROM "RefundDecision" WHERE "caseId"=$1 AND "reviewerId"=$2',
                [row.previousCaseId, userId],
              )
            ).rowCount
          ),
        canReconcile: a.actors.some(
          (x) => x.id === userId && x.active && x.capabilities.includes('payment.reconcile'),
        ),
        blocks: (
          await tx.query(
            'SELECT id,kind,"openedAt" FROM "RefundOperationalBlock" WHERE "scopeKey"=$1 AND ("captureId" IS NULL OR "captureId"=$2) AND "resolvedAt" IS NULL',
            [
              JSON.stringify([c.scope.provider, c.scope.merchant, c.scope.environment]),
              row.captureId,
            ],
          )
        ).rows,
        canReview:
          a.actors.some(
            (x) => x.id === userId && x.active && x.capabilities.includes('refund.review'),
          ) &&
          ['REQUESTED', 'IN_REVIEW'].includes(row.status) &&
          !(
            row.previousCaseId &&
            (
              await tx.query(
                'SELECT 1 FROM "RefundDecision" WHERE "caseId"=$1 AND "reviewerId"=$2',
                [row.previousCaseId, userId],
              )
            ).rowCount
          ) &&
          a.policy.reviewRulesConfirmed === true &&
          !!a.policy.version &&
          Number.isSafeInteger(a.policy.requiredApprovals) &&
          a.policy.requiredApprovals! > 0 &&
          (!row.policyVersion || row.policyVersion === a.policy.version) &&
          !(
            await tx.query(
              'SELECT 1 FROM "RefundDecision" WHERE "caseId"=$1 AND "reviewerId"=$2 AND "reviewRound"=$3',
              [caseId, userId, row.reviewRound],
            )
          ).rowCount,
        decisions: (
          await tx.query(
            'SELECT "reviewerId",outcome,reason,"createdAt" FROM "RefundDecision" WHERE "caseId"=$1 ORDER BY "createdAt",id',
            [caseId],
          )
        ).rows,
      };
    });
  }
}
