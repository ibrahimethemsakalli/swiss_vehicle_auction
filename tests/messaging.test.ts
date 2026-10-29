import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatCommand, chatQuery } from '../src/lib/messaging';
const id = '00000000-0000-4000-8000-000000000009';
test('messaging boundaries reject spoofed actors, unbounded text and invalid actions', () => {
  const send = { action: 'send', conversationId: id, requestId: id, body: ' hello ' };
  assert.equal(chatCommand.parse(send).action, 'send');
  for (const invalid of [
    { ...send, senderId: id },
    { ...send, body: ' ' },
    { ...send, body: 'x'.repeat(2001) },
    { ...send, body: 'a\u0000b' },
    { ...send, conversationId: 'bad' },
    { action: 'appointment', conversationId: id, id, decision: 'SOLD' },
  ])
    assert.equal(chatCommand.safeParse(invalid).success, false);
  assert.equal(chatQuery.safeParse({ userId: id }).success, false);
  assert.equal(
    chatCommand.safeParse({
      action: 'propose',
      conversationId: id,
      requestId: id,
      startsAt: '2026-11-01T10:00',
      location: 'Station',
    }).success,
    false,
    'Timezone is required',
  );
});
test('all messaging, appointment, safety and notification copy exists in four languages', () => {
  const dictionaries = ['de', 'fr', 'it', 'en'].map((locale) =>
    JSON.parse(readFileSync(`src/messages/${locale}.json`, 'utf8')),
  );
  const keys = Object.keys(dictionaries[0]).filter(
    (k) => k.startsWith('chat') || k.startsWith('noticeChat'),
  );
  assert.ok(keys.length >= 50);
  for (const key of keys)
    for (const dictionary of dictionaries) {
      assert.equal(typeof dictionary[key], 'string');
      assert.ok(dictionary[key].trim());
      assert.equal(dictionary[key].includes('undefined'), false);
    }
});
