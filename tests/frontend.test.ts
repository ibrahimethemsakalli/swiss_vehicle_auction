import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoVehicles } from '../src/lib/demo';
import { filterVehicles, isMfkFresh, type Filters } from '../src/lib/market-types';
import { assertSameOrigin } from '../src/lib/mutation';
const base: Filters = {
  query: '',
  canton: '',
  price: 150000,
  mileage: 300000,
  privateOnly: true,
  mfk: false,
  sort: 'ending',
};
test('all four catalogs have identical keys and interpolation variables', () => {
  const catalogs = ['de', 'fr', 'it', 'en'].map(
    (language) =>
      JSON.parse(readFileSync(`src/messages/${language}.json`, 'utf8')) as Record<string, string>,
  );
  for (const catalog of catalogs) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs[0]).sort());
    for (const [key, value] of Object.entries(catalog)) {
      assert.ok(value.length > 0, key);
      assert.deepEqual(value.match(/\{\{\w+\}\}/g), catalogs[0][key].match(/\{\{\w+\}\}/g), key);
    }
  }
});
test('private filter excludes dealers and combined search filters narrow results', () => {
  const vehicles = demoVehicles();
  assert.equal(filterVehicles(vehicles, base).length, 5);
  assert.equal(filterVehicles(vehicles, { ...base, privateOnly: false }).length, 6);
  const result = filterVehicles(vehicles, {
    ...base,
    query: 'bmw',
    canton: 'BE',
    price: 25000,
    mileage: 70000,
  });
  assert.equal(result.length, 1);
  // Filtering selects the fixture identity; source-backed display names can gain trim detail.
  assert.equal(result[0].id, 'demo-2');
  assert.equal(result[0].make, 'BMW');
});
test('price sorting never mutates source order', () => {
  const vehicles = demoVehicles();
  const ids = vehicles.map((v) => v.id);
  const result = filterVehicles(vehicles, { ...base, sort: 'priceAsc' });
  assert.ok(result.every((v, i) => !i || v.price >= result[i - 1].price));
  assert.deepEqual(
    vehicles.map((v) => v.id),
    ids,
  );
});
test('MFK freshness excludes future dates and exact twelve month boundary', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  assert.equal(isMfkFresh('2026-10-20', now), false);
  assert.equal(isMfkFresh('2025-10-19T12:00:00Z', now), false);
  assert.equal(isMfkFresh('2026-06-01', now), true);
});
test('mutation origin check rejects missing and foreign origins', () => {
  const url = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const origin = new URL(url).origin;
  assert.doesNotThrow(() =>
    assertSameOrigin(new Request(`${origin}/api/bids`, { headers: { origin } })),
  );
  assert.throws(() =>
    assertSameOrigin(
      new Request(`${origin}/api/bids`, { headers: { origin: 'https://untrusted.example' } }),
    ),
  );
  assert.throws(() => assertSameOrigin(new Request(`${origin}/api/bids`)));
});
