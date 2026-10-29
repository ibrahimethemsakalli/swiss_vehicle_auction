import test from 'node:test';
import assert from 'node:assert/strict';
import { demoVehicles } from '../src/lib/demo';
import { filterVehicles, type Filters } from '../src/lib/market-types';
import { filterInput } from '../src/lib/market-query';
import { vehicleInput } from '../src/lib/vehicles';
const base: Filters = {
  query: '',
  canton: '',
  price: Number.MAX_SAFE_INTEGER,
  mileage: Number.MAX_SAFE_INTEGER,
  privateOnly: false,
  mfk: false,
  sort: 'priceAsc',
};
test('technical filters combine ranges, brand/model and unknown values without confusing fuel/electric units', () => {
  const cars = demoVehicles().slice(0, 3);
  Object.assign(cars[0], {
    firstRegistration: '2018-06-01',
    modelYear: 2018,
    price: 58900,
    fuelType: 'PETROL',
    fuelConsumption: 6.5,
    transmission: 'MANUAL',
    powerKw: 200,
    equipment: ['REAR_CAMERA', 'NAVIGATION'],
  });
  Object.assign(cars[1], {
    fuelType: 'ELECTRIC',
    electricConsumption: 15,
    fuelConsumption: null,
    powerKw: 200,
  });
  const f = { ...base, ranges: { fuelConsumption: { max: 7 }, powerKw: { min: 200, max: 200 } } };
  assert.deepEqual(
    filterVehicles(cars, f).map((v) => v.id),
    [cars[0].id],
  );
  assert.equal(filterVehicles(cars, { ...f, specs: { transmission: 'AUTOMATIC' } }).length, 0);
  assert.equal(
    filterVehicles(cars, {
      ...base,
      make: cars[0].make,
      model: cars[0].model,
      yearFrom: 2018,
      yearTo: 2018,
      minPrice: 58900,
      price: 58900,
      minMileage: 48200,
      mileage: 48200,
    }).length,
    1,
  );
  assert.equal(filterVehicles(cars, { ...base, yearFrom: 2025, yearTo: 2020 }).length, 0);
  assert.equal(filterVehicles(cars, base).length, 3);
  assert.equal(
    filterVehicles(cars, { ...base, equipment: ['REAR_CAMERA', 'NAVIGATION'] }).length,
    1,
  );
});
test('search input rejects arbitrary fields, non-finite bounds and unknown enum values', () => {
  for (const extra of [
    { specs: { passwordHash: 'x' } },
    { specs: { fuelType: 'WATER' } },
    { ranges: { userId: { min: 1 } } },
    { ranges: { constructor: { min: 1 } } },
    { price: Infinity },
    { yearFrom: 1800 },
  ])
    assert.equal(filterInput.safeParse({ ...base, ...extra }).success, false);
  assert.equal(
    filterInput.safeParse({
      ...base,
      specs: { fuelType: 'ELECTRIC' },
      ranges: { electricConsumption: { max: 16 } },
    }).success,
    true,
  );
});
test('listing input preserves technical values and rejects invalid specifications', () => {
  const input = {
    stammnummer: '123456789',
    vinChassis: 'WVWZZZ1JZXW000001',
    firstRegistration: '2020-01-01',
    make: 'VW',
    model: 'Golf',
    mileage: 100,
    canton: 'ZH',
    mfkDate: '2025-01-01',
    serviceHistory: 'FULL',
    tireCondition: 'Good',
    description: 'Test',
    images: [
      '/api/uploads/11111111-1111-4111-8111-111111111111.jpg',
      '/api/uploads/22222222-2222-4222-8222-222222222222.jpg',
    ],
    listingType: 'AUCTION_7_DAYS',
    startPrice: '1000',
    fuelType: 'ELECTRIC',
    transmission: 'AUTOMATIC',
    electricConsumption: 15.5,
    co2Emissions: 0,
    seats: 5,
  };
  const parsed = vehicleInput.parse(input);
  assert.equal(parsed.electricConsumption, 15.5);
  assert.equal(parsed.co2Emissions, 0);
  assert.equal(parsed.images.length, 2);
  for (const extra of [
    { seats: 0 },
    { doors: 2.5 },
    { fuelConsumption: -1 },
    { fuelType: 'WATER' },
  ])
    assert.equal(vehicleInput.safeParse({ ...input, ...extra }).success, false);
});
