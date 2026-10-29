/** L11: pure snapshots only. The future repository must lock/version the capture atomically. */
export type RefundScope = Readonly<{
  provider: string;
  merchant: string;
  environment: 'test' | 'live';
}>;
export type RefundPolicy = Readonly<{
  version: string;
  reviewRulesConfirmed: boolean;
  partialRefunds: boolean | null;
  requiredApprovals: number | null;
  separateExecutor: boolean | null;
}>;
export type RefundActor = Readonly<{
  id: string;
  active: boolean;
  capabilities: readonly (
    | 'refund.review'
    | 'refund.execute'
    | 'payment.reconcile'
    | 'payment.evidence.import'
  )[];
}>;
export type RefundStatus =
  | 'QUEUED'
  | 'SUBMITTING'
  | 'PENDING'
  | 'UNKNOWN'
  | 'SUCCEEDED'
  | 'FAILED_CONFIRMED'
  | 'CANCELLED_BEFORE_SEND';
export type RefundOperation = Readonly<{
  key: string;
  caseId: string;
  decisionVersion: number;
  policyVersion: string;
  amountMinor: number;
  approvalIds: readonly string[];
  status: RefundStatus;
  refundRef?: string;
}>;
export type RefundCapture = Readonly<{
  scope: RefundScope;
  captureRef: string;
  currency: 'CHF';
  amountMinor: number;
  confirmed: boolean;
  participantIds: readonly string[];
  version: number;
  blocked: boolean;
  operations: readonly RefundOperation[];
  evidence: readonly RefundEvidence[];
  findings: readonly string[];
}>;
export type RefundEvidence = Readonly<{
  scope: RefundScope;
  captureRef: string;
  currency: string;
  amountMinor: number;
  key: string;
  eventId: string;
  refundRef?: string;
  state: 'pending' | 'succeeded' | 'failed' | 'unknown';
  definitiveFailure?: boolean;
}>;
export interface RefundProvider {
  /** Adapter verifies/authenticates evidence; no HTTP/SDK implementation in this module. */
  submit(
    command: Readonly<{
      scope: RefundScope;
      captureRef: string;
      currency: 'CHF';
      amountMinor: number;
      key: string;
    }>,
  ): Promise<RefundEvidence>;
  lookup(scope: RefundScope, key: string): Promise<RefundEvidence | null>;
}
const fail = (message: string): never => {
  throw new Error(message);
};
const money = (n: number) => {
  if (!Number.isSafeInteger(n) || n <= 0) fail('INVALID_AMOUNT');
};
const scopeEqual = (a: RefundScope, b: RefundScope) =>
  a.provider === b.provider && a.merchant === b.merchant && a.environment === b.environment;
function valid(c: RefundCapture) {
  money(c.amountMinor);
  if (
    c.currency !== 'CHF' ||
    !c.captureRef ||
    !c.scope.provider ||
    !c.scope.merchant ||
    !['test', 'live'].includes(c.scope.environment)
  )
    fail('INVALID_CAPTURE');
  if (!Number.isSafeInteger(c.version) || c.version < 0) fail('INVALID_VERSION');
  const keys = new Set<string>(),
    decisions = new Set<string>();
  for (const o of c.operations) {
    money(o.amountMinor);
    const decision = JSON.stringify([o.caseId, o.decisionVersion]);
    if (!o.key || keys.has(o.key) || decisions.has(decision)) fail('INVALID_SNAPSHOT');
    keys.add(o.key);
    decisions.add(decision);
  }
}
function policy(p: RefundPolicy) {
  if (
    !p.version ||
    !p.reviewRulesConfirmed ||
    typeof p.partialRefunds !== 'boolean' ||
    p.requiredApprovals == null ||
    typeof p.separateExecutor !== 'boolean'
  )
    fail('POLICY_UNCONFIGURED');
  if (!Number.isSafeInteger(p.requiredApprovals) || p.requiredApprovals! < 1)
    fail('POLICY_UNCONFIGURED');
}
function allowed(c: RefundCapture, a: RefundActor, capability: 'refund.review' | 'refund.execute') {
  if (!a.id || !a.active || !a.capabilities.includes(capability) || c.participantIds.includes(a.id))
    fail('FORBIDDEN');
}
function ready(c: RefundCapture, p: RefundPolicy) {
  valid(c);
  policy(p);
  if (!c.confirmed) fail('CAPTURE_UNCONFIRMED');
  if (c.blocked || c.findings.length) fail('REVIEW_REQUIRED');
}
function revision(c: RefundCapture, version: number) {
  if (c.version !== version) fail('CONFLICT');
}
function replace(c: RefundCapture, op: RefundOperation): RefundCapture {
  return {
    ...c,
    version: c.version + 1,
    operations: c.operations.map((o) => (o.key === op.key ? op : o)),
  };
}
function operation(c: RefundCapture, key: string) {
  return c.operations.find((o) => o.key === key) ?? fail('NOT_FOUND');
}
export function refundTotals(c: RefundCapture) {
  valid(c);
  let refunded = 0,
    reserved = 0;
  for (const o of c.operations) {
    if (o.status === 'SUCCEEDED') refunded += o.amountMinor;
    else if (!['FAILED_CONFIRMED', 'CANCELLED_BEFORE_SEND'].includes(o.status))
      reserved += o.amountMinor;
    if (!Number.isSafeInteger(refunded + reserved)) fail('AMOUNT_OVERFLOW');
  }
  return { refunded, reserved, remaining: c.amountMinor - refunded - reserved };
}
export function queueRefund(
  c: RefundCapture,
  input: Readonly<{
    key: string;
    caseId: string;
    decisionVersion: number;
    expectedVersion: number;
    amountMinor: number;
    approvals: readonly RefundActor[];
  }>,
  p: RefundPolicy,
): RefundCapture {
  ready(c, p);
  money(input.amountMinor);
  if (
    !input.key ||
    !input.caseId ||
    !Number.isSafeInteger(input.decisionVersion) ||
    input.decisionVersion < 1
  )
    fail('INVALID_COMMAND');
  const ids = input.approvals
    .map((a) => {
      allowed(c, a, 'refund.review');
      return a.id;
    })
    .sort();
  if (new Set(ids).size !== ids.length || ids.length < p.requiredApprovals!)
    fail('APPROVAL_REQUIRED');
  const existing = c.operations.find(
    (o) =>
      o.key === input.key ||
      (o.caseId === input.caseId && o.decisionVersion === input.decisionVersion),
  );
  if (existing) {
    if (
      existing.key !== input.key ||
      existing.caseId !== input.caseId ||
      existing.decisionVersion !== input.decisionVersion ||
      existing.amountMinor !== input.amountMinor ||
      existing.policyVersion !== p.version ||
      JSON.stringify(existing.approvalIds) !== JSON.stringify(ids)
    )
      fail('CONFLICT');
    return c;
  }
  revision(c, input.expectedVersion);
  if (!p.partialRefunds && input.amountMinor !== c.amountMinor) fail('PARTIAL_REFUND_DISABLED');
  if (input.amountMinor > refundTotals(c).remaining) fail('BUDGET_EXCEEDED');
  return {
    ...c,
    version: c.version + 1,
    operations: [
      ...c.operations,
      {
        key: input.key,
        caseId: input.caseId,
        decisionVersion: input.decisionVersion,
        policyVersion: p.version,
        amountMinor: input.amountMinor,
        approvalIds: ids,
        status: 'QUEUED',
      },
    ],
  };
}
export function startRefund(
  c: RefundCapture,
  key: string,
  version: number,
  actor: RefundActor,
  approvals: readonly RefundActor[],
  p: RefundPolicy,
): RefundCapture {
  ready(c, p);
  revision(c, version);
  allowed(c, actor, 'refund.execute');
  const o = operation(c, key);
  if (o.status !== 'QUEUED') fail('INVALID_TRANSITION');
  if (o.policyVersion !== p.version) fail('POLICY_CHANGED');
  if (refundTotals(c).remaining < 0) fail('BUDGET_EXCEEDED');
  for (const id of o.approvalIds)
    allowed(c, approvals.find((a) => a.id === id) ?? fail('APPROVAL_REQUIRED'), 'refund.review');
  if (p.separateExecutor && o.approvalIds.includes(actor.id)) fail('SEPARATE_EXECUTOR_REQUIRED');
  return replace(c, { ...o, status: 'SUBMITTING' });
}
export function cancelUnsentRefund(
  c: RefundCapture,
  key: string,
  version: number,
  actor: RefundActor,
): RefundCapture {
  valid(c);
  revision(c, version);
  allowed(c, actor, 'refund.execute');
  const o = operation(c, key);
  if (o.status !== 'QUEUED') fail('ALREADY_SENT');
  return replace(c, { ...o, status: 'CANCELLED_BEFORE_SEND' });
}
export function markRefundUnknown(c: RefundCapture, key: string): RefundCapture {
  valid(c);
  const o = operation(c, key);
  if (o.status === 'UNKNOWN') return c;
  if (!['SUBMITTING', 'PENDING'].includes(o.status)) fail('INVALID_TRANSITION');
  return replace(c, { ...o, status: 'UNKNOWN' });
}
function evidenceSignature(e: RefundEvidence) {
  return JSON.stringify([
    e.scope.provider,
    e.scope.merchant,
    e.scope.environment,
    e.captureRef,
    e.currency,
    e.amountMinor,
    e.key,
    e.refundRef ?? null,
    e.state,
    e.definitiveFailure === true,
  ]);
}
export function applyRefundEvidence(c: RefundCapture, e: RefundEvidence): RefundCapture {
  valid(c);
  if (!e.eventId) fail('INVALID_EVIDENCE');
  const old = c.evidence.find((x) => scopeEqual(x.scope, e.scope) && x.eventId === e.eventId);
  const issue = (code: string): RefundCapture => ({
    ...c,
    version: c.version + 1,
    blocked: true,
    evidence: [...c.evidence, e],
    findings: [...new Set([...c.findings, code])],
  });
  if (old) return evidenceSignature(old) === evidenceSignature(e) ? c : issue('EVENT_CONFLICT');
  const o = c.operations.find((x) => x.key === e.key);
  if (
    !scopeEqual(c.scope, e.scope) ||
    c.captureRef !== e.captureRef ||
    c.currency !== e.currency ||
    !o ||
    o.amountMinor !== e.amountMinor
  )
    return issue('EVIDENCE_MISMATCH');
  if (e.state === 'succeeded' && !e.refundRef) return issue('MISSING_REFUND_REFERENCE');
  if (
    e.refundRef &&
    ((o.refundRef && o.refundRef !== e.refundRef) ||
      c.operations.some((x) => x.key !== o.key && x.refundRef === e.refundRef))
  )
    return issue('REFUND_REFERENCE_CONFLICT');
  if (['QUEUED', 'CANCELLED_BEFORE_SEND', 'FAILED_CONFIRMED'].includes(o.status))
    return issue('TERMINAL_OR_UNSENT_CONFLICT');
  if (o.status === 'SUCCEEDED' && e.state === 'failed') return issue('TERMINAL_CONFLICT');
  const status: RefundStatus =
    o.status === 'SUCCEEDED'
      ? 'SUCCEEDED'
      : e.state === 'succeeded'
        ? 'SUCCEEDED'
        : e.state === 'failed' && e.definitiveFailure
          ? 'FAILED_CONFIRMED'
          : e.state === 'pending'
            ? 'PENDING'
            : 'UNKNOWN';
  return {
    ...replace(c, { ...o, status, refundRef: e.refundRef ?? o.refundRef }),
    evidence: [...c.evidence, e],
  };
}
/** Call only after SUBMITTING is durably committed by the future repository. No retries here. */
export async function submitRefundOnce(
  c: RefundCapture,
  key: string,
  port: RefundProvider,
): Promise<RefundCapture> {
  valid(c);
  const o = operation(c, key);
  if (c.blocked || c.findings.length || o.status !== 'SUBMITTING') fail('INVALID_TRANSITION');
  let evidence: RefundEvidence;
  try {
    evidence = await port.submit({
      scope: c.scope,
      captureRef: c.captureRef,
      currency: c.currency,
      amountMinor: o.amountMinor,
      key,
    });
  } catch {
    return markRefundUnknown(c, key);
  }
  return applyRefundEvidence(
    c,
    evidence.key === key ? evidence : { ...evidence, captureRef: 'INVALID_COMMAND_RESPONSE' },
  );
}
/** Recovery uses lookup only, including after a process crash. Never silently resubmits. */
export async function recoverRefund(
  c: RefundCapture,
  key: string,
  port: RefundProvider,
): Promise<RefundCapture> {
  valid(c);
  const o = operation(c, key);
  if (!['SUBMITTING', 'PENDING', 'UNKNOWN'].includes(o.status)) fail('INVALID_TRANSITION');
  let evidence: RefundEvidence | null;
  try {
    evidence = await port.lookup(c.scope, key);
  } catch {
    evidence = null;
  }
  return evidence
    ? applyRefundEvidence(
        c,
        evidence.key === key ? evidence : { ...evidence, captureRef: 'INVALID_COMMAND_RESPONSE' },
      )
    : markRefundUnknown(c, key);
}
