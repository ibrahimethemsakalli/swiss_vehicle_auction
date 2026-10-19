import test from 'node:test';
import assert from 'node:assert/strict';
import { auctionEndAfterBid, sevenDaysFrom } from '../src/lib/auction-rules';
import { parseFahrzeugausweis } from '../src/lib/ocr';
const now = new Date('2026-10-19T12:00:00Z');
test('exactly three minutes extends existing end by two minutes', () =>
  assert.equal(auctionEndAfterBid(new Date(+now + 180000), now).getTime(), +now + 300000));
test('outside window does not extend', () =>
  assert.equal(+auctionEndAfterBid(new Date(+now + 180001), now), +now + 180001));
test('expired auctions cannot be resurrected', () => {
  assert.throws(() => auctionEndAfterBid(now, now));
  assert.throws(() => auctionEndAfterBid(new Date(+now - 1), now));
});
test('repeated eligible bids extend repeatedly', () => {
  const end = auctionEndAfterBid(new Date(+now + 60000), now);
  assert.equal(+auctionEndAfterBid(end, now), +now + 300000);
});
test('seven days is exactly 168 hours', () => assert.equal(+sevenDaysFrom(now) - +now, 604800000));
test('OCR extracts labelled fields and validates dates', () => {
  const result = parseFahrzeugausweis(
    'Stammnummer: 123.456.789\nVIN: WBA12345678901234\n1. Inverkehrssetzung: 31.02.2024\nMarke und Typ: BMW 320\nLeistung: 140 kW',
  );
  assert.equal(result.stammnummer, '123456789');
  assert.equal(result.firstRegistration, null);
  assert.equal(result.powerKw, '140');
  assert.equal(result.makeAndModel, 'BMW 320');
});
test('missing OCR fields remain null', () =>
  assert.equal(parseFahrzeugausweis('unreadable').vinChassis, null));
