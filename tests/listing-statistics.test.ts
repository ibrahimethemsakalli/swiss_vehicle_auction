import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyViewerToken,
  statisticsDay,
  statisticsSince,
  likelyBot,
  viewInput,
  viewCollectionEnabled,
} from '../src/lib/listing-statistics';
import de from '../src/messages/de.json';
import fr from '../src/messages/fr.json';
import it from '../src/messages/it.json';
import en from '../src/messages/en.json';
test('daily pseudonyms rotate and the window contains exactly 30 UTC dates', () => {
  const now = new Date('2026-03-29T23:30:00Z'),
    day = statisticsDay(now);
  assert.equal(day.toISOString(), '2026-03-29T00:00:00.000Z');
  assert.equal(statisticsSince(now).toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal((day.getTime() - statisticsSince(now).getTime()) / 86400000 + 1, 30);
  const token = dailyViewerToken('private-id', day, 'test-secret');
  assert.equal(token.length, 64);
  assert.ok(!token.includes('private-id'));
  assert.notEqual(
    token,
    dailyViewerToken('private-id', new Date(day.getTime() + 86400000), 'test-secret'),
  );
  assert.notEqual(token, dailyViewerToken('other-id', day, 'test-secret'));
  assert.notEqual(token, dailyViewerToken('private-id', day, 'other-secret'));
});
test('known robots and unsafe payloads are rejected; analytics default off; translations match', () => {
  for (const ua of ['', 'Googlebot', 'HeadlessChrome', 'facebookexternalhit preview', 'curl/1'])
    assert.equal(likelyBot(ua), true);
  assert.equal(likelyBot('Mozilla/5.0 Safari/537.36'), false);
  assert.equal(viewInput.safeParse({ vehicleId: 'bad' }).success, false);
  assert.equal(
    viewInput.safeParse({ vehicleId: '00000000-0000-4000-8000-000000000001', userId: 'spoof' })
      .success,
    false,
  );
  assert.equal(viewCollectionEnabled(), false);
  const keys = Object.keys(de).filter((k) => k.startsWith('listingStats'));
  assert.equal(keys.length, 12);
  for (const messages of [fr, it, en])
    for (const key of keys) {
      assert.ok(key in messages);
      assert.deepEqual(
        messages[key as keyof typeof messages].match(/\{\{.*?\}\}/g),
        de[key as keyof typeof de].match(/\{\{.*?\}\}/g),
      );
    }
});
