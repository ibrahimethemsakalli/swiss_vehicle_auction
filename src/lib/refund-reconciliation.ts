import type { Pool } from 'pg';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
const money = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const op = z.object({
  key: z.string(),
  caseId: z.string(),
  decisionVersion: z.number().int(),
  policyVersion: z.string(),
  amountMinor: money,
  status: z.enum([
    'QUEUED',
    'SUBMITTING',
    'PENDING',
    'UNKNOWN',
    'SUCCEEDED',
    'FAILED_CONFIRMED',
    'CANCELLED_BEFORE_SEND',
  ]),
  refundRef: z.string().optional(),
});
const snapshot = z.object({
  scope: z.object({
    provider: z.string(),
    merchant: z.string(),
    environment: z.enum(['test', 'live']),
  }),
  captureRef: z.string(),
  version: z.number().int(),
  currency: z.literal('CHF'),
  amountMinor: money,
  confirmed: z.boolean(),
  operations: z.array(op),
  findings: z.array(z.string()),
  blocked: z.boolean(),
});
export const findingCodes = [
  'INVALID',
  'IDENTITY',
  'BINDING',
  'COMMAND_MISSING',
  'COMMAND_EXTRA',
  'DECISION',
  'RECEIPT_MISSING',
  'RECEIPT_CONFLICT',
  'DUPLICATE',
  'AUDIT',
  'BUDGET',
  'UNRESOLVED',
  'REVIEW',
] as const;
export type Finding = (typeof findingCodes)[number];
export type EvidenceSet = {
  capture: { id: string; scopeKey: string; captureRef: string; version: number; snapshot: unknown };
  commands: any[];
  receipts: any[];
  cases: any[];
  audit: any;
  binding: any;
  operationallyBlocked?: boolean;
};
export function inspectRefundRecords(e: EvidenceSet) {
  const codes = new Set<Finding>();
  if (e.operationallyBlocked) codes.add('REVIEW');
  const parsed = snapshot.safeParse(e.capture.snapshot);
  if (!parsed.success)
    return {
      id: e.capture.id,
      environment: 'unknown',
      codes: ['INVALID'] as Finding[],
      totals: null,
    };
  const c = parsed.data,
    scope = JSON.stringify([c.scope.provider, c.scope.merchant, c.scope.environment]);
  if (
    scope !== e.capture.scopeKey ||
    c.captureRef !== e.capture.captureRef ||
    c.version !== e.capture.version
  )
    codes.add('IDENTITY');
  const b = e.binding;
  if (
    !b ||
    b.gatewayTransactionId !== c.captureRef ||
    b.gateway !== c.scope.provider ||
    b.currency !== c.currency ||
    !['CAPTURED_FEE', 'CAPTURED_COMPENSATION'].includes(b.status) ||
    String(b.amountMinor) !== String(c.amountMinor)
  )
    codes.add('BINDING');
  if (
    !e.audit ||
    e.audit.version !== c.version ||
    !isDeepStrictEqual(e.audit.snapshot, e.capture.snapshot)
  )
    codes.add('AUDIT');
  let refunded = 0n,
    reserved = 0n,
    receipts = 0n;
  const keys = new Set<string>(),
    refs = new Set<string>();
  for (const o of c.operations) {
    if (keys.has(o.key) || (o.refundRef && refs.has(o.refundRef))) codes.add('DUPLICATE');
    keys.add(o.key);
    if (o.refundRef) refs.add(o.refundRef);
    const cmd = e.commands.find((x) => x.key === o.key);
    if (!cmd) codes.add('COMMAND_MISSING');
    else if (cmd.caseId !== o.caseId || cmd.decisionVersion !== o.decisionVersion)
      codes.add('DECISION');
    const decision = e.cases.find((x) => x.id === o.caseId);
    if (
      !decision ||
      decision.status !== 'APPROVED' ||
      (decision.approvedVersion ?? decision.version) !== o.decisionVersion ||
      decision.policyVersion !== o.policyVersion ||
      decision.amountMinor !== o.amountMinor ||
      decision.currency !== 'CHF'
    )
      codes.add('DECISION');
    if (o.status === 'SUCCEEDED') {
      refunded += BigInt(o.amountMinor);
      if (!e.receipts.some((x) => x.commandKey === o.key)) codes.add('RECEIPT_MISSING');
    } else if (!['FAILED_CONFIRMED', 'CANCELLED_BEFORE_SEND'].includes(o.status))
      reserved += BigInt(o.amountMinor);
    if (['SUBMITTING', 'PENDING', 'UNKNOWN'].includes(o.status)) codes.add('UNRESOLVED');
  }
  for (const cmd of e.commands) if (!keys.has(cmd.key)) codes.add('COMMAND_EXTRA');
  for (const r of e.receipts) {
    if (!Number.isSafeInteger(r.amountMinor) || r.amountMinor <= 0 || r.currency !== 'CHF') {
      codes.add('RECEIPT_CONFLICT');
      continue;
    }
    receipts += BigInt(r.amountMinor);
    const o = c.operations.find((x) => x.key === r.commandKey);
    if (
      !o ||
      o.status !== 'SUCCEEDED' ||
      o.amountMinor !== r.amountMinor ||
      o.refundRef !== r.refundRef ||
      r.scopeKey !== scope
    )
      codes.add('RECEIPT_CONFLICT');
  }
  if (refunded + reserved > BigInt(c.amountMinor) || receipts > BigInt(c.amountMinor))
    codes.add('BUDGET');
  if (c.blocked || c.findings.length || !c.confirmed) codes.add('REVIEW');
  return {
    id: e.capture.id,
    environment: c.scope.environment,
    codes: [...codes],
    totals: {
      captured: c.confirmed ? String(c.amountMinor) : '0',
      refunded: String(refunded),
      reserved: String(reserved),
      receipts: String(receipts),
    },
  };
}
export type ReconciliationReport = {
  rows: ReturnType<typeof inspectRefundRecords>[];
  page: number;
  more: boolean;
  totals: Record<
    string,
    { captured: string; refunded: string; reserved: string; receipts: string }
  >;
  incomplete: boolean;
  asOf: string;
};
export async function refundReconciliation(
  pool: Pool,
  userId: string,
  page: number,
): Promise<ReconciliationReport> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw Error('INVALID_QUERY');
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await tx.query("SET LOCAL statement_timeout='5000ms'");
    const u = (
      await tx.query('SELECT role,"suspendedAt","isSample" FROM "User" WHERE id=$1', [userId])
    ).rows[0];
    const config = (
      await tx.query('SELECT actors FROM "RefundRuntimePolicy" WHERE id=$1', ['active'])
    ).rows[0];
    if (
      !u ||
      u.role !== 'ADMIN' ||
      u.suspendedAt ||
      u.isSample ||
      !Array.isArray(config?.actors) ||
      !config.actors.some(
        (a: any) =>
          a.id === userId &&
          a.active === true &&
          Array.isArray(a.capabilities) &&
          a.capabilities.includes('payment.reconcile'),
      )
    )
      throw Error('FORBIDDEN');
    const captures = (
      await tx.query('SELECT * FROM "RefundCaptureState" ORDER BY id LIMIT 21 OFFSET $1', [
        (page - 1) * 20,
      ])
    ).rows;
    const selected = captures.slice(0, 20),
      ids = selected.map((c) => c.id);
    const commands = (
      await tx.query('SELECT * FROM "RefundCommandState" WHERE "captureId"=ANY($1::text[])', [ids])
    ).rows;
    const receipts = (
      await tx.query('SELECT * FROM "RefundReceipt" WHERE "captureId"=ANY($1::text[])', [ids])
    ).rows;
    const cases = (
      await tx.query(
        'SELECT id,"captureId",status,version,"approvedVersion","policyVersion","amountMinor",currency FROM "RefundCase" WHERE "captureId"=ANY($1::text[])',
        [ids],
      )
    ).rows;
    const audits = (
      await tx.query(
        'SELECT DISTINCT ON ("captureId") "captureId",version,snapshot FROM "RefundStateEvent" WHERE "captureId"=ANY($1::text[]) ORDER BY "captureId",version DESC',
        [ids],
      )
    ).rows;
    const bindings = (
      await tx.query(
        'SELECT b."captureId",h.gateway,h."gatewayTransactionId",h.currency,h.status,(h.amount*100)::bigint::text AS "amountMinor" FROM "RefundCaptureBinding" b JOIN "PaymentHold" h ON h.id=b."holdId" WHERE b."captureId"=ANY($1::text[])',
        [ids],
      )
    ).rows;
    const blocks = (
      await tx.query(
        'SELECT "scopeKey","captureId" FROM "RefundOperationalBlock" WHERE "resolvedAt" IS NULL AND "scopeKey"=ANY($1::text[])',
        [selected.map((c) => c.scopeKey)],
      )
    ).rows;
    const rows = selected.map((c) =>
      inspectRefundRecords({
        capture: c,
        commands: commands.filter((x) => x.captureId === c.id),
        receipts: receipts.filter((x) => x.captureId === c.id),
        cases: cases.filter((x) => x.captureId === c.id),
        audit: audits.find((x) => x.captureId === c.id),
        binding: bindings.find((x) => x.captureId === c.id),
        operationallyBlocked: blocks.some(
          (b) => b.scopeKey === c.scopeKey && (!b.captureId || b.captureId === c.id),
        ),
      }),
    );
    const totals: ReconciliationReport['totals'] = {};
    for (const row of rows)
      if (row.totals) {
        const total = (totals[row.environment] ??= {
          captured: '0',
          refunded: '0',
          reserved: '0',
          receipts: '0',
        });
        for (const k of ['captured', 'refunded', 'reserved', 'receipts'] as const)
          total[k] = String(BigInt(total[k]) + BigInt(row.totals[k]));
      }
    const asOf = (
      await tx.query('SELECT transaction_timestamp() AS now')
    ).rows[0].now.toISOString();
    await tx.query('COMMIT');
    return {
      rows,
      page,
      more: captures.length > 20,
      totals,
      incomplete: rows.some((x) => !x.totals),
      asOf,
    };
  } catch (e) {
    await tx.query('ROLLBACK');
    throw e;
  } finally {
    tx.release();
  }
}
