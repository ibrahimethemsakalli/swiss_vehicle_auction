import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { supportCommand, supportStates } from '../src/lib/support';
test('support commands reject role injection, invalid status and unbounded content', () => {
  const base = {
    action: 'create',
    commandId: '11111111-1111-4111-8111-111111111111',
    subject: 'Question',
    body: 'A detailed question',
  };
  assert.ok(supportCommand.safeParse(base).success);
  for (const extra of [{ userId: 'other' }, { subject: 'x' }, { body: 'x'.repeat(4001) }])
    assert.equal(supportCommand.safeParse({ ...base, ...extra }).success, false);
  assert.equal(
    supportCommand.safeParse({
      action: 'reply',
      id: base.commandId,
      commandId: base.commandId,
      version: 0,
      body: base.body,
      status: 'DELETED',
    }).success,
    false,
  );
  assert.deepEqual(supportStates, ['OPEN', 'WAITING_USER', 'RESOLVED', 'CLOSED']);
});
test('all support copy exists in four languages', () => {
  const dictionaries = ['de', 'fr', 'it', 'en'].map((l) =>
    JSON.parse(readFileSync('src/messages/' + l + '.json', 'utf8')),
  );
  const keys = Object.keys(dictionaries[0]).filter(
    (k) => k.startsWith('sp') && !k.startsWith('spec'),
  );
  for (const d of dictionaries)
    for (const k of keys) assert.ok(typeof d[k] === 'string' && d[k].length, k);
});
