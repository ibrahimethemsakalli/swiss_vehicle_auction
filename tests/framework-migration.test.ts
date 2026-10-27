import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { demoVehicles } from '../src/lib/demo';
import { GET as market } from '../src/app/api/market/[id]/route';
import { GET as photo } from '../src/app/api/uploads/[id]/route';
import Privacy from '../src/app/privacy/page';
import Terms from '../src/app/terms/page';
import Vehicle from '../src/app/vehicles/[id]/page';
const require = createRequire(import.meta.url);

test('framework migration resolves asynchronous vehicle and legal query props', async () => {
  const vehicle = await Vehicle({ params: Promise.resolve({ id: 'migration-fixture' }) });
  assert.equal(vehicle.props.id, 'migration-fixture');
  for (const [Page, kind] of [
    [Privacy, 'PRIVACY'],
    [Terms, 'TERMS'],
  ] as const) {
    const page = await Page({
      searchParams: Promise.resolve({ version: 'fixture-v1', lang: 'fr' }),
    });
    assert.equal(page.props.kind, kind);
    assert.equal(page.props.version, 'fixture-v1');
    assert.equal(page.props.language, 'fr');
  }
});
test('framework API routes await promised params and retain missing-file privacy', async () => {
  const old = process.env.DATABASE_URL;
  process.env.DATABASE_URL = '';
  try {
    const id = demoVehicles()[0].id;
    const result = await market(new Request(`http://localhost/api/market/${id}`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).vehicle.id, id);
    const missing = await market(new Request('http://localhost/api/market/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    assert.equal(missing.status, 404);
    const denied = await photo(new Request('http://localhost/api/uploads/invalid'), {
      params: Promise.resolve({ id: 'invalid' }),
    });
    assert.equal(denied.status, 404);
    assert.match(denied.headers.get('cache-control')!, /private.*no-store/);
  } finally {
    if (old === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = old;
  }
});
test('installed framework and renderer use supported patched release families', () => {
  const nextVersion = require('next/package.json').version as string;
  const [major, minor, patch] = nextVersion.split('.').map(Number);
  assert.equal(major, 16);
  assert.ok(minor > 4 || (minor === 4 && patch >= 3));
  const reactVersion = require('react/package.json').version as string;
  assert.match(reactVersion, /^19\./);
  assert.equal(require('react-dom/package.json').version, reactVersion);
});
