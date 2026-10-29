import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyMessageConversation,
  type MessageActivity,
} from '../src/lib/retention-message-preview';
import { inventoryRow, inventorySummary } from '../src/lib/retention-inventory';
const base: MessageActivity = {
  createdAt: new Date('2023-08-01T00:00:00Z'),
  lastMessageAt: new Date('2023-08-31T12:00:00Z'),
  lastAppointmentAt: null,
  evidence: false,
  activeAppointment: false,
  unknownAppointment: false,
};
test('approved six calendar months include exact deadline with UTC month-end clamp', () => {
  assert.equal(
    classifyMessageConversation(base, new Date('2024-02-29T11:59:59.999Z')).reason,
    'notDue',
  );
  assert.equal(
    classifyMessageConversation(base, new Date('2024-02-29T12:00:00Z')).state,
    'candidate',
  );
});
test('latest conversation/message/appointment activity wins; unrelated updated/read time ignored', () => {
  const now = new Date('2024-03-01T00:00:00Z');
  for (const key of ['createdAt', 'lastMessageAt', 'lastAppointmentAt'])
    assert.equal(
      classifyMessageConversation({ ...base, [key]: new Date('2024-02-01') }, now).reason,
      'notDue',
    );
  assert.equal(
    classifyMessageConversation({ ...base, updatedAt: now } as MessageActivity, now).state,
    'candidate',
  );
});
test('evidence and active appointments override age; uncertain or future activity fails closed', () => {
  const now = new Date('2026-10-28');
  for (const key of ['evidence', 'activeAppointment'])
    assert.equal(classifyMessageConversation({ ...base, [key]: true }, now).reason, 'evidence');
  assert.equal(
    classifyMessageConversation({ ...base, unknownAppointment: true }, now).state,
    'unknown',
  );
  assert.equal(classifyMessageConversation({ ...base, lastMessageAt: null }, now).state, 'unknown');
  assert.equal(
    classifyMessageConversation({ ...base, lastAppointmentAt: new Date('2030-01-01') }, now).state,
    'unknown',
  );
  assert.equal(
    classifyMessageConversation({ ...base, createdAt: new Date('bad') }, now).state,
    'unknown',
  );
});
test('preview partition is exact and candidates cannot leak to other categories', () => {
  const row = inventoryRow('ChatMessage', 10n, 4n, 5n);
  assert.deepEqual(inventorySummary([row]), {
    count: '10',
    candidate: '5',
    protected: '4',
    unknown: '1',
  });
  assert.throws(() => inventoryRow('Dispute', 3n, 0n, 1n));
  assert.throws(() => inventoryRow('ChatMessage', 3n, 2n, 2n));
});
test('four languages explain preview, protections and unknown periods', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const m = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const key of ['rdNotice', 'rdRules', 'rdElapsed', 'rdEvidence', 'rdNotDue', 'rdUnknown'])
      assert.ok(m[key]);
  }
});
