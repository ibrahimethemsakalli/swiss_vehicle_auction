import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { refundReconciliation } from '../src/lib/refund-reconciliation';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReconciliationView } from '../src/components/refund-reconciliation';

const url = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/autoveri');
assert.notEqual(process.env.NODE_ENV, 'production');
assert.equal(process.env.LOCAL_TEST_PAYMENTS, 'true');
globalThis.fetch = async () => {
  throw Error('REAL_NETWORK_FORBIDDEN');
};
const demo = JSON.parse(readFileSync('.local/l11-demo.json', 'utf8'));
assert.equal(demo.synthetic, true);
assert.equal(demo.caseId, '084fb584-cf70-4d07-a3d9-aa07bf130ae1');
const pool = new Pool({
  connectionString: url.toString(),
  options: '-c default_transaction_read_only=on',
});
try {
  const capture = (
    await pool.query('SELECT * FROM "RefundCaptureState" WHERE id=$1', [demo.captureId])
  ).rows[0];
  assert.equal(capture.snapshot.scope.provider, 'fake');
  assert.equal(capture.snapshot.scope.environment, 'test');
  const commands = (
    await pool.query('SELECT * FROM "RefundCommandState" WHERE "captureId"=$1', [demo.captureId])
  ).rows;
  const receipts = (
    await pool.query('SELECT * FROM "RefundReceipt" WHERE "captureId"=$1', [demo.captureId])
  ).rows;
  assert.equal(commands.length, 1);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].commandKey, commands[0].key);
  assert.equal(commands[0].caseId, demo.caseId);
  assert.equal(receipts[0].amountMinor, 3000);
  assert.equal(receipts[0].currency, 'CHF');
  const provider = JSON.parse(readFileSync('.local/l11-demo-refund-provider.json', 'utf8'));
  assert.equal(provider.economicRefundCount, 1);
  let matched;
  let matchingReport;
  for (let page = 1; page <= 10000; page++) {
    const report = await refundReconciliation(pool, demo.adminIds[0], page);
    matched = report.rows.find((r) => r.id === demo.captureId);
    if (matched) {
      matchingReport = report;
      break;
    }
    if (!report.more) break;
  }
  assert.ok(matched);
  assert.deepEqual(matched.codes, []);
  assert.deepEqual(matched.totals, {
    captured: '3000',
    refunded: '3000',
    reserved: '0',
    receipts: '3000',
  });
  assert.ok(matchingReport);
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const messages = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    const html = renderToStaticMarkup(
      React.createElement(ReconciliationView, {
        report: matchingReport,
        t: (key) => messages[key],
      }),
    );
    assert.ok(html.includes(demo.captureId));
    assert.ok(html.includes(messages.rcMatched));
    assert.ok(html.includes(messages.rcTest));
    assert.ok(html.includes('30.00 CHF'));
    assert.ok(html.includes('0.00 CHF'));
    assert.ok(!html.includes('role="alert"'));
  }
  const result = {
    at: new Date().toISOString(),
    synthetic: true,
    caseId: demo.caseId,
    captureId: demo.captureId,
    commands: commands.length,
    receipts: receipts.length,
    reference: receipts[0].refundRef,
    commandKey: receipts[0].commandKey,
    totals: matched.totals,
    netMinor: '0',
    findings: matched.codes,
    realApiCalls: 0,
    writes: 0,
    report: matchingReport,
  };
  writeFileSync('.local/l11-demo-ledger-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
