import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RefundPanel } from '../src/components/refunds';
test('four languages render buyer/admin states, escaped reasons and blocked decision controls', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const messages = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    const t = (k: string) => {
      assert.equal(typeof messages[k], 'string', `${lang}:${k}`);
      return messages[k];
    };
    const props = {
      admin: false,
      t,
      data: { cases: [], captures: [], more: false, policyReady: false },
      detail: null,
      reason: '',
      capture: '',
      outcome: 'APPROVE',
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
    const buyer = renderToStaticMarkup(React.createElement(RefundPanel, props));
    assert.ok(buyer.includes(messages.rfTitle));
    assert.ok(buyer.includes('maxLength="2000"'));
    assert.ok(buyer.includes('w-full min-w-0'));
    for (const status of ['REQUESTED', 'IN_REVIEW', 'APPROVED', 'REJECTED']) {
      const html = renderToStaticMarkup(
        React.createElement(RefundPanel, {
          ...props,
          admin: true,
          error: 'CONFLICT',
          stale: true,
          detail: {
            id: 'test',
            reason: '<script>alert(1)</script>',
            status,
            version: 1,
            amountMinor: 3000,
            currency: 'CHF',
            canReview: false,
            decisions: [],
          },
        }),
      );
      assert.ok(html.includes(messages.rfNoMoney));
      assert.ok(html.includes('&lt;script&gt;'));
      assert.ok(!html.includes('<script>'));
      assert.match(html, /<button[^>]*disabled=""[^>]*>/);
      assert.ok(html.includes(messages.rfSave));
    }
  }
});
