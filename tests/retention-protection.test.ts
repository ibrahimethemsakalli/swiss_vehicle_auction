import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { protectionCommand } from '../src/lib/retention-protection';
test('manual protection accepts only bounded reasons and explicit create/review commands', () => {
  const id = 'd880e899-c2df-4dc4-af2e-52e4dc1aabbf';
  assert.equal(
    protectionCommand.parse({
      action: 'create',
      conversationId: id,
      reason: '  Evidence review required  ',
    }).action === 'create',
    true,
  );
  for (const reason of ['short', ' '.repeat(30), 'a'.repeat(1001)])
    assert.equal(
      protectionCommand.safeParse({ action: 'create', conversationId: id, reason }).success,
      false,
    );
  for (const action of ['delete', 'release', 'expire'])
    assert.equal(
      protectionCommand.safeParse({ action, id, note: 'valid review note' }).success,
      false,
    );
  assert.equal(
    protectionCommand.safeParse({
      action: 'review',
      id,
      note: 'valid review note',
      expiresAt: '2027-01-01',
    }).success,
    false,
  );
  assert.equal(
    protectionCommand.safeParse({
      action: 'create',
      conversationId: 'bad',
      reason: 'valid reason here',
    }).success,
    false,
  );
});
test('manual protection labels and errors are translated in all four languages', () => {
  const en = JSON.parse(readFileSync('src/messages/en.json', 'utf8'));
  const keys = Object.keys(en).filter((k) => k.startsWith('rp'));
  assert.equal(keys.length, 19);
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const m = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const k of keys) assert.ok(m[k]?.length > 0, `${lang}:${k}`);
  }
});
