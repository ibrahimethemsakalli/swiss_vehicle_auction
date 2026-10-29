import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDealerCsv, dealerTemplate } from '../src/lib/dealer-csv';
import de from '../src/messages/de.json';
import fr from '../src/messages/fr.json';
import it from '../src/messages/it.json';
import en from '../src/messages/en.json';
test('CSV parser supports BOM, semicolons, CRLF, escaped quotes and multiline cells', () => {
  const rows = parseDealerCsv(
    '\uFEFFmake;model;city\r\nBMW;"320;\nTouring";Zürich\r\nAudi;"A4 ""Avant""";Bern\r\n',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, '320;\nTouring');
  assert.equal(rows[1].model, 'A4 "Avant"');
  assert.equal(rows[0].issues.length, 0);
  const basic = parseDealerCsv('make,model\nBMW,320');
  assert.deepEqual(basic[0].payload.images, []);
  assert.deepEqual(basic[0].payload.equipment, []);
  assert.equal(basic[0].payload.draft.modelYear, undefined);
  assert.equal(basic[0].payload.draft.mfkStatus, 'UNKNOWN');
  assert.equal(parseDealerCsv(dealerTemplate)[0].issues.length, 0);
});
test('CSV reports invalid rows without creating valid-looking inferred data', () => {
  const rows = parseDealerCsv(
    'make,model,modelYear,mileage,firstRegistration,fuelType\nBMW,320,abc,-1,not-a-date,FAKE\n,Model,,,,',
  );
  assert.ok(rows[0].issues.length >= 4);
  assert.ok(rows[1].issues.some((i) => i.field === 'make' && i.code === 'required'));
  assert.equal(parseDealerCsv('make,model\n=HYPERLINK(x),Model')[0].issues[0].code, 'formula');
  const duplicates = parseDealerCsv(
    'make,model,vinChassis\nBMW,320,WBA12345678901234\nBMW,320,WBA12345678901234',
  );
  assert.ok(duplicates[1].issues.some((i) => i.code === 'duplicate'));
  for (const text of [
    'make,model\n"bad,Model',
    'make,make\nBMW,320',
    'make,model,images\nBMW,320,https://evil.test/x',
    'make,model\nBMW\u0000,320',
  ])
    assert.throws(() => parseDealerCsv(text), /CSV_FORMAT/);
  assert.throws(() => parseDealerCsv('make,model\n' + 'BMW,320\n'.repeat(51)), /CSV_LIMIT/);
  assert.throws(() => parseDealerCsv('a'.repeat(256001)), /CSV_LIMIT/);
});
test('dealer messages have complete four-language coverage and matching variables', () => {
  const keys = Object.keys(de).filter((k) => k.startsWith('dealer') && k !== 'dealer');
  for (const messages of [fr, it, en])
    for (const key of keys) {
      assert.ok(key in messages);
      assert.deepEqual(
        messages[key as keyof typeof messages].match(/\{\{.*?\}\}/g),
        de[key as keyof typeof de].match(/\{\{.*?\}\}/g),
      );
    }
});
