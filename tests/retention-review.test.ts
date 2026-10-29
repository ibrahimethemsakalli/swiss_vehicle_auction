import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reviewCommand } from '../src/lib/retention-review';
test('review commands require explicit version, reason, internal evidence and bounded notes', () => {
  const input = {
    action: 'request',
    id: randomUUID(),
    commandId: randomUUID(),
    version: 1,
    reasonCode: 'WRONG_CONVERSATION',
    note: 'Correcting an incorrect manual protection',
    evidence: [{ type: 'MESSAGE', id: randomUUID() }],
  };
  assert.equal(reviewCommand.parse(input).action, 'request');
  for (const bad of [
    { ...input, evidence: [] },
    { ...input, evidence: [{ type: 'URL', id: 'https://example.com' }] },
    { ...input, version: 0 },
    { ...input, note: 'short' },
    { ...input, expiresAt: '2027-01-01' },
    { ...input, action: 'delete' },
  ])
    assert.equal(reviewCommand.safeParse(bad).success, false);
  assert.equal(
    reviewCommand.safeParse({
      action: 'approve',
      id: input.id,
      commandId: input.commandId,
      version: 1,
      note: input.note,
    }).success,
    true,
  );
});
test('all review states, blockers and action labels exist in four languages', () => {
  const en = JSON.parse(readFileSync('src/messages/en.json', 'utf8'));
  const keys = Object.keys(en).filter((k) => k.startsWith('pg'));
  assert.equal(keys.length, 41);
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const m = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const key of keys) assert.ok(m[key]?.length > 0, `${lang}:${key}`);
  }
});
