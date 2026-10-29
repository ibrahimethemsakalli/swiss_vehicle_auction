import { z } from 'zod';
import type { PrismaClient, Prisma } from '../generated/prisma/client';
export const supportRoutingCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('assign'),
      id: z.uuid(),
      commandId: z.uuid(),
      version: z.number().int().min(0),
      ownerId: z.uuid().nullable(),
      reason: z.string().trim().min(5).max(500),
    })
    .strict(),
  z
    .object({ action: z.literal('read'), id: z.uuid(), entryIds: z.array(z.uuid()).min(1).max(30) })
    .strict(),
]);
export function supportNotificationVisibility(
  userId: string,
  role: string,
): Prisma.NotificationWhereInput {
  return {
    OR: [
      { NOT: { kind: { startsWith: 'SUPPORT_' } } },
      { supportTicket: role === 'ADMIN' ? { id: { not: '' } } : { userId } },
    ],
  };
}
export async function routeSupportEntry(
  tx: Prisma.TransactionClient,
  ticket: { id: string; userId: string; ownerId: string | null },
  entry: { id: string; actorId: string; staff: boolean },
) {
  const eligible = {
    role: 'ADMIN' as const,
    suspendedAt: null,
    isSample: false,
    id: { notIn: [ticket.userId, entry.actorId] },
  };
  let recipients: string[] = [];
  if (entry.staff) {
    const user = await tx.user.findUnique({ where: { id: ticket.userId } });
    if (user && !user.suspendedAt && !user.isSample) recipients = [user.id];
  } else {
    const owner = ticket.ownerId
      ? await tx.user.findFirst({
          where: {
            ...eligible,
            id: { equals: ticket.ownerId, notIn: [ticket.userId, entry.actorId] },
          },
        })
      : null;
    recipients = owner
      ? [owner.id]
      : (await tx.user.findMany({ where: eligible, select: { id: true } })).map((u) => u.id);
  }
  await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      eventKey: 'support-entry:' + entry.id,
      kind: entry.staff ? 'SUPPORT_REPLY' : 'SUPPORT_ACTIVITY',
      supportTicketId: ticket.id,
      vehicleId: '',
      vehicleName: '',
    })),
    skipDuplicates: true,
  });
}
export async function supportRoutingWrite(db: PrismaClient, userId: string, raw: unknown) {
  const c = supportRoutingCommand.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.id}))`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.suspendedAt || user.isSample) throw Error('FORBIDDEN');
    const ticket = await tx.supportTicket.findUnique({ where: { id: c.id } });
    if (!ticket || (ticket.userId !== userId && user.role !== 'ADMIN')) throw Error('NOT_FOUND');
    if (c.action === 'read') {
      const entries = await tx.supportEntry.findMany({
        where: { ticketId: c.id, id: { in: c.entryIds }, actorId: { not: userId } },
        select: { id: true },
      });
      // Exact entry IDs: reading a page never marks unseen or later replies as read.
      await tx.supportRead.createMany({
        data: entries.map((e) => ({ entryId: e.id, userId })),
        skipDuplicates: true,
      });
      return { id: c.id };
    }
    if (user.role !== 'ADMIN' || ticket.userId === userId) throw Error('FORBIDDEN');
    const payload = JSON.stringify(c);
    const prior = await tx.supportAssignment.findUnique({
      where: { actorId_commandId: { actorId: userId, commandId: c.commandId } },
    });
    if (prior) {
      if (prior.payload !== payload) throw Error('CONFLICT');
      return { id: c.id };
    }
    if (ticket.version !== c.version) throw Error('CONFLICT');
    if (ticket.status === 'CLOSED') throw Error('CLOSED');
    if (c.ownerId) {
      const owner = await tx.user.findFirst({
        where: { id: c.ownerId, role: 'ADMIN', suspendedAt: null, isSample: false },
      });
      if (!owner || owner.id === ticket.userId) throw Error('FORBIDDEN');
    }
    if (c.ownerId === ticket.ownerId) throw Error('CONFLICT');
    const event = await tx.supportAssignment.create({
      data: {
        ticketId: c.id,
        actorId: userId,
        commandId: c.commandId,
        payload,
        previousOwnerId: ticket.ownerId,
        ownerId: c.ownerId,
        reason: c.reason,
      },
    });
    await tx.supportTicket.update({
      where: { id: c.id },
      data: { ownerId: c.ownerId, version: { increment: 1 } },
    });
    const targets = await tx.user.findMany({
      where: {
        id: { in: [ticket.ownerId, c.ownerId].filter((id): id is string => !!id), not: userId },
        role: 'ADMIN',
        suspendedAt: null,
        isSample: false,
      },
      select: { id: true },
    });
    await tx.notification.createMany({
      data: targets.map((u) => ({
        userId: u.id,
        eventKey: 'support-assignment:' + event.id,
        kind: 'SUPPORT_ASSIGNMENT',
        supportTicketId: c.id,
        vehicleId: '',
        vehicleName: '',
      })),
      skipDuplicates: true,
    });
    return { id: c.id };
  });
}
