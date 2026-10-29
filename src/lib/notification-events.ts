import { z } from 'zod';

export const notificationKinds = [
  'OUTBID',
  'AUCTION_WON',
  'AUCTION_CLOSED',
  'LISTING_APPROVED',
  'LISTING_REJECTED',
  'HOLD_RENEWAL',
  'DISPUTE_NO_ACTION',
  'DISPUTE_MANUAL',
  'DISPUTE_REFUND_REQUIRED',
  'OFFER_ACCEPTED',
] as const;
export type NotificationKind = (typeof notificationKinds)[number];
type Vehicle = { id: string; make: string; model: string; userId: string };
export type NotificationEvent =
  | { type: 'outbid'; bidId: string; userId: string; vehicle: Vehicle }
  | {
      type: 'closed';
      version: number;
      winnerId?: string;
      participantIds: string[];
      vehicle: Vehicle;
    }
  | { type: 'review'; version: number; approved: boolean; vehicle: Vehicle }
  | { type: 'renewal'; holdId: string; userId: string; vehicle: Vehicle }
  | {
      type: 'dispute';
      disputeId: string;
      resolution: 'NO_ACTION' | 'MANUAL_RESOLUTION' | 'REFUND_REQUIRED';
      buyerId: string;
      vehicle: Vehicle;
    }
  | { type: 'offerAccepted'; bidId: string; buyerId: string; vehicle: Vehicle };

export const notificationDraft = z.object({
  userId: z.uuid(),
  eventKey: z.string().min(1).max(200),
  kind: z.enum(notificationKinds),
  vehicleId: z.uuid(),
  vehicleName: z.string().max(181),
});

// Persist facts, not translated text, so changing language also translates old messages.
export function notificationDrafts(event: NotificationEvent) {
  const vehicleName = `${event.vehicle.make} ${event.vehicle.model}`.slice(0, 181);
  const row = (userId: string, eventKey: string, kind: NotificationKind) =>
    notificationDraft.parse({ userId, eventKey, kind, vehicleId: event.vehicle.id, vehicleName });
  switch (event.type) {
    case 'outbid':
      return [row(event.userId, `outbid:${event.bidId}`, 'OUTBID')];
    case 'closed': {
      const key = `closed:${event.vehicle.id}:${event.version}`;
      return [
        ...new Set([
          event.vehicle.userId,
          ...event.participantIds,
          ...(event.winnerId ? [event.winnerId] : []),
        ]),
      ].map((userId) =>
        row(userId, key, userId === event.winnerId ? 'AUCTION_WON' : 'AUCTION_CLOSED'),
      );
    }
    case 'review':
      return [
        row(
          event.vehicle.userId,
          `review:${event.vehicle.id}:${event.version}`,
          event.approved ? 'LISTING_APPROVED' : 'LISTING_REJECTED',
        ),
      ];
    case 'renewal':
      return [row(event.userId, `renewal:${event.holdId}`, 'HOLD_RENEWAL')];
    case 'dispute':
      return [...new Set([event.vehicle.userId, event.buyerId])].map((userId) =>
        row(
          userId,
          `dispute:${event.disputeId}:${event.resolution}`,
          event.resolution === 'NO_ACTION'
            ? 'DISPUTE_NO_ACTION'
            : event.resolution === 'MANUAL_RESOLUTION'
              ? 'DISPUTE_MANUAL'
              : 'DISPUTE_REFUND_REQUIRED',
        ),
      );
    case 'offerAccepted':
      return [row(event.buyerId, `offer:${event.bidId}`, 'OFFER_ACCEPTED')];
  }
}
