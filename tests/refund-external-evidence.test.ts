import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { previewSyntheticEvidence as preview } from '../src/lib/refund-external-evidence';
const fixture = () => JSON.parse(readFileSync('tests/fixtures/l11-external-evidence.json', 'utf8'));
test('complete synthetic batch stages immutable-input events but is never authentic evidence', () => {
  const f = fixture(),
    original = structuredClone(f),
    r = preview(f.manifest, f.pages);
  assert.equal(r.status, 'COMPLETE_SYNTHETIC');
  assert.equal(r.authentic, false);
  assert.equal(r.uniqueEvents, 2);
  assert.equal(r.stagedEvents.length, 2);
  assert.match(r.contentHash!, /^[a-f0-9]{64}$/);
  assert.deepEqual(r.totals, {
    currency: 'CHF',
    creditsMinor: '3000',
    debitsMinor: '3000',
    netMinor: '0',
    calculatedClosingMinor: '100',
  });
  assert.deepEqual(f, original);
});
test('missing pages, premature end, loops and disconnected cursors never complete', () => {
  const f = fixture();
  const partial = preview(f.manifest, [f.pages[0]]);
  assert.equal(partial.status, 'INCOMPLETE');
  assert.equal(partial.totalsScope, 'PARTIAL_WINDOW');
  assert.ok(!partial.findings.includes('BALANCE_MISMATCH'));
  for (const mutate of [
    (x: any) => (x.pages[0].nextCursor = null),
    (x: any) => (x.pages[1].cursor = 'wrong'),
    (x: any) => (x.pages[1].nextCursor = 'next-page'),
    (x: any) => (x.pages[1].number = 3),
  ]) {
    const x = fixture();
    mutate(x);
    const r = preview(x.manifest, x.pages);
    assert.ok(r.findings.includes('CURSOR_CHAIN'));
    assert.equal(r.stagedEvents.length, 0);
  }
});
test('exact replay and shuffled pages are idempotent; conflicting page rejected', () => {
  const f = fixture(),
    r = preview(f.manifest, f.pages);
  assert.equal(
    preview(f.manifest, [f.pages[1], f.pages[0], f.pages[0]]).contentHash,
    r.contentHash,
  );
  const changed = structuredClone(f.pages[0]);
  changed.events[0].amountMinor = '2999';
  assert.equal(preview(f.manifest, [...f.pages, changed]).status, 'REJECTED');
});
test('overlapping identical events deduplicate, changed event and economic duplicates reject', () => {
  const f = fixture();
  f.pages[1].events.push(structuredClone(f.pages[0].events[0]));
  assert.equal(preview(f.manifest, f.pages).uniqueEvents, 2);
  assert.equal(preview(f.manifest, f.pages).status, 'COMPLETE_SYNTHETIC');
  f.pages[1].events[1].amountMinor = '100';
  assert.ok(preview(f.manifest, f.pages).findings.includes('EVENT_CONFLICT'));
  const x = fixture();
  x.pages[1].events.push({ ...x.pages[0].events[0], eventId: 'different-id' });
  assert.ok(preview(x.manifest, x.pages).findings.includes('ECONOMIC_DUPLICATE'));
});
test('scope, source, currency, direction and half-open time window enforced', () => {
  for (const [change, code] of [
    [(x: any) => (x.pages[1].scope.merchant = 'other'), 'SCOPE_MISMATCH'],
    [(x: any) => (x.pages[0].events[0].currency = 'EUR'), 'CURRENCY'],
    [(x: any) => (x.pages[0].events[0].direction = 'debit'), 'DIRECTION'],
    [(x: any) => (x.pages[0].events[0].kind = 'BANK_CREDIT'), 'SOURCE_KIND'],
    [(x: any) => (x.pages[1].events[0].occurredAt = x.manifest.to), 'WINDOW'],
  ] as const) {
    const x = fixture();
    change(x);
    const r = preview(x.manifest, x.pages);
    assert.ok(r.findings.includes(code));
    assert.equal(r.totals, null);
    assert.equal(r.stagedEvents.length, 0);
  }
});
test('missing balance, watermark lag, wrong count or closing balance stay incomplete', () => {
  for (const [key, value, code] of [
    ['openingBalanceMinor', null, 'BALANCE_MISSING'],
    ['watermark', '2026-10-01T23:00:00.000Z', 'WATERMARK'],
    ['expectedEvents', 3, 'EVENT_COUNT'],
    ['closingBalanceMinor', '999', 'BALANCE_MISMATCH'],
  ] as const) {
    const f = fixture();
    f.manifest[key] = value;
    const r = preview(f.manifest, f.pages);
    assert.equal(r.status, 'INCOMPLETE');
    assert.ok(r.findings.includes(code));
    assert.equal(r.contentHash, null);
    assert.equal(r.stagedEvents.length, 0);
  }
});
test('empty terminal batch requires explicit zero count and reconciled balances', () => {
  const f = fixture();
  f.manifest.expectedPages = 1;
  f.manifest.expectedEvents = 0;
  f.pages = [{ ...f.pages[0], nextCursor: null, events: [] }];
  assert.equal(preview(f.manifest, f.pages).status, 'COMPLETE_SYNTHETIC');
  assert.equal(preview(f.manifest, []).status, 'INCOMPLETE');
});
test('live environment, non-synthetic provenance, unknown fields and oversized input rejected', () => {
  const f = fixture();
  f.manifest.scope.environment = 'live';
  assert.equal(preview(f.manifest, f.pages).findings[0], 'SYNTHETIC_TEST_ONLY');
  const x = fixture();
  assert.equal(preview({ ...x.manifest, provenance: 'verified' }, x.pages).status, 'REJECTED');
  assert.equal(preview({ ...x.manifest, secret: 'not-allowed' }, x.pages).status, 'REJECTED');
  assert.equal(preview(x.manifest, Array(201).fill(x.pages[0])).status, 'REJECTED');
  x.pages[0].events[0].amountMinor = '1.5';
  assert.equal(preview(x.manifest, x.pages).status, 'REJECTED');
});
test('big integer arithmetic stays exact and negative balance is supported', () => {
  const f = fixture();
  f.pages[0].events[0].amountMinor = '9007199254740993000';
  f.pages[1].events[0].amountMinor = '9007199254740993101';
  f.manifest.closingBalanceMinor = '-1';
  const r = preview(f.manifest, f.pages);
  assert.equal(r.status, 'COMPLETE_SYNTHETIC');
  assert.equal(r.totals?.calculatedClosingMinor, '-1');
});
test('offline CLI reports summary only; incomplete exits 2 without staged records', () => {
  const run = (path: string) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/refund-evidence-preview.ts', path], {
      encoding: 'utf8',
      env: process.env,
    });
  const ok = run('tests/fixtures/l11-external-evidence.json');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).authentic, false);
  assert.ok(!ok.stdout.includes('event-capture'));
  assert.ok(!ok.stdout.includes('stagedEvents'));
  const dir = mkdtempSync(join(tmpdir(), 'l11-evidence-'));
  try {
    const f = fixture();
    f.pages.pop();
    const path = join(dir, 'incomplete.json');
    writeFileSync(path, JSON.stringify(f));
    const r = run(path);
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).status, 'INCOMPLETE');
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(dir).startsWith('l11-evidence-'));
    rmSync(dir, { recursive: true });
  }
});
