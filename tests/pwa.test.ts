import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import sharp from 'sharp';
import manifest from '../src/app/manifest';
import { pwaEnabled } from '../src/lib/pwa';
const source = readFileSync('public/sw.js', 'utf8');
function worker(network: (...args: unknown[]) => Promise<Response>) {
  const listeners: Record<string, (event: any) => void> = {};
  let claims = 0;
  runInNewContext(source, {
    URL,
    Response,
    fetch: network,
    self: {
      location: { origin: 'https://local.test' },
      clients: {
        claim: async () => {
          claims++;
        },
      },
      addEventListener: (name: string, fn: (event: any) => void) => (listeners[name] = fn),
    },
  });
  return {
    listeners,
    get claims() {
      return claims;
    },
  };
}
test('worker falls back only for failed same-origin document navigation; never stores or replays requests', async () => {
  let calls = 0;
  const w = worker(async () => {
    calls++;
    throw Error('offline');
  });
  let result: Promise<Response> | undefined;
  w.listeners.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://local.test/dashboard?private=value' },
    respondWith: (r: Promise<Response>) => (result = r),
  });
  assert.ok(result);
  const r = await result;
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-security-policy')!, /default-src 'none'/);
  const html = await r.text();
  assert.equal(html, readFileSync('public/offline.html', 'utf8'));
  assert.ok(!html.includes('private=value'));
  assert.ok(!html.includes('<script'));
  for (const request of [
    { method: 'POST', mode: 'navigate', url: 'https://local.test/sell' },
    { method: 'GET', mode: 'navigate', url: 'https://local.test/api/payments' },
    { method: 'GET', mode: 'navigate', url: 'https://local.test/api' },
    { method: 'GET', mode: 'navigate', url: 'https://local.test/_next/image' },
    { method: 'GET', mode: 'cors', url: 'https://local.test/dashboard?_rsc=1' },
    { method: 'GET', mode: 'no-cors', url: 'https://local.test/photo.jpg' },
    { method: 'GET', mode: 'navigate', url: 'https://external.test/' },
  ])
    w.listeners.fetch({
      request,
      respondWith: () => assert.fail('Request must not be intercepted'),
    });
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(w.listeners).sort(), ['activate', 'fetch']);
  assert.ok(!/caches\.|indexedDB|localStorage|skipWaiting/.test(source));
});
test('worker preserves online response and auth/error statuses without caching', async () => {
  for (const status of [200, 401, 403, 404, 503]) {
    const original = new Response('server response', { status });
    let reply: Promise<Response> | undefined;
    const w = worker(async (request, options) => {
      assert.equal((options as {cache:string}).cache, 'no-store');
      return original;
    });
    w.listeners.fetch({
      request: { method: 'GET', mode: 'navigate', url: 'https://local.test/' },
      respondWith: (r: Promise<Response>) => (reply = r),
    });
    assert.equal(await reply, original);
  }
});
test('manifest icons are local, correctly sized and opaque; PWA defaults are controlled', async () => {
  const m = manifest();
  assert.equal(m.scope, '/');
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
  for (const icon of m.icons!) {
    assert.ok(icon.src.startsWith('/pwa/'));
    const info = await sharp('public' + icon.src).metadata();
    assert.equal(`${info.width}x${info.height}`, icon.sizes);
    assert.equal(info.hasAlpha, false);
  }
  assert.equal(pwaEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(pwaEnabled({ NODE_ENV: 'production' }), true);
  assert.equal(pwaEnabled({ NODE_ENV: 'production', PWA_ENABLED: 'false' }), false);
  assert.equal(pwaEnabled({ NODE_ENV: 'development', PWA_ENABLED: 'true' }), true);
});
test('offline document has no external resources, forms or private data and all four languages', () => {
  const html = readFileSync('public/offline.html', 'utf8');
  assert.ok(!/<(script|form|img|iframe)|https?:\/\//.test(html));
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const d = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    assert.ok(html.includes(`section lang="${lang}"`));
    assert.ok(html.includes(d.pwaOfflineTitle));
    for (const k of Object.keys(d).filter((k) => k.startsWith('pwa'))) assert.ok(d[k].length > 2);
  }
});
