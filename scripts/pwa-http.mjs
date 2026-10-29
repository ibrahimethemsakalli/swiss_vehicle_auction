import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin = new URL(process.env.PWA_TEST_ORIGIN || 'http://127.0.0.1:3000');
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname));
const get = (path) =>
  fetch(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(15000) });
const sw = await get('/sw.js');
assert.equal(sw.status, 200);
assert.match(sw.headers.get('cache-control'), /no-store/);
assert.equal(sw.headers.get('service-worker-allowed'), '/');
assert.match(sw.headers.get('content-type'), /javascript/);
assert.equal(await sw.text(), await readFile('public/sw.js', 'utf8'));
const offline = await get('/offline.html');
assert.equal(offline.status, 200);
assert.match(offline.headers.get('content-security-policy'), /default-src 'none'/);
assert.match(offline.headers.get('cache-control'), /no-store/);
const manifest = await get('/manifest.webmanifest');
assert.equal(manifest.status, 200);
const data = await manifest.json();
assert.equal(data.scope, '/');
assert.equal(data.start_url, '/');
for (const icon of data.icons) {
  const r = await get(icon.src);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/png/);
}
console.log(
  'PASS: live local manifest/icons, worker scope/type/no-store and static offline CSP. No provider requests.',
);
