import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { supportRoutingCommand } from '../src/lib/support-routing';
test('support routing commands reject injected ownership/read identity and unbounded receipts', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const assign = {
    action: 'assign',
    id,
    commandId: id,
    version: 0,
    ownerId: id,
    reason: 'Local test assignment',
  };
  assert.ok(supportRoutingCommand.safeParse(assign).success);
  assert.ok(supportRoutingCommand.safeParse({ ...assign, ownerId: null }).success);
  for (const extra of [{ userId: id }, { version: -1 }, { reason: 'x' }, { ownerId: 'invalid' }])
    assert.equal(supportRoutingCommand.safeParse({ ...assign, ...extra }).success, false);
  assert.ok(supportRoutingCommand.safeParse({ action: 'read', id, entryIds: [id] }).success);
  assert.equal(
    supportRoutingCommand.safeParse({ action: 'read', id, userId: id, entryIds: [id] }).success,
    false,
  );
  assert.equal(
    supportRoutingCommand.safeParse({ action: 'read', id, entryIds: Array(31).fill(id) }).success,
    false,
  );
});
test('support routing labels and notifications exist in all four languages', () => {
  const en = JSON.parse(readFileSync('src/messages/en.json', 'utf8'));
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const d = JSON.parse(readFileSync('src/messages/' + lang + '.json', 'utf8'));
    for (const k of Object.keys(en).filter((k) => k.startsWith('sr'))) assert.ok(d[k]?.length, k);
    assert.ok(d.srUnread.includes('{{count}}'));
  }
});
