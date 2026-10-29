import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditLocalLedger, type LedgerInput } from '../src/lib/local-proxy-ledger';
const fixture = (): LedgerInput => ({
  auctions: [{ id: 'a', status: 'COMPLETED', winnerId: 'private-owner' }],
  holds: [
    {
      id: 'h',
      auctionId: 'a',
      ownerId: 'private-owner',
      status: 'CAPTURED',
      amountCents: 3000,
      currency: 'CHF',
      gateway: 'local-proxy',
    },
  ],
  captures: [
    { auctionId: 'a', holdId: 'h', amountCents: 3000, currency: 'CHF', capturedAt: new Date(0) },
  ],
  cases: [{ auctionId: 'a', status: 'APPROVED' }],
  refunds: [{ auctionId: 'a', amountCents: 3000, currency: 'CHF', refundedAt: new Date(1) }],
});
test('ledger preserves totals, deterministic order and private projections', () => {
  const d = fixture(),
    before = structuredClone(d),
    r = auditLocalLedger(d);
  assert.deepEqual([r.captureCents, r.refundCents, r.netCents], ['3000', '3000', '0']);
  assert.equal(r.issues.length, 0);
  assert.equal(r.entries[0].kind, 'REFUND');
  assert.ok(!JSON.stringify(r).includes('private-owner'));
  assert.deepEqual(d, before);
  assert.deepEqual(
    auditLocalLedger({ auctions: [], holds: [], captures: [], cases: [], refunds: [] }).entries,
    [],
  );
});
test('audit detects missing and duplicate records even if uniqueness constraints were lost', () => {
  const d = fixture();
  d.captures.push({ ...d.captures[0] });
  d.refunds.push({ ...d.refunds[0] });
  d.holds.push({ ...d.holds[0], id: 'other' });
  d.auctions.push({ id: 'missing', status: 'COMPLETED', winnerId: null });
  d.cases.push({ auctionId: 'missing', status: 'APPROVED' });
  const r = auditLocalLedger(d),
    codes = r.issues.flatMap((i) => i.issues);
  for (const c of [
    'DUPLICATE_CAPTURE',
    'DUPLICATE_REFUND',
    'MULTIPLE_CAPTURED_HOLDS',
    'UNLINKED_CAPTURED_HOLD',
    'MISSING_CAPTURE',
    'MISSING_REFUND',
  ])
    assert.ok(codes.includes(c), c);
  assert.equal(r.captureCents, '6000');
  assert.equal(r.refundCents, '6000');
});
test('audit flags mismatches, orphan records and excludes non-CHF from totals', () => {
  const d = fixture();
  d.auctions[0].status = 'CANCELLED';
  d.captures[0].currency = 'EUR';
  d.holds[0].ownerId = 'wrong';
  d.cases[0].status = 'REJECTED';
  d.refunds[0].amountCents = 4000;
  d.refunds.push({
    auctionId: 'orphan',
    amountCents: 3000,
    currency: 'CHF',
    refundedAt: new Date(),
  });
  const r = auditLocalLedger(d),
    codes = r.issues.flatMap((i) => i.issues);
  for (const c of [
    'UNEXPECTED_CAPTURE',
    'INVALID_CAPTURE',
    'CAPTURE_HOLD_MISMATCH',
    'UNEXPECTED_REFUND',
    'INVALID_REFUND',
    'ORPHAN_RECORD',
  ])
    assert.ok(codes.includes(c), c);
  assert.equal(r.captureCents, '0');
  assert.equal(r.refundCents, '7000');
  assert.equal(r.netCents, '-7000');
  assert.equal(r.excludedCurrencyCount, 1);
});
test('all ledger labels and findings exist in all four languages', () => {
  const de = JSON.parse(readFileSync('src/messages/de.json', 'utf8'));
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const d = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const k of Object.keys(de).filter((k) => k.startsWith('ll')))
      assert.ok(d[k], `${lang}:${k}`);
  }
});
