import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { locationFields, matchesLocation, localityText } from '../src/lib/vehicle-location';
import { filterInput } from '../src/lib/market-query';
import { searchHref, readSearchState } from '../src/lib/search-state';
import { publicValidation } from '../src/lib/validation-errors';
import { comparisonRows, comparisonValue } from '../src/lib/comparison';
import type { VehicleView } from '../src/lib/market-types';
const input = z.object(locationFields).strict();
test('locality normalizes Unicode and blanks, accepts bilingual names, rejects address-like inputs', () => {
  assert.deepEqual(input.parse({}), { city: null, postalCode: null });
  assert.deepEqual(input.parse({ city: '  Zu\u0308rich  ', postalCode: ' 8001 ' }), {
    city: 'Zürich',
    postalCode: '8001',
  });
  for (const city of ['Biel/Bienne', 'La Chaux-de-Fonds', 'St. Gallen', 'L’Isle', 'Vaduz'])
    assert.ok(input.safeParse({ city }).success);
  for (const city of ['Bahnhofstrasse 12', 'a\nb', 'a@b.ch', '<script>', '---', 'x'.repeat(81)])
    assert.equal(input.safeParse({ city }).success, false);
  for (const postalCode of ['800', '0800', '80010', '80ab', 'CH-8001'])
    assert.equal(input.safeParse({ postalCode }).success, false);
  assert.equal(input.safeParse({ city: 'Zürich', address: 'Private street 10' }).success, false);
  const parsed = input.safeParse({ postalCode: '80ab' });
  if (!parsed.success)
    assert.deepEqual(publicValidation(parsed.error), [
      { field: 'postalCode', key: 'validationPostalCode' },
    ]);
});
test('location matching excludes unknowns and preserves city exact / postal prefix semantics in shared URLs', () => {
  const v = { city: 'Biel/Bienne', postalCode: '2502' };
  assert.ok(matchesLocation(v, { city: ' bIEL/bIENNE ', postalCode: '25' }));
  assert.equal(matchesLocation(v, { city: 'Biel' }), false);
  assert.equal(matchesLocation({}, { postalCode: '25' }), false);
  assert.ok(matchesLocation({}, {}));
  const state = {
    filters: filterInput.parse({ city: 'Biel/Bienne', postalCode: '25' }),
    page: 1,
    onlySaved: false,
  };
  assert.deepEqual(
    readSearchState(new URL(searchHref(state), 'https://local.invalid').search),
    state,
  );
  assert.equal(localityText({}), '');
  assert.equal(localityText(v), '2502 Biel/Bienne');
});
test('comparison location values are text and unknown fields stay unknown; new copy exists in four languages', () => {
  const v = { city: 'Biel/Bienne', postalCode: '2502' } as VehicleView;
  for (const key of ['city', 'postalCode'] as const) {
    const row = comparisonRows.find((r) => r.key === key)!;
    assert.equal(row.kind, 'text');
    assert.deepEqual(comparisonValue(v, row), { value: v[key] });
    assert.deepEqual(comparisonValue({} as VehicleView, row), { message: 'compareUnknown' });
  }
  const catalogs = ['de', 'fr', 'it', 'en'].map((l) =>
    JSON.parse(readFileSync(`src/messages/${l}.json`, 'utf8')),
  );
  for (const key of Object.keys(catalogs[0]).filter(
    (k) => k.startsWith('location') || ['validationCity', 'validationPostalCode'].includes(k),
  ))
    for (const catalog of catalogs) assert.ok(catalog[key], key);
});
