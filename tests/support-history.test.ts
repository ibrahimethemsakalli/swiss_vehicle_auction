import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { loadSupportHistory } from '../src/lib/support-history';

test('history pages only GET display data and carry abort/no-store without editor state', async () => {
  const calls: URL[] = [];
  const signal = new AbortController().signal;
  const request = (async (input, options) => {
    const url = new URL(String(input), 'http://local.invalid');
    calls.push(url);
    assert.equal(options?.method, 'GET');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.signal, signal);
    assert.equal(options?.body, undefined);
    const page = Number(url.searchParams.get('page'));
    return Response.json({
      entries: [{ id: String(page), body: 'history', staff: true, createdAt: '2026-01-01' }],
      more: page < 3,
      ticket: { version: 99, status: 'CLOSED' },
    });
  }) as typeof fetch;
  for (const page of [1, 2, 3, 2, 0]) {
    const result = await loadSupportHistory(request, 'ticket', true, page, signal);
    assert.deepEqual(Object.keys(result), ['entries', 'more']);
  }
  assert.deepEqual(
    calls.map((u) => u.searchParams.get('page')),
    ['1', '2', '3', '2', '1'],
  );
  assert.equal(calls[4].searchParams.get('newest'), 'true');
  assert.equal(calls[0].searchParams.get('newest'), null);
});
test('failed, unauthorized and malformed loads reject; aborted requests receive the signal', async () => {
  const signal = new AbortController().signal;
  for (const status of [403, 404, 503])
    await assert.rejects(
      loadSupportHistory(
        (async () => new Response('', { status })) as typeof fetch,
        'id',
        false,
        1,
        signal,
      ),
      /HISTORY_FAILED/,
    );
  await assert.rejects(
    loadSupportHistory(
      (async () => Response.json({ entries: null })) as typeof fetch,
      'id',
      false,
      1,
      signal,
    ),
    /INVALID_HISTORY/,
  );
  await assert.rejects(loadSupportHistory(fetch, 'id', false, -1, signal), /INVALID_PAGE/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    loadSupportHistory(
      (async (_url, options) => {
        options?.signal?.throwIfAborted();
        throw Error('unexpected');
      }) as typeof fetch,
      'id',
      false,
      1,
      abort.signal,
    ),
    { name: 'AbortError' },
  );
});
test('four language history copy and page interpolation', async () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const texts = JSON.parse(
      readFileSync(new URL('../src/messages/' + lang + '.json', import.meta.url), 'utf8'),
    );
    for (const key of [
      'shTitle',
      'shHint',
      'shOldest',
      'shLatest',
      'shReturn',
      'shPage',
      'shEmpty',
    ])
      assert.ok(texts[key]?.length);
    const i = createInstance();
    await i.init({ lng: lang, resources: { [lang]: { translation: texts } } });
    assert.ok(i.t('shPage', { page: 3 }).includes('3'));
    assert.ok(!i.t('shPage', { page: 3 }).includes('{'));
  }
});
