import 'dotenv/config';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/autoveri');
  const sale = await db.settlement.findUniqueOrThrow({
    where: { vehicleId: '706850c8-a3ba-40a5-8c15-a2805c4b01a4' },
    include: { vehicle: true, bid: { include: { hold: { include: { transactions: true } } } } },
  });
  assert.equal(sale.bid.hold.gateway, 'local-test');
  const captures = sale.bid.hold.transactions.filter((t) => t.operation.startsWith('CAPTURE'));
  if (process.argv.includes('--pending')) {
    assert.equal(sale.status, 'DEFAULT_REVIEW');
    assert.equal(sale.bid.hold.status, 'AUTHORIZED');
    assert.equal(captures.length, 0);
    console.log(
      'PASS: seller report queued review only; hold remains authorized and no capture job exists.',
    );
  } else {
    assert.equal(sale.status, 'DEFAULTED');
    assert.equal(sale.outcome, 'COMPENSATION');
    assert.equal(sale.bid.status, 'DEFAULTED_PENALIZED');
    assert.equal(sale.bid.hold.status, 'CAPTURED_COMPENSATION');
    assert.equal(sale.bid.hold.amount.toString(), '30');
    assert.equal(sale.bid.hold.currency, 'CHF');
    assert.notEqual(sale.vehicle.status, 'SOLD');
    assert.equal(captures.length, 1);
    assert.equal(captures[0].operation, 'CAPTURE_COMPENSATION');
    assert.equal(captures[0].status, 'SUCCEEDED');
    const events = await db.outboxEvent.findMany({
      where: { kind: 'settlement.action', payload: { path: ['settlementId'], equals: sale.id } },
    });
    const approval = events
      .map((e) => e.payload as { actorId: string; action: string })
      .find((e) => e.action === 'approve_default');
    assert.ok(approval);
    assert.notEqual(approval.actorId, sale.vehicle.userId);
    assert.notEqual(approval.actorId, sale.bid.userId);
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: approval.actorId } })).role,
      'ADMIN',
    );
    console.log(
      'PASS: independent admin approval, one successful CHF 30 compensation, buyer defaulted; vehicle not sold. No real payment.',
    );
  }
}
main().finally(() => db.$disconnect());
