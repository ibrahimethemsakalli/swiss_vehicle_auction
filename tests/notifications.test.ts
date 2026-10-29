import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  notificationDrafts,
  notificationKinds,
  type NotificationEvent,
} from '../src/lib/notification-events';
const seller = '00000000-0000-4000-8000-000000000001';
const buyer = '00000000-0000-4000-8000-000000000002';
const vehicle = {
  id: '00000000-0000-4000-8000-000000000003',
  userId: seller,
  make: 'BMW',
  model: 'Example',
};
test('notification recipients and kinds cover only intended event participants', () => {
  const events: NotificationEvent[] = [
    { type: 'outbid', bidId: 'bid', userId: buyer, vehicle },
    {
      type: 'closed',
      version: 1,
      winnerId: buyer,
      participantIds: [buyer, buyer, seller],
      vehicle,
    },
    { type: 'review', version: 2, approved: true, vehicle },
    { type: 'review', version: 3, approved: false, vehicle },
    { type: 'renewal', holdId: 'hold', userId: buyer, vehicle },
    ...(['NO_ACTION', 'MANUAL_RESOLUTION', 'REFUND_REQUIRED'] as const).map((resolution) => ({
      type: 'dispute' as const,
      disputeId: 'dispute',
      resolution,
      buyerId: buyer,
      vehicle,
    })),
    { type: 'offerAccepted', bidId: 'offer', buyerId: buyer, vehicle },
  ];
  assert.deepEqual(
    new Set(events.flatMap((e) => notificationDrafts(e).map((n) => n.kind))),
    new Set(notificationKinds),
  );
  const closed = notificationDrafts(events[1]);
  assert.equal(closed.length, 2);
  assert.equal(closed.find((n) => n.userId === buyer)?.kind, 'AUCTION_WON');
  assert.equal(closed.find((n) => n.userId === seller)?.kind, 'AUCTION_CLOSED');
  assert.deepEqual(
    notificationDrafts(events[2]).map((n) => n.userId),
    [seller],
  );
  assert.deepEqual(
    notificationDrafts(events[0]).map((n) => n.userId),
    [buyer],
  );
  assert.ok(
    events
      .flatMap(notificationDrafts)
      .every((n) => !('note' in n) && !('email' in n) && !('href' in n)),
  );
  assert.notEqual(
    notificationDrafts(events[2])[0].eventKey,
    notificationDrafts(events[3])[0].eventKey,
  );
});
test('new notification translations are complete and share interpolation across four languages', () => {
  const catalogs = ['de', 'fr', 'it', 'en'].map(
    (l) => JSON.parse(readFileSync(`src/messages/${l}.json`, 'utf8')) as Record<string, string>,
  );
  const keys = Object.keys(catalogs[0]).filter(
    (k) => k.startsWith('notice') || k.startsWith('notifications'),
  );
  assert.equal(keys.length, 24);
  for (const catalog of catalogs)
    for (const key of keys) {
      assert.ok(catalog[key]?.trim(), key);
      assert.deepEqual(catalog[key].match(/\{\{\w+\}\}/g), catalogs[0][key].match(/\{\{\w+\}\}/g));
    }
});
