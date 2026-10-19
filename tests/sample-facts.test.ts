import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleFacts } from '../src/lib/sample-facts';
import { demoVehicles } from '../src/lib/demo';
import { filterVehicles, vehicleYear, type Filters } from '../src/lib/market-types';
const base: Filters = {
  query: '',
  canton: '',
  price: Number.MAX_SAFE_INTEGER,
  mileage: Number.MAX_SAFE_INTEGER,
  privateOnly: false,
  mfk: false,
  sort: 'priceAsc',
};
test('source year is distinct from registration; event/capture years do not become model years', () => {
  for (const index of [2, 4, 5, 11]) assert.equal(sampleFacts(index).modelYear, null);
  assert.equal(sampleFacts(3).modelYear, 2016);
  assert.equal(sampleFacts(7).model, 'XC60 R-Design D5 P-Pulse 2.0');
  assert.equal(sampleFacts(12).modelYear, 2020); // photographed in 2019
  for (let i = 1; i <= 12; i++) {
    const v = sampleFacts(i);
    assert.equal(v.firstRegistration, null);
    assert.deepEqual(v.equipment, []);
    assert.equal(v.fuelConsumption, null);
    assert.equal(v.accidentHistory, null);
  }
});
test('sample year and colour filters exclude unknowns; clearing restores samples', () => {
  const cars = demoVehicles();
  const filtered = filterVehicles(cars, {
    ...base,
    yearFrom: 2020,
    yearTo: 2020,
    specs: { exteriorColor: 'SILVER' },
  });
  assert.deepEqual(
    filtered.map((v) => v.make),
    ['Volkswagen'],
  );
  assert.equal(filterVehicles(cars, { ...base, make: 'BMW', yearTo: 2030 }).length, 0);
  assert.equal(filterVehicles(cars, { ...base, equipment: ['NAVIGATION'] }).length, 0);
  assert.equal(filterVehicles(cars, { ...base, mfk: true }).length, 0);
  assert.equal(filterVehicles(cars, base).length, cars.length);
  assert.equal(vehicleYear({ ...cars[0], modelYear: null, firstRegistration: '2019-05-01' }), 2019);
});
