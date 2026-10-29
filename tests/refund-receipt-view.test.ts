import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RefundPanel } from '../src/components/refunds';

test('review approval remains distinct from the confirmed receipt in all four languages', () => {
  const expected = {
    de: 'Prüfung genehmigt',
    fr: 'Examen approuvé',
    it: 'Revisione approvata',
    en: 'Review approved',
  };
  for (const [lang, label] of Object.entries(expected)) {
    const messages = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    assert.equal(messages.rfApproved, label);
    const item = {
      id: 'case',
      reason: 'Synthetic request',
      status: 'APPROVED',
      version: 3,
      amountMinor: 3000,
      currency: 'CHF',
    };
    const props = {
      admin: false,
      t: (key: string) => messages[key],
      data: { cases: [item], captures: [], more: false, policyReady: true },
      detail: null,
      reason: '',
      capture: '',
      outcome: '',
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
    const list = renderToStaticMarkup(React.createElement(RefundPanel, props));
    assert.ok(list.includes(label));
    assert.ok(!list.includes(messages.rfReceipt));
    const pending = renderToStaticMarkup(
      React.createElement(RefundPanel, { ...props, detail: item }),
    );
    assert.ok(!pending.includes(messages.rfReceipt));
    const completed = renderToStaticMarkup(
      React.createElement(RefundPanel, {
        ...props,
        detail: { ...item, receipts: [{ reference: 'synthetic-receipt', amountMinor: 3000 }] },
      }),
    );
    assert.ok(completed.includes(label));
    assert.ok(completed.includes(messages.rfReceipt));
    assert.ok(completed.includes('CHF 30.00'));
    assert.equal(completed.split('synthetic-receipt').length - 1, 1);
  }
});
