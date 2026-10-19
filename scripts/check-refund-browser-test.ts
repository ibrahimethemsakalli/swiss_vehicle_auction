import 'dotenv/config';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/autoveri');
  const s = await db.settlement.findUniqueOrThrow({
    where: { vehicleId: '262cdb85-ead7-44aa-b933-166abf3d66c6' },
    include: {
      vehicle: true,
      disputes: true,
      bid: { include: { hold: { include: { transactions: true } } } },
    },
  });
  assert.equal(s.disputes.length, 1);
  const d = s.disputes[0];
  const closed = process.argv.includes('--closed');
  assert.equal(d.reporterId, s.bid.userId);
  assert.equal(d.status, closed ? 'RESOLVED' : 'ACTION_REQUIRED');
  assert.equal(d.resolution, closed ? 'NO_ACTION' : 'REFUND_REQUIRED');
  assert.ok(d.reviewedBy);
  assert.notEqual(d.reviewedBy, s.bid.userId);
  assert.notEqual(d.reviewedBy, s.vehicle.userId);
  const cancelled = closed || process.argv.includes('--cancelled');
  assert.equal(s.status, cancelled ? 'CANCELLED' : 'AWAITING_CONFIRMATION');
  assert.equal(s.outcome, cancelled ? 'RELEASE' : null);
  assert.notEqual(s.vehicle.status, 'SOLD');
  const h = s.bid.hold;
  assert.equal(h.gateway, 'local-test');
  assert.equal(h.amount.toString(), '30');
  assert.equal(h.currency, 'CHF');
  assert.equal(h.status, cancelled ? 'RELEASED' : 'AUTHORIZED');
  assert.equal(h.transactions.length, cancelled ? 1 : 0);
  if (cancelled) {
    assert.equal(s.bid.status, 'RELEASED');
    assert.equal(h.transactions[0].operation, 'RELEASE');
    assert.equal(h.transactions[0].status, 'SUCCEEDED');
    const logs = await db.outboxEvent.findMany({
      where: { kind: 'settlement.action', payload: { path: ['settlementId'], equals: s.id } },
    });
    assert.ok(
      logs.some((log) => {
        const action = log.payload as { action: string; actorId: string };
        return action.action === 'cancel' && action.actorId === d.reviewedBy;
      }),
    );
    if (closed) {
      const reviews = await db.outboxEvent.findMany({
        where: { kind: 'dispute.reviewed', payload: { path: ['disputeId'], equals: d.id } },
        orderBy: { createdAt: 'asc' },
      });
      assert.deepEqual(
        reviews.map((log) => (log.payload as { resolution: string }).resolution),
        ['REFUND_REQUIRED', 'NO_ACTION'],
      );
      assert.ok(d.resolutionNote?.includes('No capture occurred'));
      console.log(
        'PASS: dispute RESOLVED / NO_ACTION; prior refund decision preserved in audit; sale still CANCELLED; CHF 30 RELEASED exactly once; no capture or new payment operation.',
      );
      return;
    }
    console.log(
      'PASS: refund-required sale cancelled by reviewing admin; exactly one successful CHF 30 release; no capture; buyer bid released. Dispute remains separately actionable.',
    );
    return;
  }
  console.log(
    'PASS: buyer dispute ACTION_REQUIRED / REFUND_REQUIRED, independent admin, CHF 30 still authorized, zero capture/release transactions, sale not completed.',
  );
}
main().finally(() => db.$disconnect());
