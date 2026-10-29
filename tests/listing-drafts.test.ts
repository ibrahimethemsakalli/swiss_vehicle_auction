import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { draftCommand, draftPayload, assertReviewVersion } from '../src/lib/listing-drafts';
const id = '00000000-0000-4000-8000-000000000010';
const payload = {
  draft: { make: 'BMW' },
  specs: {},
  equipment: [],
  images: [],
  customMake: false,
  customModel: false,
  registrationYear: '',
  listingType: 'AUCTION_7_DAYS',
};
test('incomplete private drafts allow missing fields but reject injected ownership/status and oversized payloads', () => {
  assert.ok(draftPayload.safeParse(payload).success);
  const command = { action: 'save', id, revision: 0, step: 1, payload };
  assert.ok(draftCommand.safeParse(command).success);
  for (const invalid of [
    { ...command, ownerId: id },
    { ...command, status: 'ACTIVE' },
    { ...command, step: 4 },
    { ...command, payload: { ...payload, draft: { make: 'x'.repeat(201) } } },
    { ...command, payload: { ...payload, specs: { userId: id } } },
    { ...command, payload: { ...payload, images: ['https://example.com/x.jpg'] } },
  ])
    assert.equal(draftCommand.safeParse(invalid).success, false);
  assert.equal(
    draftCommand.safeParse({ action: 'submit', id, revision: 1, consent: false }).success,
    false,
  );
  assert.throws(() => assertReviewVersion(2, 1), /CONFLICT/);
  assert.doesNotThrow(() => assertReviewVersion(2, 2));
});
test('draft copy and interpolation are complete in all four languages', () => {
  const ds = ['de', 'fr', 'it', 'en'].map((l) =>
    JSON.parse(readFileSync(`src/messages/${l}.json`, 'utf8')),
  );
  for (const key of Object.keys(ds[0]).filter((k) => k.startsWith('draft')))
    for (const d of ds) {
      assert.ok(d[key]?.length);
      assert.deepEqual(d[key].match(/\{\{\w+\}\}/g), ds[0][key].match(/\{\{\w+\}\}/g));
    }
});
