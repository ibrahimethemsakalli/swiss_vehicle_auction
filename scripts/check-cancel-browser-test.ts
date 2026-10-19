import 'dotenv/config';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/autoveri');
  const sale = await db.settlement.findUniqueOrThrow({
    where: { vehicleId: '5f8193d1-abcc-43da-882d-edb588872682' },
    include: { vehicle: true, bid: { include: { hold: { include: { transactions: true } } } } },
  });
  const hold = sale.bid.hold;
  assert.equal(hold.gateway, 'local-test');
  assert.equal(hold.amount.toString(), '30');
  assert.equal(hold.currency, 'CHF');
  assert.equal(hold.transactions.filter((t) => t.operation.startsWith('CAPTURE')).length, 0);
  const logs = await db.outboxEvent.findMany({
    where: { kind: 'settlement.action', payload: { path: ['settlementId'], equals: sale.id } },
    orderBy: { createdAt: 'asc' },
  });
  const actions = logs.map((log) => log.payload as { action: string; actorId: string });
  const decision = actions.find((a) => a.action === 'dismiss_default');
  assert.ok(decision);
  assert.notEqual(decision.actorId, sale.vehicle.userId);
  assert.notEqual(decision.actorId, sale.bid.userId);
  if (process.argv.includes('--dismissed')) {
    assert.equal(sale.status, 'AWAITING_CONFIRMATION');
    assert.equal(sale.outcome, null);
    assert.equal(hold.status, 'AUTHORIZED');
    assert.equal(sale.bid.status, 'WON');
    assert.equal(hold.transactions.length, 0);
    console.log(
      'PASS rejection: sale awaits confirmation, winning bid preserved, CHF 30 hold retained, no release or capture.',
    );
  } else {
    assert.equal(sale.status, 'CANCELLED');
    assert.equal(sale.outcome, 'RELEASE');
    assert.equal(hold.status, 'RELEASED');
    assert.equal(sale.bid.status, 'RELEASED');
    assert.notEqual(sale.vehicle.status, 'SOLD');
    assert.equal(hold.transactions.length, 1);
    assert.equal(hold.transactions[0].operation, 'RELEASE');
    assert.equal(hold.transactions[0].status, 'SUCCEEDED');
    assert.ok(actions.some((a) => a.action === 'cancel' && a.actorId === decision.actorId));
    console.log(
      'PASS cancellation: sale cancelled, exactly one successful CHF 30 release, no fee/compensation capture, vehicle not sold.',
    );
  }
}
main().finally(() => db.$disconnect());
