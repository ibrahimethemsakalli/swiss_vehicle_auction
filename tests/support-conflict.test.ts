import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { canReviewSupportConflict, loadedSupportConflict } from '../src/lib/support-conflict';
import { supportRead, supportQuery } from '../src/lib/support';

test('conflict requires a loaded matching version and loading blocks acknowledgement', () => {
  const stale = { previousVersion: 2, loadedVersion: null };
  assert.equal(canReviewSupportConflict(stale, 2, false), false);
  const loaded = loadedSupportConflict(stale, 3);
  assert.deepEqual(loaded, { previousVersion: 2, loadedVersion: 3 });
  assert.equal(canReviewSupportConflict(loaded, 3, false), true);
  assert.equal(canReviewSupportConflict(loaded, 3, true), false);
  assert.equal(canReviewSupportConflict(loaded, 4, false), false);
  assert.equal(canReviewSupportConflict(null, 3, false), false);
  assert.equal(loadedSupportConflict(null, 3), null);
  assert.equal(canReviewSupportConflict({ ...stale, previousVersion: 3 }, 3, false), false);
});

test('review reads latest bounded messages without private command payloads or writes', async () => {
  const id = 'b5148119-2557-4d93-8d1e-6656a018d4df';
  let query: any;
  const db = {
    user: { findUnique: async () => ({ id: 'admin', role: 'ADMIN' }), findMany: async () => [] },
    supportTicket: {
      findFirst: async () => ({ id, userId: 'buyer', version: 8, status: 'CLOSED' }),
    },
    supportEntry: {
      findMany: async (q: any) => {
        query = q;
        return Array.from({ length: 31 }, (_, i) => ({
          id: String(50 - i),
          reads: [],
          payload: 'private command',
          actorId: 'other',
          body: 'message',
        }));
      },
      count: async () => 31,
    },
    supportAssignment: { findMany: async () => [] },
  };
  const result: any = await supportRead(db as any, 'admin', {
    id,
    admin: 'true',
    newest: 'true',
    page: 9,
  });
  assert.equal(query.skip, 0);
  assert.equal(query.take, 31);
  assert.deepEqual(query.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  assert.equal(result.entries.length, 30);
  assert.equal(result.entries[0].id, '21');
  assert.equal(result.entries[29].id, '50');
  assert.ok(result.entries.every((e: any) => !('payload' in e) && !('reads' in e)));
  assert.equal(result.ticket.version, 8);
  db.user.findUnique = async () => ({ id: 'user', role: 'PRIVATE_USER' });
  await assert.rejects(
    supportRead(db as any, 'user', { id, admin: 'true', newest: 'true' }),
    /FORBIDDEN/,
  );
});

test('newest query is explicit and all review texts interpolate in four languages', async () => {
  assert.equal(supportQuery.parse({}).newest, 'false');
  assert.equal(supportQuery.safeParse({ newest: 'yes' }).success, false);
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const texts = JSON.parse(
      readFileSync(new URL('../src/messages/' + lang + '.json', import.meta.url), 'utf8'),
    );
    for (const key of [
      'scTitle',
      'scPreserved',
      'scVersions',
      'scLoad',
      'scReviewed',
      'scNoAutoSend',
      'scRecent',
    ])
      assert.ok(texts[key]?.length > 5);
    assert.ok(
      texts.scVersions.includes('{{previous}}') && texts.scVersions.includes('{{current}}'),
    );
    const i18n = createInstance();
    await i18n.init({ lng: lang, resources: { [lang]: { translation: texts } } });
    const rendered = i18n.t('scVersions', { previous: 2, current: 3 });
    assert.ok(rendered.includes('2') && rendered.includes('3'));
    assert.ok(!rendered.includes('{'));
  }
});
