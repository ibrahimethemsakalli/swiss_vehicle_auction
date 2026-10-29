import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { favoriteCommand, guestFavorites } from '../src/lib/favorite-rules';
test('favorite commands are bounded, explicit and reject injected ownership', () => {
  const set = { action: 'set', vehicleId: '00000000-0000-4000-8000-000000000013', saved: true };
  assert.ok(favoriteCommand.safeParse(set).success);
  for (const value of [
    { ...set, userId: set.vehicleId },
    { ...set, saved: 'yes' },
    { action: 'merge', ids: Array(201).fill(set.vehicleId) },
    { action: 'merge', ids: ['x'.repeat(101)] },
  ])
    assert.equal(favoriteCommand.safeParse(value).success, false);
  assert.deepEqual(guestFavorites('["one","one",42,null,"two"]'), ['one', 'two']);
  assert.deepEqual(guestFavorites('broken'), []);
  assert.deepEqual(guestFavorites('{}'), []);
  assert.equal(
    guestFavorites(JSON.stringify(Array.from({ length: 250 }, (_, i) => String(i)))).length,
    200,
  );
});
test('favorite sync and explicit guest merge copy exists in four languages', () => {
  const messages = ['de', 'fr', 'it', 'en'].map((l) =>
    JSON.parse(readFileSync(`src/messages/${l}.json`, 'utf8')),
  );
  for (const key of Object.keys(messages[0]).filter((k) => k.startsWith('favorite'))) {
    for (const d of messages) {
      assert.ok(d[key]);
      assert.deepEqual(d[key].match(/\{\{\w+\}\}/g), messages[0][key].match(/\{\{\w+\}\}/g));
    }
  }
});
