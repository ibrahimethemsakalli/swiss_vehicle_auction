import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSupportNavigation, supportNavigationHref } from '../src/lib/support-navigation';
const parse = (url: string, admin = true) =>
  readSupportNavigation(new URL(url, 'https://local.invalid').searchParams, admin);
const id = 'b5148119-2557-4d93-8d1e-6656a018d4df';
test('queue URL round trips every filter, Unicode and reserved characters in all languages', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const state = {
      ...parse('/'),
      page: 3,
      status: 'WAITING_USER',
      assignment: 'mine' as const,
      unread: true,
      q: 'Zürich & 100%_ / ? # +',
    };
    const url = supportNavigationHref(state, true, lang);
    assert.deepEqual(parse(url), state);
    assert.equal(new URL(url, 'https://local.invalid').searchParams.get('lang'), lang);
  }
});
test('detail paging is independent and returning to queue preserves filters and list page', () => {
  const list = parse('/?page=4&assignment=unassigned&unread=true&q=Help&status=OPEN');
  const detail = { ...list, ticket: id, messagePage: 2 };
  assert.deepEqual(parse(supportNavigationHref(detail, true)), detail);
  const returned = parse(supportNavigationHref({ ...detail, ticket: '', messagePage: 1 }, true));
  assert.deepEqual(returned, list);
});
test('malformed and duplicate parameters cannot inject role, owner or redirect', () => {
  const state = parse(
    '/?admin=true&ownerId=other&next=https://evil.invalid&page=-1&messagePage=999999&ticket=bad&status=wrong&assignment=mine&unread=yes&q=a&q=b',
    false,
  );
  assert.deepEqual(state, parse('/'));
  assert.equal(supportNavigationHref(state, false, 'evil'), '/support');
  assert.equal(parse('/?page=2&page=3&assignment=mine&assignment=all').page, 1);
  assert.equal(parse('/?q=' + 'x'.repeat(200)).q.length, 160);
});
test('URL history snapshots restore queue, detail and clear state without carrying message drafts', () => {
  const initial = parse('/?q=PM28&assignment=mine&page=2');
  const detail = { ...initial, ticket: id, messagePage: 1 };
  const cleared = { ...initial, q: '', assignment: 'all' as const, page: 1 };
  const history = [initial, detail, cleared].map((s) => supportNavigationHref(s, true));
  assert.deepEqual(parse(history[0]), initial);
  assert.deepEqual(parse(history[1]), detail);
  assert.deepEqual(parse(history[2]), cleared);
  assert.ok(!history.join().includes('body='));
});
