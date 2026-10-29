import { supportNotificationVisibility } from './support-routing';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { notificationDrafts, type NotificationEvent } from './notification-events';
import { retentionNotificationVisibility } from './retention-routing';

export async function notify(tx: Prisma.TransactionClient, event: NotificationEvent) {
  return tx.notification.createMany({ data: notificationDrafts(event), skipDuplicates: true });
}

const cursorInput = z.object({ at: z.iso.datetime(), id: z.uuid() }).strict();
export const notificationQuery = z
  .object({
    unread: z.enum(['true', 'false']).default('false'),
    cursor: z.string().max(300).optional(),
    summary: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export const notificationReadInput = z.object({ id: z.uuid() }).strict();
async function activeUser(client: PrismaClient, userId: string) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { suspendedAt: true, isSample: true, role: true },
  });
  if (!user || user.suspendedAt || user.isSample) throw new Error('FORBIDDEN');
  return user;
}
export async function listNotifications(client: PrismaClient, userId: string, raw: unknown) {
  const query = notificationQuery.parse(raw);
  const cursor = query.cursor
    ? cursorInput.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString()))
    : null;
  const user = await activeUser(client, userId);
  const visible = {
    AND: [
      retentionNotificationVisibility(userId, user.role),
      supportNotificationVisibility(userId, user.role),
    ],
  };
  if (query.summary === 'true')
    return {
      items: [],
      unreadCount: await client.notification.count({
        where: { userId, readAt: null, AND: [visible] },
      }),
      nextCursor: null,
    };
  const where: Prisma.NotificationWhereInput = {
    userId,
    AND: [visible],
    ...(query.unread === 'true' ? { readAt: null } : {}),
    ...(cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.at) } },
            { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
          ],
        }
      : {}),
  };
  const [rows, unreadCount] = await client.$transaction(
    [
      client.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        select: {
          id: true,
          kind: true,
          vehicleId: true,
          vehicleName: true,
          readAt: true,
          createdAt: true,
          retentionRequestId: true,
          supportTicketId: true,
        },
      }),
      client.notification.count({ where: { userId, readAt: null, AND: [visible] } }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  const items = rows.slice(0, 20);
  const last = items.at(-1);
  return {
    items,
    unreadCount,
    nextCursor:
      rows.length > 20 && last
        ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString(
            'base64url',
          )
        : null,
  };
}
export async function readNotification(client: PrismaClient, userId: string, raw: unknown) {
  const { id } = notificationReadInput.parse(raw);
  const user = await activeUser(client, userId);
  // Repeated reads preserve the first read timestamp; foreign IDs disclose nothing.
  await client.notification.updateMany({
    where: {
      id,
      userId,
      readAt: null,
      AND: [
        retentionNotificationVisibility(userId, user.role),
        supportNotificationVisibility(userId, user.role),
      ],
    },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

// Notification-only sweep: no payment provider calls and no changes to holds/bids.
// The anti-join prevents an already-notified first batch from starving later holds.
export async function notifyHoldRenewals(client: PrismaClient) {
  return client.$executeRaw`
    INSERT INTO "Notification" (id, "userId", "eventKey", kind, "vehicleId", "vehicleName")
    SELECT gen_random_uuid()::text, h."userId", 'renewal:' || h.id, 'HOLD_RENEWAL', v.id,
      LEFT(v.make || ' ' || v.model, 181)
    FROM "PaymentHold" h JOIN "Bid" b ON b."holdId"=h.id
    JOIN "Vehicle" v ON v.id=h."vehicleId" JOIN "User" u ON u.id=h."userId"
    LEFT JOIN "Settlement" s ON s."bidId"=b.id
    WHERE h.status IN ('AUTHORIZED', 'EXPIRED') AND h."expiresAt" <= NOW() + INTERVAL '24 hours'
      AND u."suspendedAt" IS NULL AND NOT u."isSample" AND NOT v."isSample"
      AND ((b.status='ACTIVE' AND v.status='ACTIVE') OR
        (b.status='WON' AND s.status IN ('AWAITING_CONFIRMATION', 'DEFAULT_REVIEW', 'PAYMENT_FAILED')))
      AND NOT EXISTS (SELECT 1 FROM "Notification" n WHERE n."userId"=h."userId" AND n."eventKey"='renewal:' || h.id)
    ORDER BY h."expiresAt", h.id LIMIT 100
    ON CONFLICT ("userId", "eventKey") DO NOTHING`;
}
