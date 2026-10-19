import 'dotenv/config';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/autoveri');
  const s = await db.settlement.findUniqueOrThrow({
    where: { vehicleId: 'ffdd7261-7ae9-4a60-aac3-a850bf59de25' },
    include: {
      vehicle: true,
      disputes: true,
      bid: { include: { hold: { include: { transactions: true } } } },
    },
  });
  const h = s.bid.hold;
  assert.equal(h.gateway, 'local-test');
  assert.equal(h.amount.toString(), '30');
  assert.equal(s.disputes.length, 1);
  const d = s.disputes[0];
  assert.equal(d.reporterId, s.vehicle.userId);
  if (process.argv.includes('--open')) {
    assert.equal(d.status, 'OPEN');
    assert.equal(s.status, 'AWAITING_CONFIRMATION');
    assert.equal(h.status, 'AUTHORIZED');
    assert.equal(h.transactions.length, 0);
    console.log(
      'PASS: open seller dispute blocks confirmation; CHF 30 authorized; zero capture operations.',
    );
  } else {
    assert.equal(d.status, 'RESOLVED');
    assert.notEqual(d.reviewedBy, s.vehicle.userId);
    assert.notEqual(d.reviewedBy, s.bid.userId);
    assert.equal(s.status, 'COMPLETED');
    assert.equal(h.status, 'CAPTURED_FEE');
    assert.equal(h.transactions.length, 1);
    assert.equal(h.transactions[0].operation, 'CAPTURE_FEE');
    assert.equal(h.transactions[0].status, 'SUCCEEDED');
    assert.equal(s.vehicle.status, 'SOLD');
    console.log(
      'PASS: independent admin resolved dispute; seller confirmation completed; exactly one simulated CHF 30 fee.',
    );
  }
}
main().finally(() => db.$disconnect());
