import type { Prisma } from '../generated/prisma/client';
import { assertLocalProxyEnvironment } from './local-proxy-engine';
export function localRetentionEnabled() {
  try {
    assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
    return true;
  } catch {
    return false;
  }
}
export const retentionNoticeKinds = [
  'RETENTION_REVIEW',
  'RETENTION_INFO',
  'RETENTION_KEPT',
  'RETENTION_RELEASED',
  'RETENTION_WITHDRAWN',
] as const;
export function retentionNoticeKind(action: string) {
  return (
    {
      REQUEST: 'RETENTION_REVIEW',
      SUPPLEMENT: 'RETENTION_REVIEW',
      INFO: 'RETENTION_INFO',
      KEEP: 'RETENTION_KEPT',
      RELEASED: 'RETENTION_RELEASED',
      WITHDRAW: 'RETENTION_WITHDRAWN',
    } as Record<string, (typeof retentionNoticeKinds)[number]>
  )[action];
}
// Same transaction as the immutable review event; no external delivery.
export async function routeRetentionEvent(
  tx: Prisma.TransactionClient,
  event: { id: string; kind: string; actorId: string },
  requestId: string,
) {
  const request = await tx.retentionReviewRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { protection: { include: { conversation: true } } },
  });
  const c = request.protection.conversation;
  const assignment = await tx.adminWorkItem.findUnique({
    where: { kind_recordId: { kind: 'retention', recordId: requestId } },
  });
  const broadcast = ['REQUEST', 'SUPPLEMENT'].includes(event.kind);
  const candidates = broadcast
    ? undefined
    : [request.requesterId, ...(assignment?.ownerId ? [assignment.ownerId] : [])];
  const recipients = await tx.user.findMany({
    where: {
      role: 'ADMIN',
      suspendedAt: null,
      isSample: false,
      id: {
        notIn: [event.actorId, c.buyerId, c.sellerId, ...(broadcast ? [request.requesterId] : [])],
        ...(candidates ? { in: candidates } : {}),
      },
    },
    select: { id: true },
  });
  const kind = retentionNoticeKind(event.kind);
  if (kind && recipients.length)
    await tx.notification.createMany({
      data: recipients.map((u) => ({
        userId: u.id,
        eventKey: 'retention:' + event.id,
        kind,
        retentionRequestId: requestId,
        vehicleId: c.vehicleId,
        vehicleName: '',
      })),
      skipDuplicates: true,
    });
  if (['KEPT', 'WITHDRAWN', 'RELEASED'].includes(request.status))
    await tx.adminWorkItem.updateMany({
      where: { kind: 'retention', recordId: requestId, ownerId: { not: null } },
      data: { ownerId: null, version: { increment: 1 } },
    });
}
export function retentionNotificationVisibility(
  userId: string,
  role: string,
): Prisma.NotificationWhereInput {
  const publicKinds = { NOT: { kind: { startsWith: 'RETENTION_' } } };
  if (role !== 'ADMIN' || !localRetentionEnabled()) return publicKinds;
  return {
    OR: [
      publicKinds,
      {
        retentionRequest: {
          protection: { conversation: { buyerId: { not: userId }, sellerId: { not: userId } } },
        },
      },
    ],
  };
}
