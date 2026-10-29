import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  inspectRefundRecords,
  findingCodes,
  type EvidenceSet,
} from '../src/lib/refund-reconciliation';
import { reconciliationHandlers } from '../src/lib/refund-reconciliation-http';
import { ReconciliationView } from '../src/components/refund-reconciliation';
function fixture(): EvidenceSet {
  const scopeKey = '["fake","account","test"]';
  const snapshot = {
    scope: { provider: 'fake', merchant: 'account', environment: 'test' },
    captureRef: 'capture',
    version: 3,
    currency: 'CHF',
    amountMinor: 3000,
    confirmed: true,
    blocked: false,
    findings: [],
    operations: [
      {
        key: 'key',
        caseId: 'case',
        decisionVersion: 1,
        policyVersion: 'test',
        amountMinor: 3000,
        status: 'SUCCEEDED',
        refundRef: 'refund',
      },
    ],
  };
  return {
    capture: { id: 'id', scopeKey, captureRef: 'capture', version: 3, snapshot },
    commands: [{ key: 'key', caseId: 'case', decisionVersion: 1 }],
    receipts: [
      { scopeKey, refundRef: 'refund', commandKey: 'key', amountMinor: 3000, currency: 'CHF' },
    ],
    cases: [
      {
        id: 'case',
        status: 'APPROVED',
        version: 1,
        policyVersion: 'test',
        amountMinor: 3000,
        currency: 'CHF',
      },
    ],
    audit: { version: 3, snapshot: structuredClone(snapshot) },
    binding: {
      gateway: 'fake',
      gatewayTransactionId: 'capture',
      currency: 'CHF',
      status: 'CAPTURED_FEE',
      amountMinor: '3000',
    },
  };
}
test('consistent local records and integer totals; inputs unchanged', () => {
  const f = fixture(),
    before = structuredClone(f),
    r = inspectRefundRecords(f);
  assert.deepEqual(r.codes, []);
  assert.deepEqual(r.totals, {
    captured: '3000',
    refunded: '3000',
    reserved: '0',
    receipts: '3000',
  });
  assert.deepEqual(f, before);
});
test('missing relations and mismatched receipts, scope and audit are explicit', () => {
  for (const [field, code] of [
    ['commands', 'COMMAND_MISSING'],
    ['receipts', 'RECEIPT_MISSING'],
    ['cases', 'DECISION'],
  ] as const) {
    const f = fixture();
    f[field] = [];
    assert.ok(inspectRefundRecords(f).codes.includes(code));
  }
  const f = fixture();
  f.binding = null;
  f.audit = null;
  f.capture.scopeKey = 'other';
  f.receipts[0].amountMinor = 2999;
  f.commands.push({ key: 'orphan' });
  const codes = inspectRefundRecords(f).codes;
  for (const code of ['BINDING', 'AUDIT', 'IDENTITY', 'RECEIPT_CONFLICT', 'COMMAND_EXTRA'] as const)
    assert.ok(codes.includes(code));
});
test('invalid snapshots excluded; duplicate budget and unresolved outcomes detected without timeout policy', () => {
  const bad = fixture();
  bad.capture.snapshot = {};
  assert.equal(inspectRefundRecords(bad).totals, null);
  const f = fixture(),
    c = f.capture.snapshot as any;
  c.operations.push({ ...c.operations[0] });
  assert.ok(inspectRefundRecords(f).codes.includes('DUPLICATE'));
  assert.ok(inspectRefundRecords(f).codes.includes('BUDGET'));
  c.operations = [{ ...c.operations[0], status: 'UNKNOWN' }];
  c.blocked = true;
  const r = inspectRefundRecords(f);
  assert.ok(r.codes.includes('UNRESOLVED'));
  assert.ok(r.codes.includes('REVIEW'));
  assert.equal(r.totals?.reserved, '3000');
});
test('HTTP only reads: authentication, pagination, cache and error redaction', async () => {
  let calls = 0;
  const h = reconciliationHandlers(
    async (id, page) => {
      calls++;
      assert.equal(id, 'session');
      return { page };
    },
    async () => 'session',
  );
  const response = await h.GET(new Request('http://local/api?page=2'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await h.POST()).status, 405);
  assert.equal(calls, 1);
  for (const q of ['page=0', 'page=1&page=2', 'userId=other', 'page=10001'])
    assert.equal((await h.GET(new Request('http://local/api?' + q))).status, 400);
  const denied = reconciliationHandlers(
    async () => {
      throw Error('password SECRET');
    },
    async () => 'session',
  );
  const error = await denied.GET(new Request('http://local/api'));
  assert.equal(error.status, 503);
  assert.ok(!(await error.text()).includes('SECRET'));
  const guest = reconciliationHandlers(
    async () => {},
    async () => {
      throw Error('UNAUTHORIZED');
    },
  );
  assert.equal((await guest.GET(new Request('http://local/api'))).status, 401);
});
test('all finding labels and read-only scope render in four languages', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const messages = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    const t = (k: string) => {
      assert.equal(typeof messages[k], 'string', k);
      return messages[k];
    };
    const html = renderToStaticMarkup(
      React.createElement(ReconciliationView, {
        t,
        report: {
          rows: [{ id: '<script>', environment: 'test', codes: [...findingCodes], totals: null }],
          page: 1,
          more: false,
          totals: {
            test: { captured: '3000', refunded: '3000', reserved: '0', receipts: '3000' },
            live: { captured: '0', refunded: '0', reserved: '0', receipts: '0' },
          },
          incomplete: true,
          asOf: '2026-10-29T00:00:00Z',
        },
      }),
    );
    assert.ok(html.includes(messages.rcPageTotals));
    assert.ok(html.includes(messages.rcIncomplete));
    assert.ok(html.includes('30.00 CHF'));
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<button'));
  }
});
