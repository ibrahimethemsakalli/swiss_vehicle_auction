import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  blankHandover,
  handoverPayload,
  handoverCommand,
  handoverQuery,
  readyForAcknowledgement,
  swissCalendarDate,
} from '../src/lib/handover-rules';
test('handover keeps unknown facts blank and rejects invalid or injected data', () => {
  assert.ok(handoverPayload.safeParse(blankHandover).success);
  for (const payload of [
    { ...blankHandover, mileage: -1 },
    { ...blankHandover, keyCount: 1.5 },
    { ...blankHandover, date: '2026-02-30' },
    { ...blankHandover, price: 1 },
    { ...blankHandover, note: 'x'.repeat(2001) },
  ])
    assert.equal(handoverPayload.safeParse(payload).success, false);
  const ack = {
    action: 'acknowledge',
    settlementId: '00000000-0000-4000-8000-000000000019',
    version: 1,
    confirmed: true,
  };
  assert.ok(handoverCommand.safeParse(ack).success);
  for (const c of [
    { ...ack, confirmed: false },
    { ...ack, actorId: ack.settlementId },
    { ...ack, version: -1 },
    { ...ack, action: 'confirm_sale' },
  ])
    assert.equal(handoverCommand.safeParse(c).success, false);
  assert.equal(handoverQuery.safeParse({ settlementId: ack.settlementId, page: 0 }).success, false);
});
test('acknowledgement requires explicit answers and explains negative findings without forcing all Yes', () => {
  const start = new Date('2026-10-28T10:00:00Z'),
    now = new Date('2026-10-28T12:00:00Z');
  const ready = {
    ...blankHandover,
    date: '2026-10-28',
    inspection: 'YES' as const,
    damage: 'YES' as const,
    keys: 'NO' as const,
    documents: 'YES' as const,
    vehicle: 'YES' as const,
    note: 'Second key not available.',
  };
  assert.equal(readyForAcknowledgement(blankHandover, start, now), false);
  assert.equal(readyForAcknowledgement(ready, start, now), true);
  for (const value of [
    { ...ready, note: '' },
    { ...ready, vehicle: 'UNKNOWN' as const },
    { ...ready, date: '2026-10-29' },
    { ...ready, date: '2026-10-27' },
  ])
    assert.equal(readyForAcknowledgement(value, start, now), false);
});
test('handover calendar uses Switzerland at midnight and daylight saving boundaries', () => {
  assert.equal(swissCalendarDate(new Date('2026-10-28T23:30:00Z')), '2026-10-29');
  assert.equal(swissCalendarDate(new Date('2026-03-29T22:30:00Z')), '2026-03-30');
});
test('handover copy exists with matching interpolation in all four languages', () => {
  const catalogs = ['de', 'fr', 'it', 'en'].map((l) =>
    JSON.parse(readFileSync(`src/messages/${l}.json`, 'utf8')),
  );
  for (const key of Object.keys(catalogs[0]).filter((k) => k.startsWith('handover')))
    for (const c of catalogs) {
      assert.ok(c[key], key);
      assert.deepEqual(c[key].match(/\{\{\w+\}\}/g), catalogs[0][key].match(/\{\{\w+\}\}/g));
    }
});
