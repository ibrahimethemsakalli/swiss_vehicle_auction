import test from 'node:test';
import assert from 'node:assert/strict';
import {
  declarationStamp,
  manualCorrectionStamp,
  vehicleDataOrigin,
} from '../src/lib/vehicle-data-origin';
import { vehicleInput } from '../src/lib/vehicles';
import { draftPayload } from '../src/lib/listing-drafts';
import de from '../src/messages/de.json';
import fr from '../src/messages/fr.json';
import it from '../src/messages/it.json';
import en from '../src/messages/en.json';
test('source labels never turn approval, OCR or photos into independent verification', () => {
  for (const input of [
    {},
    { dataDeclaredAt: 'invalid' },
    { dataDeclaredAt: '2026-01-01' },
    { isSample: true, dataDeclaredAt: '2026-01-01' },
  ])
    assert.equal(vehicleDataOrigin(input).independentlyVerified, false);
  assert.equal(vehicleDataOrigin({}).source, 'UNRECORDED');
  assert.equal(vehicleDataOrigin({ isSample: true }).source, 'SAMPLE_REFERENCE');
  assert.equal(vehicleDataOrigin({ dataDeclaredAt: '2026-01-01' }).source, 'SELLER_DECLARATION');
  assert.deepEqual(declarationStamp(new Date(0)), {
    dataDeclaredAt: new Date(0),
    dataCorrectedAt: null,
    dataCorrectedFields: [],
  });
});
test('manual correction dates reflect actual changes only and contain no user values', () => {
  const before = {
    make: 'BMW',
    model: '320',
    firstRegistration: new Date('2020-01-01'),
    mfkDate: null,
    mfkStatus: 'UNKNOWN',
    stammnummer: '123456789',
    vinChassis: 'TEST',
  };
  assert.deepEqual(
    manualCorrectionStamp(before, { ...before, firstRegistration: new Date('2020-01-01') }),
    {},
  );
  const changed = manualCorrectionStamp(
    before,
    { ...before, model: 'Secret correction' },
    new Date(0),
  );
  assert.deepEqual(changed, { dataCorrectedAt: new Date(0), dataCorrectedFields: ['model'] });
  assert.ok(!JSON.stringify(changed).includes('Secret correction'));
  assert.equal(
    vehicleInput.safeParse({ dataDeclaredAt: '2000-01-01', dataCorrectedFields: [] }).success,
    false,
  );
  assert.equal(draftPayload.safeParse({ dataDeclaredAt: '2000-01-01' }).success, false);
});
test('data origin translations cover four languages with matching placeholders', () => {
  const keys = Object.keys(de).filter((k) => k.startsWith('dataOrigin'));
  assert.equal(keys.length, 17);
  for (const messages of [fr, it, en])
    for (const key of keys) {
      assert.ok(key in messages);
      assert.deepEqual(
        messages[key as keyof typeof messages].match(/\{\{.*?\}\}/g),
        de[key as keyof typeof de].match(/\{\{.*?\}\}/g),
      );
    }
});
