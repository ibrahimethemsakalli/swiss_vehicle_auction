import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  filterLedger,
  ledgerCsv,
  ledgerCsvCell,
  validLedgerDates,
  type LedgerReport,
  type LedgerCsvLabels,
} from '../src/lib/local-proxy-ledger-export';
const report: LedgerReport = {
  checkedAt: '2026-10-28T12:00:00.000Z',
  auctionCount: 2,
  captureCount: 2,
  refundCount: 1,
  captureCents: '3000',
  refundCents: '3000',
  netCents: '0',
  excludedCurrencyCount: 1,
  issues: [
    { auctionId: 'a', issues: ['MISSING_REFUND'] },
    { auctionId: 'no-entry', issues: ['MISSING_CAPTURE'] },
  ],
  entries: [
    {
      auctionId: 'a',
      kind: 'CAPTURE',
      amountCents: 3000,
      currency: 'CHF',
      at: '2026-10-27T23:59:59.999Z',
    },
    {
      auctionId: 'a',
      kind: 'REFUND',
      amountCents: 3000,
      currency: 'CHF',
      at: '2026-10-28T00:00:00.000Z',
    },
    {
      auctionId: 'b',
      kind: 'CAPTURE',
      amountCents: 3000,
      currency: 'EUR',
      at: '2026-10-28T23:59:59.999Z',
    },
  ],
};
const all = { from: '', to: '', onlyIssues: false };
test('UTC inclusive boundaries, open bounds, flagged selection and totals use the same rows without changing the audit', () => {
  const before = structuredClone(report);
  const day = filterLedger(report, { ...all, from: '2026-10-28', to: '2026-10-28' });
  assert.equal(day.entries.length, 2);
  assert.deepEqual(
    [day.captureCents, day.refundCents, day.netCents, day.excludedCurrencyCount],
    ['0', '3000', '-3000', 1],
  );
  assert.equal(filterLedger(report, { ...all, to: '2026-10-27' }).entries.length, 1);
  assert.equal(filterLedger(report, { ...all, from: '2026-10-29' }).entries.length, 0);
  assert.equal(filterLedger(report, { ...all, onlyIssues: true }).entries.length, 2);
  assert.equal(filterLedger(report, all).entries.length, 3);
  assert.deepEqual(report, before);
});
test('invalid or inverted dates fail closed, including normalized non-calendar dates', () => {
  for (const from of [
    '2026-02-29',
    '2026-04-31',
    '0000-01-01',
    '26-01-01',
    '2026-1-1',
    '2026-10-28T12:00:00Z',
    'garbage',
  ]) {
    assert.equal(validLedgerDates({ ...all, from }), false, from);
    assert.throws(() => filterLedger(report, { ...all, from }), /INVALID_LEDGER_DATES/);
  }
  assert.equal(validLedgerDates({ ...all, from: '2028-02-29' }), true);
  assert.equal(validLedgerDates({ ...all, from: '2026-10-29', to: '2026-10-28' }), false);
});
test('CSV cells neutralize formula prefixes and controls and escape quotes and delimiters', () => {
  for (const v of ['=1+1', '+CMD', '-1+1', '@SUM(1)', ' \t=1', '\r\n@evil', '\uFEFF=1'])
    assert.ok(ledgerCsvCell(v).startsWith('"\''), v);
  assert.equal(ledgerCsvCell('a,"b"\nnext'), '"a,""b"" next"');
  assert.equal(ledgerCsvCell('normal'), '"normal"');
});
test('four-language CSV exports only allowlisted filtered fields with scope, exact decimals and UTF-8 BOM', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const m = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    const keys = {
      title: 'llTitle',
      scope: 'ljCsvScope',
      checked: 'llChecked',
      from: 'ljFrom',
      to: 'ljTo',
      all: 'ljAll',
      onlyIssues: 'ljOnlyIssues',
      yes: 'ljYes',
      no: 'ljNo',
      captured: 'llCaptured',
      refunded: 'llRefunded',
      net: 'llNet',
      excluded: 'llExcluded',
      auction: 'ljAuction',
      kind: 'ljKind',
      amount: 'ljAmount',
      currency: 'ljCurrency',
      at: 'ljAt',
    };
    const labels = Object.fromEntries(
      Object.entries(keys).map(([k, v]) => {
        assert.ok(m[v], `${lang}:${v}`);
        return [k, m[v]];
      }),
    ) as LedgerCsvLabels;
    for (const k of ['ljDownload', 'ljClear', 'ljDatesError', 'ljScope', 'ljTotals'])
      assert.ok(m[k]);
    const input = {
      ...report,
      secret: 'PRIVATE_REASON',
      entries: report.entries.map((e) => ({
        ...e,
        ownerId: 'PRIVATE_OWNER',
        maximum: 'PRIVATE_LIMIT',
      })),
    };
    const csv = ledgerCsv(
      input,
      { from: '2026-10-28', to: '2026-10-28', onlyIssues: true },
      labels,
    );
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes(m.ljCsvScope));
    assert.ok(csv.includes('"30.00","CHF"'));
    assert.ok(csv.includes('"\'-30.00","CHF"'));
    assert.ok(!csv.includes('PRIVATE_'));
    assert.ok(!csv.includes('2026-10-27T23:59'));
    assert.ok(!csv.includes('EUR'));
    assert.ok(!csv.includes('MISSING_CAPTURE'));
    assert.ok(csv.endsWith('\r\n'));
    assert.throws(() => ledgerCsv(input, { ...all, from: 'invalid' }, labels));
    const empty = ledgerCsv(input, { ...all, from: '2026-10-29' }, labels);
    assert.ok(empty.includes('"0.00","CHF"'));
  }
});
