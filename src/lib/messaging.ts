import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

const id = z.uuid();
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));
export const chatCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), vehicleId: id }).strict(),
  z
    .object({ action: z.literal('send'), conversationId: id, requestId: id, body: text(2000) })
    .strict(),
  z
    .object({
      action: z.literal('propose'),
      conversationId: id,
      requestId: id,
      startsAt: z.iso.datetime(),
      location: text(200),
    })
    .strict(),
  z
    .object({
      action: z.literal('appointment'),
      conversationId: id,
      id,
      decision: z.enum(['ACCEPTED', 'DECLINED', 'CANCELLED']),
    })
    .strict(),
  z.object({ action: z.literal('block'), conversationId: id, blocked: z.boolean() }).strict(),
  z
    .object({
      action: z.literal('report'),
      conversationId: id,
      messageId: id,
      category: z.enum(['SPAM', 'ABUSE', 'FRAUD', 'PERSONAL_DATA', 'OTHER']),
      note: text(1000),
    })
    .strict(),
  z.object({ action: z.literal('review'), id, decision: z.enum(['DISMISSED', 'HIDDEN']) }).strict(),
]);
export const chatQuery = z
  .object({
    conversationId: id.optional(),
    before: id.optional(),
    reports: z.enum(['true']).optional(),
  })
  .strict();
type Tx = Prisma.TransactionClient;
function fail(code: string): never {
  throw new Error(code);
}
async function user(tx: Tx, id: string) {
  const u = await tx.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      suspendedAt: true,
      isSample: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
    },
  });
  if (!u || u.suspendedAt || u.isSample) fail('FORBIDDEN');
  return u;
}
async function member(tx: Tx, userId: string, conversationId: string) {
  const c = await tx.conversation.findFirst({
    where: { id: conversationId, OR: [{ buyerId: userId }, { sellerId: userId }] },
    include: { vehicle: { select: { make: true, model: true } } },
  });
  if (!c) fail('FORBIDDEN');
  return c;
}
function other(c: { buyerId: string; sellerId: string }, me: string) {
  return c.buyerId === me ? c.sellerId : c.buyerId;
}
async function pairLock(tx: Tx, a: string, b: string) {
  const key = `chat-pair:${[a, b].sort().join(':')}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
}
async function blocks(tx: Tx, a: string, b: string) {
  return tx.userBlock.findMany({
    where: {
      OR: [
        { ownerId: a, targetId: b },
        { ownerId: b, targetId: a },
      ],
    },
  });
}
async function quota(tx: Tx, userId: string) {
  const bucket = Math.floor(Date.now() / 60000);
  const entry = await tx.rateLimit.upsert({
    where: { key: `chat:${userId}:${bucket}` },
    create: { key: `chat:${userId}:${bucket}`, expiresAt: new Date((bucket + 1) * 60000) },
    update: { count: { increment: 1 } },
  });
  if (entry.count > 20) fail('RATE_LIMITED');
}
async function notice(
  tx: Tx,
  c: { id: string; vehicleId: string; vehicle: { make: string; model: string } },
  recipient: string,
  key: string,
  kind: string,
) {
  await tx.notification.createMany({
    data: [
      {
        userId: recipient,
        eventKey: `chat:${key}`,
        kind,
        vehicleId: c.vehicleId,
        vehicleName: `${c.vehicle.make} ${c.vehicle.model}`.slice(0, 181),
      },
    ],
    skipDuplicates: true,
  });
}
export async function mutateChat(db: PrismaClient, userId: string, raw: unknown) {
  const input = chatCommand.parse(raw);
  return db.$transaction(async (tx) => {
    const actor = await user(tx, userId);
    const actorKey = `chat-user:${userId}`;
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${actorKey}))`;
    if (input.action === 'review') {
      if (actor.role !== 'ADMIN') fail('FORBIDDEN');
      const report = await tx.messageReport.findUnique({ where: { id: input.id } });
      if (!report) fail('FORBIDDEN');
      const updated = await tx.messageReport.updateMany({
        where: { id: input.id, status: 'OPEN' },
        data: { status: input.decision, reviewedBy: userId, reviewedAt: new Date() },
      });
      if (updated.count && input.decision === 'HIDDEN')
        await tx.chatMessage.update({
          where: { id: report.messageId },
          data: { hiddenAt: new Date() },
        });
      return { ok: true };
    }
    if (input.action === 'start') {
      const v = await tx.vehicle.findUnique({
        where: { id: input.vehicleId },
        include: { settlement: { include: { bid: { select: { userId: true } } } } },
      });
      if (!v || v.isSample) fail('CHAT_UNAVAILABLE');
      const buyerId = v.userId === userId ? v.settlement?.bid.userId : userId;
      if (!buyerId || buyerId === v.userId) fail('CHAT_UNAVAILABLE');
      await pairLock(tx, buyerId, v.userId);
      const peer = await user(tx, v.userId === userId ? buyerId : v.userId);
      if ((await blocks(tx, buyerId, v.userId)).length) fail('CHAT_BLOCKED');
      const old = await tx.conversation.findUnique({
        where: { vehicleId_buyerId: { vehicleId: v.id, buyerId } },
      });
      if (old) return { id: old.id };
      if (
        !actor.emailVerifiedAt ||
        !actor.phoneVerifiedAt ||
        !peer.emailVerifiedAt ||
        !peer.phoneVerifiedAt
      )
        fail('VERIFICATION_REQUIRED');
      const active =
        v.status === 'ACTIVE' &&
        (v.listingType !== 'AUCTION_7_DAYS' || (!!v.auctionEndsAt && v.auctionEndsAt > new Date()));
      if (!active && v.settlement?.bid.userId !== buyerId) fail('CHAT_UNAVAILABLE');
      await quota(tx, userId);
      const c = await tx.conversation.create({
        data: { vehicleId: v.id, buyerId, sellerId: v.userId },
      });
      return { id: c.id };
    }
    const c = await member(tx, userId, input.conversationId),
      peerId = other(c, userId);
    await pairLock(tx, userId, peerId);
    if (input.action === 'block') {
      await quota(tx, userId);
      if (input.blocked) {
        await tx.userBlock.upsert({
          where: { ownerId_targetId: { ownerId: userId, targetId: peerId } },
          create: { ownerId: userId, targetId: peerId },
          update: {},
        });
        // Pending invitations are withdrawn across this pair. Confirmed appointments remain visible and cancellable.
        await tx.appointment.updateMany({
          where: {
            status: 'PENDING',
            conversation: {
              OR: [
                { buyerId: userId, sellerId: peerId },
                { buyerId: peerId, sellerId: userId },
              ],
            },
          },
          data: { status: 'CANCELLED' },
        });
      } else await tx.userBlock.deleteMany({ where: { ownerId: userId, targetId: peerId } });
      return { ok: true };
    }
    if (input.action === 'report') {
      const message = await tx.chatMessage.findFirst({
        where: { id: input.messageId, conversationId: c.id, senderId: peerId },
      });
      if (!message) fail('FORBIDDEN');
      await quota(tx, userId);
      await tx.messageReport.upsert({
        where: { messageId_reporterId: { messageId: message.id, reporterId: userId } },
        create: {
          messageId: message.id,
          reporterId: userId,
          category: input.category,
          note: input.note,
        },
        update: {},
      });
      return { ok: true };
    }
    if (input.action === 'appointment' && input.decision === 'CANCELLED') {
      await quota(tx, userId);
      const a = await tx.appointment.findFirst({ where: { id: input.id, conversationId: c.id } });
      if (!a) fail('FORBIDDEN');
      await tx.appointment.updateMany({
        where: { id: a.id, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: { status: 'CANCELLED' },
      });
      if (['PENDING', 'ACCEPTED'].includes(a.status))
        await notice(tx, c, peerId, `${a.id}:CANCELLED`, 'CHAT_APPOINTMENT');
      return { ok: true };
    }
    await user(tx, peerId);
    if ((await blocks(tx, userId, peerId)).length) fail('CHAT_BLOCKED');
    if (!actor.emailVerifiedAt || !actor.phoneVerifiedAt) fail('VERIFICATION_REQUIRED');
    if (input.action === 'send') {
      const old = await tx.chatMessage.findUnique({
        where: { senderId_requestId: { senderId: userId, requestId: input.requestId } },
      });
      if (old) {
        if (old.conversationId !== c.id || old.body !== input.body) fail('CHAT_CONFLICT');
        return { id: old.id };
      }
      await quota(tx, userId);
      const m = await tx.chatMessage.create({
        data: {
          conversationId: c.id,
          senderId: userId,
          requestId: input.requestId,
          body: input.body,
        },
      });
      await tx.conversation.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
      await notice(tx, c, peerId, m.id, 'CHAT_MESSAGE');
      return { id: m.id };
    }
    if (input.action === 'propose') {
      const old = await tx.appointment.findUnique({
        where: { proposerId_requestId: { proposerId: userId, requestId: input.requestId } },
      });
      if (old) {
        if (
          old.conversationId !== c.id ||
          old.startsAt.getTime() !== new Date(input.startsAt).getTime() ||
          old.location !== input.location
        )
          fail('CHAT_CONFLICT');
        return { id: old.id };
      }
      const date = new Date(input.startsAt);
      if (date.getTime() < Date.now() + 5 * 60000 || date.getTime() > Date.now() + 90 * 86400000)
        fail('CHAT_DATE');
      await quota(tx, userId);
      await tx.appointment.updateMany({
        where: {
          conversationId: c.id,
          status: { in: ['PENDING', 'ACCEPTED'] },
          startsAt: { lte: new Date() },
        },
        data: { status: 'EXPIRED' },
      });
      if (
        await tx.appointment.count({
          where: { conversationId: c.id, status: { in: ['PENDING', 'ACCEPTED'] } },
        })
      )
        fail('CHAT_CONFLICT');
      const a = await tx.appointment.create({
        data: {
          conversationId: c.id,
          proposerId: userId,
          requestId: input.requestId,
          startsAt: date,
          location: input.location,
        },
      });
      await notice(tx, c, peerId, a.id, 'CHAT_APPOINTMENT');
      return { id: a.id };
    }
    const a = await tx.appointment.findFirst({ where: { id: input.id, conversationId: c.id } });
    if (!a || a.proposerId === userId) fail('FORBIDDEN');
    if (a.status === input.decision) return { ok: true };
    if (a.status !== 'PENDING' || a.startsAt <= new Date()) fail('CHAT_CONFLICT');
    await quota(tx, userId);
    await tx.appointment.update({ where: { id: a.id }, data: { status: input.decision } });
    await notice(tx, c, peerId, `${a.id}:${input.decision}`, 'CHAT_APPOINTMENT');
    return { ok: true };
  });
}

export async function readChat(db: PrismaClient, userId: string, raw: unknown) {
  const q = chatQuery.parse(raw),
    actor = await user(db, userId);
  if (q.reports) {
    if (actor.role !== 'ADMIN') fail('FORBIDDEN');
    const rows = await db.messageReport.findMany({
      where: { status: 'OPEN' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
      select: {
        id: true,
        category: true,
        note: true,
        createdAt: true,
        message: {
          select: {
            body: true,
            hiddenAt: true,
            conversation: { select: { vehicle: { select: { make: true, model: true } } } },
          },
        },
      },
    });
    return { reports: rows };
  }
  if (!q.conversationId) {
    const where = { OR: [{ buyerId: userId }, { sellerId: userId }] };
    const cursor = q.before
      ? await db.conversation.findFirst({ where: { ...where, id: q.before } })
      : null;
    if (q.before && !cursor) fail('FORBIDDEN');
    const rows = await db.conversation.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 31,
      select: {
        id: true,
        buyerId: true,
        createdAt: true,
        vehicle: { select: { make: true, model: true } },
      },
    });
    return {
      canModerate: actor.role === 'ADMIN',
      conversations: rows
        .slice(0, 30)
        .map(({ buyerId, ...c }) => ({ ...c, role: buyerId === userId ? 'buyer' : 'seller' })),
      next: rows.length > 30 ? rows[29].id : null,
    };
  }
  const c = await member(db, userId, q.conversationId),
    peerId = other(c, userId);
  const peer = await db.user.findUnique({
    where: { id: peerId },
    select: { suspendedAt: true, isSample: true },
  });
  const b = await blocks(db, userId, peerId);
  const cursor = q.before
    ? await db.chatMessage.findFirst({ where: { id: q.before, conversationId: c.id } })
    : null;
  if (q.before && !cursor) fail('FORBIDDEN');
  const rows = await db.chatMessage.findMany({
    where: {
      conversationId: c.id,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 51,
  });
  const appointments = await db.appointment.findMany({
    where: { conversationId: c.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
  });
  return {
    id: c.id,
    vehicleName: `${c.vehicle.make} ${c.vehicle.model}`,
    role: c.buyerId === userId ? 'buyer' : 'seller',
    blocked: b.length > 0,
    ownBlock: b.some((x) => x.ownerId === userId),
    canSend:
      !b.length &&
      !!peer &&
      !peer.suspendedAt &&
      !peer.isSample &&
      !!actor.emailVerifiedAt &&
      !!actor.phoneVerifiedAt,
    messages: rows
      .slice(0, 50)
      .reverse()
      .map((m) => ({
        id: m.id,
        own: m.senderId === userId,
        body: m.hiddenAt ? null : m.body,
        createdAt: m.createdAt,
      })),
    next: rows.length > 50 ? rows[49].id : null,
    appointments: appointments.map((a) => ({
      id: a.id,
      own: a.proposerId === userId,
      startsAt: a.startsAt,
      location: a.location,
      status:
        ['PENDING', 'ACCEPTED'].includes(a.status) && a.startsAt <= new Date()
          ? 'EXPIRED'
          : a.status,
    })),
  };
}
