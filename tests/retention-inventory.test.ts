import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryRow, inventorySummary } from '../src/lib/retention-inventory';
test('unknown periods never become candidates; evidence is excluded without a retention deadline', () => {
  for (const table of ['Dispute', 'Transaction', 'LegalAcceptance', 'WebhookEvent']) {
    const r = inventoryRow(table, 9n);
    assert.equal(r.protected, '9');
    assert.equal(r.candidate, '0');
  }
  for (const table of ['User', 'UnknownFutureTable', 'LocalProxyRefund', 'MediaAsset']) {
    const r = inventoryRow(table, 9n);
    assert.equal(r.unknown, '9');
    assert.equal(r.candidate, '0');
  }
});
test('mixed messages and large aggregate counts preserve an exact disjoint partition', () => {
  const rows = [
    inventoryRow('ChatMessage', 5n, 3n),
    inventoryRow('User', 9007199254740993n),
    inventoryRow('Dispute', 2n),
  ];
  assert.equal(rows[0].unknown, '2');
  assert.deepEqual(inventorySummary(rows), {
    count: '9007199254741000',
    candidate: '0',
    protected: '5',
    unknown: '9007199254740995',
  });
  assert.deepEqual(inventorySummary([]), {
    count: '0',
    candidate: '0',
    protected: '0',
    unknown: '0',
  });
  assert.throws(() => inventoryRow('ChatMessage', 1n, 2n));
});
test('all new inventory explanations exist in four languages', () => {
  const de = JSON.parse(readFileSync('src/messages/de.json', 'utf8'));
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const m = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const key of Object.keys(de).filter((k) => k.startsWith('ri')))
      assert.ok(m[key], `${lang}:${key}`);
  }
});
