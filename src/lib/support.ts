import { z } from 'zod';
import type { PrismaClient, Prisma } from '../generated/prisma/client';
import { routeSupportEntry } from './support-routing';
import { historyFilters, readFilteredHistory } from './support-history-search';
export const supportStates = ['OPEN', 'WAITING_USER', 'RESOLVED', 'CLOSED'] as const;
export const supportCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      commandId: z.uuid(),
      subject: z.string().trim().min(5).max(160),
      body: z.string().trim().min(10).max(4000),
    })
    .strict(),
  z
    .object({
      action: z.literal('reply'),
      commandId: z.uuid(),
      id: z.uuid(),
      version: z.number().int().min(0),
      body: z.string().trim().min(10).max(4000),
      status: z.enum(supportStates).optional(),
    })
    .strict(),
]);
export const supportQuery = z
  .object({
    admin: z.enum(['true', 'false']).default('false'),
    id: z.uuid().optional(),
    newest: z.enum(['true', 'false']).default('false'),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    status: z.enum(supportStates).optional(),
    assignment: z.enum(['all', 'mine', 'unassigned']).default('all'),
    unread: z.enum(['true', 'false']).default('false'),
    q: z.string().trim().max(160).default(''),
    message: z.string().max(160).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    context: z.uuid().optional(),
  })
  .strict();
export async function supportRead(db: PrismaClient, userId: string, raw: unknown) {
  const q = supportQuery.parse(raw);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.suspendedAt || user.isSample || (q.admin === 'true' && user.role !== 'ADMIN'))
    throw Error('FORBIDDEN');
  if (q.assignment !== 'all' && q.admin !== 'true') throw Error('FORBIDDEN');
  // Treat SQL LIKE metacharacters as literal text, not search wildcards.
  const search = q.q.replace(/[\\%_]/g, '\\$&');
  const where: Prisma.SupportTicketWhereInput = {
    ...(q.admin === 'true' ? {} : { userId }),
    ...(q.status ? { status: q.status } : {}),
    ...(q.assignment === 'mine'
      ? { ownerId: userId }
      : q.assignment === 'unassigned'
        ? { ownerId: null }
        : {}),
    ...(q.unread === 'true'
      ? { entries: { some: { actorId: { not: userId }, reads: { none: { userId } } } } }
      : {}),
    ...(q.q
      ? { OR: [{ subject: { contains: search, mode: 'insensitive' } }, { id: q.q.toLowerCase() }] }
      : {}),
  };
  if (q.id) {
    const ticket = await db.supportTicket.findFirst({
      where: { id: q.id, ...(q.admin === 'true' ? {} : { userId }) },
    });
    if (!ticket) throw Error('NOT_FOUND');
    if (q.message !== undefined || q.from || q.to || q.context) {
      return readFilteredHistory(db, ticket.id, q.page, historyFilters.parse(q));
    }
    const entries = await db.supportEntry.findMany({
      include: { reads: { where: { userId }, select: { userId: true } } },
      where: { ticketId: ticket.id },
      orderBy:
        q.newest === 'true'
          ? [{ createdAt: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: q.newest === 'true' ? 0 : (q.page - 1) * 30,
      take: 31,
    });
    const admins =
      q.admin === 'true'
        ? await db.user.findMany({
            where: {
              role: 'ADMIN',
              suspendedAt: null,
              isSample: false,
              id: { not: ticket.userId },
            },
            select: { id: true, email: true },
          })
        : [];
    const assignments =
      q.admin === 'true'
        ? await db.supportAssignment.findMany({
            where: { ticketId: ticket.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 20,
            select: {
              id: true,
              actorId: true,
              ownerId: true,
              previousOwnerId: true,
              reason: true,
              createdAt: true,
            },
          })
        : [];
    const unreadCount = await db.supportEntry.count({
      where: { ticketId: ticket.id, actorId: { not: userId }, reads: { none: { userId } } },
    });
    return {
      ticket,
      admins,
      assignments,
      unreadCount,
      entries: (q.newest === 'true' ? entries.slice(0, 30).reverse() : entries.slice(0, 30)).map(
        ({ reads, payload, ...e }) => ({
          ...e,
          unread: e.actorId !== userId && !reads.length,
        }),
      ),
      more: entries.length > 30,
    };
  }
  const items = await db.supportTicket.findMany({
    where,
    include: {
      _count: {
        select: { entries: { where: { actorId: { not: userId }, reads: { none: { userId } } } } },
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: (q.page - 1) * 20,
    take: 21,
  });
  return {
    items: items.slice(0, 20).map(({ _count, ...i }) => ({ ...i, unreadCount: _count.entries })),
    more: items.length > 20,
  };
}
export async function supportWrite(db: PrismaClient, userId: string, raw: unknown) {
  const c = supportCommand.parse(raw);
  return db.$transaction(async (tx) => {
    // Serialise per actor for quotas/retries and per ticket for replies/status races.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.suspendedAt || user.isSample) throw Error('FORBIDDEN');
    const previous = await tx.supportEntry.findUnique({
      where: { actorId_commandId: { actorId: userId, commandId: c.commandId } },
    });
    const payload = JSON.stringify(c);
    if (previous) {
      if (previous.payload !== payload) throw Error('CONFLICT');
      return { id: previous.ticketId };
    }
    if (
      (await tx.supportEntry.count({
        where: { actorId: userId, createdAt: { gte: new Date(Date.now() - 3600000) } },
      })) >= 30
    )
      throw Error('RATE_LIMITED');
    let ticket;
    if (c.action === 'create') {
      if (
        (await tx.supportTicket.count({
          where: { userId, status: { in: ['OPEN', 'WAITING_USER'] } },
        })) >= 10
      )
        throw Error('LIMIT');
      ticket = await tx.supportTicket.create({ data: { userId, subject: c.subject } });
    } else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.id}))`;
      ticket = await tx.supportTicket.findUnique({ where: { id: c.id } });
      if (!ticket || (ticket.userId !== userId && user.role !== 'ADMIN')) throw Error('NOT_FOUND');
      if (ticket.version !== c.version) throw Error('CONFLICT');
      const staff = user.role === 'ADMIN' && ticket.userId !== userId;
      if (c.status && !staff) throw Error('FORBIDDEN');
      if (ticket.status === 'CLOSED' && !staff) throw Error('CLOSED');
      ticket = await tx.supportTicket.update({
        where: { id: c.id },
        data: { status: staff ? (c.status ?? ticket.status) : 'OPEN', version: { increment: 1 } },
      });
    }
    const entry = await tx.supportEntry.create({
      data: {
        ticketId: ticket.id,
        actorId: userId,
        commandId: c.commandId,
        payload,
        body: c.body,
        staff: user.role === 'ADMIN' && ticket.userId !== userId,
        status: ticket.status,
      },
    });
    await routeSupportEntry(tx, ticket, entry);
    return { id: ticket.id };
  });
}
