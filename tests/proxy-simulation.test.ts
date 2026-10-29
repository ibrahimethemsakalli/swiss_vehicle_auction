import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cents, startSimulation, simulateBid, type SimCommand } from '../src/lib/proxy-simulation';
const command = (
  bidder: 'A' | 'B' | 'C',
  maximum: number,
  now = 0,
  requestId: string = bidder,
): SimCommand => ({ bidder, maximum, now, requestId, holdExpiresAt: 3600000 });
const initial = () => simulateBid(startSimulation(100000, 10000), command('A', 300000));
test('first price, competing caps, incumbent tie and capped partial increment', () => {
  const a = initial();
  assert.equal(a.price, 100000);
  assert.equal(a.leader?.maximum, 300000);
  const lower = simulateBid(a, command('B', 200000));
  assert.equal(lower.price, 210000);
  assert.equal(lower.leader?.bidder, 'A');
  assert.equal(lower.history[1].release, 'B');
  const higher = simulateBid(a, command('B', 350000));
  assert.equal(higher.price, 310000);
  assert.equal(higher.leader?.bidder, 'B');
  assert.equal(higher.history[1].release, 'A');
  const equal = simulateBid(a, command('B', 300000));
  assert.equal(equal.price, 300000);
  assert.equal(equal.leader?.bidder, 'A');
  const partial = simulateBid(a, command('B', 295000));
  assert.equal(partial.price, 300000);
  assert.equal(partial.leader?.bidder, 'A');
  assert.equal(a.price, 100000, 'Input state is not mutated');
});
test('boundary extension occurs once per competitive command; own limit changes do not extend or reprice', () => {
  const a = initial();
  for (const [remaining, end] of [
    [180001, 600000],
    [180000, 720000],
    [1, 720000],
  ]) {
    const s = simulateBid(a, command('B', 350000, 600000 - remaining));
    assert.equal(s.endsAt, end);
  }
  assert.throws(() => simulateBid(a, command('B', 350000, 600000)), /AUCTION_ENDED/);
  const raise = simulateBid(a, command('A', 400000, 500000, 'raise'));
  assert.equal(raise.price, a.price);
  assert.equal(raise.endsAt, a.endsAt);
  assert.throws(() => simulateBid(a, command('A', 200000, 100, 'lower')), /LIMIT_NOT_HIGHER/);
  const b = simulateBid(a, command('B', 350000, 500000));
  const c = simulateBid(b, command('C', 400000, 650000));
  assert.equal(c.endsAt, 840000);
});
test('request retries are idempotent and invalid/expired virtual holds cannot act', () => {
  const a = initial(),
    c = command('B', 350000, 500000),
    b = simulateBid(a, c);
  assert.equal(simulateBid(b, c), b);
  assert.throws(() => simulateBid(b, { ...c, maximum: 360000 }), /REQUEST_CONFLICT/);
  assert.throws(() => simulateBid(a, { ...c, holdExpiresAt: c.now }), /INVALID_HOLD/);
  const expired = simulateBid(startSimulation(100000, 10000), {
    ...command('A', 300000),
    holdExpiresAt: 100,
  });
  assert.throws(() => simulateBid(expired, command('B', 350000, 100)), /LEADER_HOLD_EXPIRED/);
  const before = JSON.stringify(a);
  assert.throws(() => simulateBid(a, command('B', 109999)), /BID_TOO_LOW/);
  assert.equal(JSON.stringify(a), before);
});
test('integer cents and varied caps preserve maximum, minimum and monotonic prices', () => {
  assert.equal(cents('0.01'), 1);
  assert.equal(cents('999999999.99'), 99999999999);
  for (const invalid of ['0', '-1', '1,50', '1e3', '1.001', 'Infinity', ''])
    assert.throws(() => cents(invalid), /INVALID_INPUT/);
  for (let capA = 100; capA <= 250; capA += 5)
    for (let capB = 110; capB <= 260; capB += 7) {
      let s = simulateBid(startSimulation(100, 10), command('A', capA));
      s = simulateBid(s, command('B', capB));
      assert.ok(s.price! >= 110 && s.price! <= s.leader!.maximum);
      assert.equal(s.leader!.bidder, capB > capA ? 'B' : 'A');
    }
});
test('proposal UI translations match in four languages; production route is explicitly disabled', () => {
  const de = JSON.parse(readFileSync('src/messages/de.json', 'utf8'));
  for (const lang of ['fr', 'it', 'en']) {
    const d = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const k of Object.keys(de).filter((k) => k.startsWith('proxy'))) assert.ok(d[k]);
  }
  const page = readFileSync('src/app/bid-simulator/page.tsx', 'utf8');
  assert.match(page, /NODE_ENV/);
  assert.match(page, /notFound/);
  const module = readFileSync('src/lib/proxy-simulation.ts', 'utf8');
  assert.ok(!/from ['"].*(payments|bidding|db|prisma)|fetch\(/.test(module));
});
