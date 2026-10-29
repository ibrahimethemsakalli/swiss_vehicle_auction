import type { PrismaClient } from '../generated/prisma/client';

export async function notifyAppointmentReminders(db: PrismaClient) {
  const start = new Date(),
    end = new Date(start.getTime() + 86400000);
  // Anti-join keeps previously notified appointments from starving later batches.
  const candidates = await db.$queryRaw<{ id: string; buyerId: string; sellerId: string }[]>`
    SELECT a.id, c."buyerId", c."sellerId" FROM "Appointment" a
    JOIN "Conversation" c ON c.id=a."conversationId"
    JOIN "User" buyer ON buyer.id=c."buyerId"
    JOIN "User" seller ON seller.id=c."sellerId"
    WHERE a.status='ACCEPTED' AND a."startsAt">${start} AND a."startsAt"<=${end}
    AND buyer."suspendedAt" IS NULL AND seller."suspendedAt" IS NULL AND NOT buyer."isSample" AND NOT seller."isSample"
    AND NOT EXISTS (SELECT 1 FROM "UserBlock" b WHERE (b."ownerId"=c."buyerId" AND b."targetId"=c."sellerId") OR (b."ownerId"=c."sellerId" AND b."targetId"=c."buyerId"))
    AND (NOT EXISTS (SELECT 1 FROM "Notification" n WHERE n."eventKey"='appointment-reminder:'||a.id AND n."userId"=c."buyerId")
      OR NOT EXISTS (SELECT 1 FROM "Notification" n WHERE n."eventKey"='appointment-reminder:'||a.id AND n."userId"=c."sellerId"))
    ORDER BY a."startsAt",a.id LIMIT 100`;
  let count = 0;
  for (const candidate of candidates) {
    count += await db.$transaction(async (tx) => {
      const key = `chat-pair:${[candidate.buyerId, candidate.sellerId].sort().join(':')}`;
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
      const a = await tx.appointment.findUnique({
        where: { id: candidate.id },
        include: {
          conversation: {
            include: {
              buyer: { select: { suspendedAt: true, isSample: true } },
              seller: { select: { suspendedAt: true, isSample: true } },
              vehicle: { select: { make: true, model: true } },
            },
          },
        },
      });
      const now = Date.now();
      if (
        !a ||
        a.status !== 'ACCEPTED' ||
        a.startsAt.getTime() <= now ||
        a.startsAt.getTime() > now + 86400000
      )
        return 0;
      const c = a.conversation;
      if ([c.buyer, c.seller].some((u) => u.suspendedAt || u.isSample)) return 0;
      if (
        await tx.userBlock.count({
          where: {
            OR: [
              { ownerId: c.buyerId, targetId: c.sellerId },
              { ownerId: c.sellerId, targetId: c.buyerId },
            ],
          },
        })
      )
        return 0;
      return (
        await tx.notification.createMany({
          skipDuplicates: true,
          data: [c.buyerId, c.sellerId].map((userId) => ({
            userId,
            eventKey: `appointment-reminder:${a.id}`,
            kind: 'CHAT_REMINDER',
            vehicleId: c.vehicleId,
            vehicleName: `${c.vehicle.make} ${c.vehicle.model}`.slice(0, 181),
          })),
        })
      ).count;
    });
  }
  return { count };
}
