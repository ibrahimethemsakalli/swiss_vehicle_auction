import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RefundPanel } from '../src/components/refunds';
import { ReconciliationView } from '../src/components/refund-reconciliation';
import { informationDeadline, refundTiming } from '../src/lib/refund-policy';

test('calendar days cross month/DST without inventing a business calendar or auto-rejection', () => {
  assert.equal(
    informationDeadline(new Date('2026-10-25T12:00:00Z')).toISOString(),
    '2026-11-04T12:00:00.000Z',
  );
  const timing = refundTiming(
    { informationDueAt: '2026-01-01T00:00:00Z' },
    new Date('2026-10-29T00:00:00Z'),
  );
  assert.equal(timing.informationOverdue, true);
  assert.equal(timing.automaticRejection, false);
  assert.equal(timing.decisionDueAt, null);
  assert.equal(timing.businessCalendar, null);
  assert.equal(timing.retention, null);
});
test('changed workflow controls and policy messages render in all four languages', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const messages = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    const t = (key: string) => {
      assert.equal(typeof messages[key], 'string', `${lang}:${key}`);
      return messages[key];
    };
    const props = {
      admin: false,
      t,
      data: { cases: [], captures: [], more: false, policyReady: true },
      detail: {
        id: 'case',
        reason: '<proof>',
        status: 'NEEDS_INFORMATION',
        version: 1,
        amountMinor: 3000,
        currency: 'CHF',
        timing: { informationDueAt: '2026-10-29T12:00:00Z', informationOverdue: true },
        activities: [{ action: 'REQUEST_INFORMATION', reason: '<reference>', createdAt: '' }],
      },
      reason: '',
      capture: '',
      outcome: 'PROVIDE_INFORMATION',
      busy: false,
      error: '',
      stale: false,
      page: 1,
      setReason: () => {},
      setCapture: () => {},
      setOutcome: () => {},
      open: () => {},
      turn: () => {},
      submit: () => {},
    };
    const waiting = renderToStaticMarkup(React.createElement(RefundPanel, props));
    assert.ok(waiting.includes(messages.rfInformationReminder));
    assert.ok(waiting.includes(messages.rfApprovedPolicy));
    assert.ok(waiting.includes('&lt;reference&gt;'));
    assert.ok(waiting.includes('<form'));
    assert.ok(!waiting.includes('<select')); // responding requires no new payment selection
    const reopen = renderToStaticMarkup(
      React.createElement(RefundPanel, {
        ...props,
        outcome: 'EQUIVALENT',
        detail: { ...props.detail, status: 'REJECTED', canReopen: true },
      }),
    );
    assert.ok(reopen.includes('value="NEW_EVIDENCE"'));
    assert.ok(reopen.includes('value="ERROR"'));
    const admin = renderToStaticMarkup(
      React.createElement(RefundPanel, {
        ...props,
        admin: true,
        outcome: 'APPROVE',
        detail: {
          ...props.detail,
          status: 'IN_REVIEW',
          canManage: true,
          canReview: true,
          canReconcile: true,
          evidenceReady: false,
          blocks: [{ id: 'block', kind: 'CHARGEBACK' }],
        },
      }),
    );
    assert.match(admin, /<option value="APPROVE" disabled=""/);
    assert.ok(admin.includes('value="RESOLVE_BLOCK:block"'));
    assert.ok(admin.includes(messages.rfEvidenceRequired));
    assert.ok(admin.includes('w-full min-w-0'));
    assert.ok(admin.includes(messages.rfBlocked));
    const report = renderToStaticMarkup(
      React.createElement(ReconciliationView, {
        t,
        report: {
          rows: [],
          page: 1,
          more: false,
          totals: {},
          incomplete: false,
          asOf: '2026-10-29T00:00:00Z',
        },
      }),
    );
    assert.ok(report.includes(messages.rfOpsTargets));
  }
});
