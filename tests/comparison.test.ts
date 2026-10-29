import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  comparisonIds,
  toggleComparison,
  comparisonRows,
  comparisonValue,
  comparisonStatus,
} from '../src/lib/comparison';
import type { VehicleView } from '../src/lib/market-types';
const ids = [1, 2, 3, 4].map((n) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
test('comparison selection has three unique valid IDs, preserves order and supports removal/replacement', () => {
  assert.deepEqual(
    comparisonIds(JSON.stringify([...ids, ids[0], '../../private', null])),
    ids.slice(0, 3),
  );
  for (const raw of ['broken', '{}', 'null']) assert.deepEqual(comparisonIds(raw), []);
  assert.deepEqual(comparisonIds('["demo-1","demo-1","demo-2"]'), ['demo-1', 'demo-2']);
  let selection: string[] = [];
  for (const id of ids) selection = toggleComparison(selection, id);
  assert.deepEqual(selection, ids.slice(0, 3));
  selection = toggleComparison(selection, ids[1]);
  selection = toggleComparison(selection, ids[3]);
  assert.deepEqual(selection, [ids[0], ids[2], ids[3]]);
  assert.deepEqual(toggleComparison(selection, 'https://external.invalid'), selection);
});
test('unknown comparison data is explicit, zero is valid and registration never fabricates model year', () => {
  const vehicle = {
    modelYear: null,
    firstRegistration: '2020-01-01',
    powerKw: null,
    fuelConsumption: 0,
    equipment: ['ISOFIX'],
    fuelType: 'UNRECOGNIZED',
    accidentHistory: 'UNKNOWN',
  } as unknown as VehicleView;
  const value = (key: string) =>
    comparisonValue(vehicle, comparisonRows.find((row) => row.key === key)!);
  assert.deepEqual(value('modelYear'), { message: 'compareUnknown' });
  assert.deepEqual(value('firstRegistration'), { value: '2020-01-01' });
  assert.deepEqual(value('powerKw'), { message: 'compareUnknown' });
  assert.deepEqual(value('fuelConsumption'), { value: 0 });
  assert.deepEqual(value('ISOFIX'), { message: 'compareListed' });
  assert.deepEqual(value('SUNROOF'), { message: 'compareNotSpecified' });
  assert.deepEqual(value('fuelType'), { message: 'compareUnknown' });
  assert.deepEqual(value('accidentHistory'), { message: 'compareUnknown' });
});
test('comparison distinguishes unknown, never inspected, sample and dated MFK; closing is never inferred as sold', () => {
  const row = comparisonRows.find((row) => row.kind === 'mfk')!;
  const v = {
    status: 'ACTIVE',
    end: '2020-01-01',
    mfkStatus: 'UNKNOWN',
    mfkDate: '2026-01-01',
  } as VehicleView;
  assert.deepEqual(comparisonValue(v, row), { message: 'compareUnknown' });
  assert.deepEqual(comparisonValue({ ...v, mfkStatus: 'NEVER' }, row), { message: 'mfkNever' });
  assert.deepEqual(comparisonValue({ ...v, mfkStatus: 'DATED' }, row), { value: '2026-01-01' });
  assert.deepEqual(comparisonValue({ ...v, mfkStatus: 'DATED', isSample: true }, row), {
    message: 'compareUnverified',
  });
  assert.equal(comparisonStatus(v, Date.parse('2026-01-01')), 'auctionChecking');
  for (const status of ['SOLD', 'EXPIRED', 'CANCELLED'])
    assert.equal(comparisonStatus({ ...v, status }, Date.now()), status);
  assert.equal(
    comparisonStatus({ ...v, status: 'SOLD', saleCancelled: true }, Date.now()),
    'CANCELLED',
  );
});
test('all comparison field labels, choices and messages exist in four languages', () => {
  const catalogs = ['de', 'fr', 'it', 'en'].map((l) =>
    JSON.parse(readFileSync(`src/messages/${l}.json`, 'utf8')),
  );
  const keys = [
    ...comparisonRows.map((row) => row.label),
    ...Object.keys(catalogs[0]).filter((key) => key.startsWith('compare')),
  ];
  for (const key of keys)
    for (const catalog of catalogs) {
      assert.ok(catalog[key], key);
      assert.deepEqual(catalog[key].match(/\{\{\w+\}\}/g), catalogs[0][key].match(/\{\{\w+\}\}/g));
    }
});
