import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultFilters,
  readSearchState,
  searchHref,
  savedSearchCommand,
} from '../src/lib/search-state';
test('shared search preserves advanced filters, page and favorites without losing unrelated URL state', () => {
  const state = {
    filters: {
      ...defaultFilters,
      query: 'Citroën C4 & +',
      make: 'Citroën',
      yearFrom: 2020,
      privateOnly: false,
      specs: { fuelType: 'DIESEL' },
      ranges: { powerKw: { min: 60, max: 180 } },
    },
    page: 3,
    onlySaved: true,
  };
  const href = searchHref(state, '/?lang=fr#vehicles');
  assert.deepEqual(readSearchState(new URL(href, 'https://local.invalid').search), state);
  assert.ok(href.includes('lang=fr'));
  assert.ok(href.endsWith('#vehicles'));
  assert.equal(
    searchHref({ filters: defaultFilters, page: 1, onlySaved: false }, href),
    '/?lang=fr#vehicles',
  );
});
test('malformed links and saved search ownership injection are rejected safely', () => {
  for (const q of [
    '?filters=bad&page=-1',
    '?filters=%7B%22owner%22%3A%22x%22%7D&page=NaN',
    '?page=1.5',
    '?page=100001',
  ])
    assert.deepEqual(readSearchState(q), { filters: defaultFilters, page: 1, onlySaved: false });
  const input = { action: 'save', name: ' My search ', filters: defaultFilters, alerts: true };
  const parsed = savedSearchCommand.parse(input);
  assert.equal(parsed.action, 'save');
  if (parsed.action === 'save') assert.equal(parsed.name, 'My search');
  for (const invalid of [
    { ...input, userId: 'other' },
    { ...input, name: ' ' },
    { ...input, name: 'x'.repeat(61) },
    { ...input, filters: { ...defaultFilters, price: -1 } },
  ])
    assert.equal(savedSearchCommand.safeParse(invalid).success, false);
});
test('new saved search and notification copy exists in four languages', () => {
  const catalogs = ['de', 'fr', 'it', 'en'].map((l) =>
    JSON.parse(readFileSync(`src/messages/${l}.json`, 'utf8')),
  );
  for (const key of Object.keys(catalogs[0]).filter(
    (k) => k.startsWith('search') || k === 'noticeSearchMatch',
  ))
    for (const c of catalogs) {
      assert.ok(c[key]);
      assert.deepEqual(c[key].match(/\{\{\w+\}\}/g), catalogs[0][key].match(/\{\{\w+\}\}/g));
    }
});
