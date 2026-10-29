import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { supportQuery } from '../src/lib/support';
test('support filters validate and trim bounded search without accepting owner injection', () => {
  assert.equal(supportQuery.parse({ q: '  Help  ' }).q, 'Help');
  for (const raw of [
    { q: 'x'.repeat(161) },
    { assignment: 'other' },
    { unread: 'yes' },
    { ownerId: 'anything' },
    { page: 0 },
  ])
    assert.equal(supportQuery.safeParse(raw).success, false);
  assert.equal(supportQuery.parse({}).assignment, 'all');
});
test('four language queue filter copy is complete', () => {
  const en = JSON.parse(readFileSync('src/messages/en.json', 'utf8'));
  for (const l of ['de', 'fr', 'it', 'en']) {
    const d = JSON.parse(readFileSync('src/messages/' + l + '.json', 'utf8'));
    for (const k of Object.keys(en).filter((k) => k.startsWith('sq'))) assert.ok(d[k]?.length, k);
  }
});
