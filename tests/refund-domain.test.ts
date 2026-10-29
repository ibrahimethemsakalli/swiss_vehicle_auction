import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  queueRefund,
  startRefund,
  cancelUnsentRefund,
  applyRefundEvidence,
  refundTotals,
  submitRefundOnce,
  recoverRefund,
  type RefundCapture,
  type RefundPolicy,
  type RefundActor,
  type RefundEvidence,
  type RefundProvider,
} from '../src/lib/refund-domain';

// Explicit synthetic policies: these are not approved production policy defaults.
const policy: RefundPolicy = {
  version: 'TEST-ONLY',
  reviewRulesConfirmed: true,
  partialRefunds: false,
  requiredApprovals: 1,
  separateExecutor: true,
};
const reviewer: RefundActor = { id: 'reviewer', active: true, capabilities: ['refund.review'] };
const executor: RefundActor = { id: 'executor', active: true, capabilities: ['refund.execute'] };
function capture(): RefundCapture {
  return {
    scope: { provider: 'fake', merchant: 'fixture', environment: 'test' },
    captureRef: 'capture',
    currency: 'CHF',
    amountMinor: 3000,
    confirmed: true,
    participantIds: ['buyer', 'seller'],
    version: 0,
    blocked: false,
    operations: [],
    evidence: [],
    findings: [],
  };
}
const input = {
  key: 'command',
  caseId: 'case',
  decisionVersion: 1,
  expectedVersion: 0,
  amountMinor: 3000,
  approvals: [reviewer],
};
function queued() {
  return queueRefund(capture(), input, policy);
}
function started() {
  return startRefund(queued(), input.key, 1, executor, [reviewer], policy);
}
function evidence(patch: Partial<RefundEvidence> = {}): RefundEvidence {
  return {
    scope: capture().scope,
    captureRef: 'capture',
    currency: 'CHF',
    amountMinor: 3000,
    key: 'command',
    eventId: 'event',
    refundRef: 'refund',
    state: 'succeeded',
    ...patch,
  };
}
class FakeProvider implements RefundProvider {
  submissions = 0;
  lookups = 0;
  loseReply = false;
  lookupFails = false;
  result: RefundEvidence | null = null;
  async submit(command: Parameters<RefundProvider['submit']>[0]) {
    this.submissions++;
    assert.deepEqual(command, {
      scope: capture().scope,
      captureRef: 'capture',
      currency: 'CHF',
      amountMinor: 3000,
      key: 'command',
    });
    this.result = evidence();
    if (this.loseReply) throw new Error('timeout after accepted');
    return this.result;
  }
  async lookup(scope: Parameters<RefundProvider['lookup']>[0], key: string) {
    this.lookups++;
    assert.deepEqual(scope, capture().scope);
    assert.equal(key, 'command');
    if (this.lookupFails) throw new Error('unavailable');
    return this.result;
  }
}
test('unconfigured policy cannot queue funds; no production defaults', () => {
  for (const patch of [
    { reviewRulesConfirmed: false },
    { partialRefunds: null },
    { requiredApprovals: null },
    { separateExecutor: null },
    { version: '' },
    { requiredApprovals: 0 },
  ])
    assert.throws(
      () => queueRefund(capture(), input, { ...policy, ...patch }),
      /POLICY_UNCONFIGURED/,
    );
  assert.throws(
    () => queueRefund({ ...capture(), confirmed: false }, input, policy),
    /CAPTURE_UNCONFIRMED/,
  );
  assert.throws(
    () => queueRefund({ ...capture(), blocked: true }, input, policy),
    /REVIEW_REQUIRED/,
  );
});
test('ownership, capability, revoked approval and separation enforced', () => {
  for (const a of [
    { ...reviewer, id: 'buyer' },
    { ...reviewer, active: false },
    { ...reviewer, capabilities: [] },
  ])
    assert.throws(() => queueRefund(capture(), { ...input, approvals: [a] }, policy), /FORBIDDEN/);
  assert.throws(
    () => startRefund(queued(), 'command', 1, executor, [{ ...reviewer, active: false }], policy),
    /FORBIDDEN/,
  );
  assert.throws(
    () => startRefund(queued(), 'command', 1, { ...executor, id: reviewer.id }, [reviewer], policy),
    /SEPARATE_EXECUTOR_REQUIRED/,
  );
  assert.throws(
    () =>
      startRefund(queued(), 'command', 1, executor, [reviewer], { ...policy, version: 'changed' }),
    /POLICY_CHANGED/,
  );
  assert.throws(
    () =>
      queueRefund(
        capture(),
        { ...input, approvals: [reviewer, reviewer] },
        { ...policy, requiredApprovals: 2 },
      ),
    /APPROVAL_REQUIRED/,
  );
});
test('reservation, version, replay and conflicting payload are immutable', () => {
  const original = capture(),
    q = queueRefund(original, input, policy);
  assert.equal(original.operations.length, 0);
  assert.deepEqual(refundTotals(q), { refunded: 0, reserved: 3000, remaining: 0 });
  assert.equal(queueRefund(q, input, policy), q);
  assert.throws(() => queueRefund(q, { ...input, amountMinor: 2000 }, policy), /CONFLICT/);
  assert.throws(() => queueRefund(q, { ...input, key: 'different' }, policy), /CONFLICT/);
  assert.throws(
    () => queueRefund(q, { ...input, key: 'second', caseId: 'second' }, policy),
    /CONFLICT/,
  );
  assert.throws(
    () => queueRefund(q, { ...input, key: 'second', caseId: 'second', expectedVersion: 1 }, policy),
    /BUDGET_EXCEEDED/,
  );
});
test('amounts and explicit partial policy; sequential shared budget', () => {
  for (const n of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => queueRefund(capture(), { ...input, amountMinor: n }, policy),
      /INVALID_AMOUNT/,
    );
  assert.throws(
    () => queueRefund(capture(), { ...input, amountMinor: 1000 }, policy),
    /PARTIAL_REFUND_DISABLED/,
  );
  const partial = { ...policy, partialRefunds: true };
  const q = queueRefund(capture(), { ...input, amountMinor: 2000 }, partial);
  assert.throws(
    () =>
      queueRefund(
        q,
        { ...input, key: 'two', caseId: 'two', expectedVersion: 1, amountMinor: 1001 },
        partial,
      ),
    /BUDGET_EXCEEDED/,
  );
});
test('unsent cancellation frees budget; sent cancellation forbidden', () => {
  const c = cancelUnsentRefund(queued(), 'command', 1, executor);
  assert.equal(refundTotals(c).remaining, 3000);
  assert.throws(() => cancelUnsentRefund(started(), 'command', 2, executor), /ALREADY_SENT/);
});
test('lost submit response recovers by lookup without another submit', async () => {
  const port = new FakeProvider();
  port.loseReply = true;
  const unknown = await submitRefundOnce(started(), 'command', port);
  assert.equal(unknown.operations[0].status, 'UNKNOWN');
  assert.equal(refundTotals(unknown).reserved, 3000);
  assert.equal((await recoverRefund(unknown, 'command', port)).operations[0].status, 'SUCCEEDED');
  assert.equal(port.submissions, 1);
  assert.equal(port.lookups, 1);
  await assert.rejects(submitRefundOnce(unknown, 'command', port), /INVALID_TRANSITION/);
});
test('crash recovery and missing lookup remain reserved without resubmit', async () => {
  const port = new FakeProvider();
  let c = await recoverRefund(started(), 'command', port);
  assert.equal(c.operations[0].status, 'UNKNOWN');
  port.lookupFails = true;
  c = await recoverRefund(c, 'command', port);
  assert.equal(refundTotals(c).reserved, 3000);
  assert.equal(port.submissions, 0);
});
test('fake contract success is idempotent and stale events do not regress', async () => {
  const port = new FakeProvider(),
    c = await submitRefundOnce(started(), 'command', port);
  assert.deepEqual(refundTotals(c), { refunded: 3000, reserved: 0, remaining: 0 });
  assert.equal(applyRefundEvidence(c, evidence()), c);
  const late = applyRefundEvidence(c, evidence({ eventId: 'late', state: 'pending' }));
  assert.equal(late.operations[0].status, 'SUCCEEDED');
  assert.equal(refundTotals(late).refunded, 3000);
  assert.equal(
    applyRefundEvidence(
      late,
      evidence({ eventId: 'failure', state: 'failed', definitiveFailure: true }),
    ).blocked,
    true,
  );
});
test('wrong scope, capture, currency, amount and event collision block operations', () => {
  for (const patch of [
    { scope: { ...capture().scope, environment: 'live' as const } },
    { scope: { ...capture().scope, merchant: 'other' } },
    { captureRef: 'other' },
    { currency: 'EUR' },
    { amountMinor: 2999 },
    { key: 'other' },
    { refundRef: undefined },
  ]) {
    const c = applyRefundEvidence(started(), evidence(patch));
    assert.equal(c.blocked, true);
    assert.equal(refundTotals(c).reserved, 3000);
  }
  const c = applyRefundEvidence(started(), evidence());
  assert.ok(
    applyRefundEvidence(c, evidence({ amountMinor: 2999 })).findings.includes('EVENT_CONFLICT'),
  );
});
test('only confirmed failure frees budget; late success remains a review finding', () => {
  const u = applyRefundEvidence(started(), evidence({ state: 'failed' }));
  assert.equal(u.operations[0].status, 'UNKNOWN');
  assert.equal(refundTotals(u).reserved, 3000);
  const f = applyRefundEvidence(
    u,
    evidence({ eventId: 'definite', state: 'failed', definitiveFailure: true }),
  );
  assert.equal(refundTotals(f).remaining, 3000);
  const late = applyRefundEvidence(f, evidence({ eventId: 'unexpected-success' }));
  assert.equal(late.blocked, true);
  assert.equal(late.evidence.at(-1)?.state, 'succeeded');
});
test('different refund reference never counts as a second successful application', () => {
  const c = applyRefundEvidence(started(), evidence());
  const mismatch = applyRefundEvidence(
    c,
    evidence({ eventId: 'another', refundRef: 'refund-two' }),
  );
  assert.equal(mismatch.blocked, true);
  assert.equal(refundTotals(mismatch).refunded, 3000);
});
