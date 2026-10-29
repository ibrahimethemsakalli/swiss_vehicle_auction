import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vehicleInput } from '../src/lib/vehicles';
import { inspectionInput } from '../src/lib/vehicle-disclosures';
import { publicValidation } from '../src/lib/validation-errors';
import { filterVehicles, isMfkFresh, type VehicleView } from '../src/lib/market-types';
import { filterInput, marketWhere } from '../src/lib/market-query';
const base = {
  make: 'Test',
  model: 'EV',
  stammnummer: '123456789',
  vinChassis: 'PM111234567890123',
  firstRegistration: '2020-01-01',
  mileage: 0,
  canton: 'BE',
  serviceHistory: 'NONE',
  tireCondition: 'test',
  description: '',
  images: ['/api/uploads/00000000-0000-4000-8000-000000000011.jpg'],
  listingType: 'AUCTION_7_DAYS',
  startPrice: '100',
  mfkStatus: 'UNKNOWN',
  mfkDate: null,
};
test('inspection states never invent a date; legacy dated input remains compatible', () => {
  for (const mfkStatus of ['UNKNOWN', 'NEVER'])
    assert.equal(vehicleInput.parse({ ...base, mfkStatus }).mfkDate, null);
  assert.ok(inspectionInput.safeParse({ mfkDate: '2020-01-01' }).success);
  for (const input of [
    { mfkStatus: 'DATED' },
    { mfkStatus: 'UNKNOWN', mfkDate: '2020-01-01' },
    { mfkStatus: 'NEVER', mfkDate: '2020-01-01' },
    { mfkStatus: 'DATED', mfkDate: '2999-01-01' },
  ])
    assert.equal(inspectionInput.safeParse(input).success, false);
  assert.equal(isMfkFresh(null), false);
});
test('damage and battery declarations validate without inferring registration/model year', () => {
  assert.equal(vehicleInput.parse(base).modelYear, undefined);
  assert.equal(vehicleInput.parse({ ...base, modelYear: 2019 }).modelYear, 2019);
  for (const patch of [
    { modelYear: 1899 },
    { modelYear: 2020.5 },
    { accidentHistory: 'DAMAGED' },
    { accidentHistory: 'REPAIRED', damageDescription: ' ' },
    { batteryHealth: 101, fuelType: 'ELECTRIC' },
    { batteryHealth: -1, fuelType: 'ELECTRIC' },
    { batteryHealth: 90, fuelType: 'PETROL' },
  ])
    assert.equal(vehicleInput.safeParse({ ...base, ...patch }).success, false);
  assert.ok(
    vehicleInput.safeParse({
      ...base,
      accidentHistory: 'DAMAGED',
      damageDescription: 'Front panel damaged',
      batteryHealth: 0,
      fuelType: 'ELECTRIC',
    }).success,
  );
  assert.ok(
    vehicleInput.safeParse({
      ...base,
      accidentHistory: 'UNKNOWN',
      batteryHealth: 90,
      fuelType: 'PLUGIN_HYBRID',
    }).success,
  );
  const result = vehicleInput.safeParse({ ...base, accidentHistory: 'DAMAGED' });
  assert.ok(
    !result.success &&
      publicValidation(result.error).some(
        (i) => i.field === 'damageDescription' && i.key === 'validationRequired',
      ),
  );
});
test('client filters exclude unknown inspection/model year/SoH and keep SQL semantics', () => {
  const f = filterInput.parse({ privateOnly: false });
  const row = {
    id: 'test',
    make: 'Test',
    model: 'EV',
    firstRegistration: '2020-01-01',
    modelYear: null,
    price: 100,
    mileage: 0,
    mfkDate: null,
    mfkStatus: 'UNKNOWN',
    status: 'ACTIVE',
    isSample: false,
  } as VehicleView;
  assert.equal(filterVehicles([row], { ...f, yearFrom: 2019 }).length, 0);
  assert.equal(filterVehicles([row], { ...f, mfk: true }).length, 0);
  assert.equal(filterVehicles([row], { ...f, ranges: { batteryHealth: { min: 0 } } }).length, 0);
  assert.equal(
    filterVehicles([{ ...row, modelYear: 2020, batteryHealth: 0 }], {
      ...f,
      yearFrom: 2019,
      ranges: { batteryHealth: { min: 0 } },
    }).length,
    1,
  );
  const where = JSON.stringify(marketWhere({ ...f, yearFrom: 2019, mfk: true }));
  assert.ok(where.includes('"mfkStatus":"DATED"'));
  assert.ok(!where.includes('firstRegistration'));
});
test('new disclosure labels and explanations exist in all four languages', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const d = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const key of [
      'mfkStatus',
      'mfkDated',
      'mfkNever',
      'mfkUnknown',
      'modelYear',
      'modelYearHint',
      'damageDescription',
      'batteryHealth',
      'disclosureHint',
      'UNKNOWN',
    ])
      assert.ok(d[key]?.length, `${lang}:${key}`);
    assert.equal(d.year, d.modelYear);
  }
});
