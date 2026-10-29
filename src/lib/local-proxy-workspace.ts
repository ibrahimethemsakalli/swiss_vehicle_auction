import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { createLocalProxyEngine, assertLocalProxyEnvironment } from './local-proxy-engine';
import { finishLocalProxy } from './local-proxy-lifecycle';
import { settleLocalProxy } from './local-proxy-sale';
import { localRefundCommand, refundLocalProxy } from './local-proxy-refund';
import { readLocalLedger } from './local-proxy-ledger';
type Tx = Prisma.TransactionClient;
const names = ['private_user', 'dealer', 'admin'] as const;
const roles = ['PRIVATE_USER', 'DEALER', 'ADMIN'] as const;
export const proxyWorkspaceCommand = z.discriminatedUnion('action', [
  ...localRefundCommand.options,
  z.object({ action: z.literal('renew'), auctionId: z.uuid(), requestId: z.uuid() }).strict(),
  z.object({ action: z.literal('confirm'), auctionId: z.uuid(), requestId: z.uuid() }).strict(),
  z.object({ action: z.literal('close'), auctionId: z.uuid() }).strict(),
  z.object({ action: z.literal('cancel'), auctionId: z.uuid() }).strict(),
  z.object({ action: z.literal('create'), requestId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('bid'),
      auctionId: z.uuid(),
      requestId: z.uuid(),
      maximum: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
    })
    .strict(),
]);
export async function localProxyAccount(db: Tx, id: string) {
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
      suspendedAt: true,
      isSample: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      isIdentityVerified: true,
    },
  });
  const i = names.findIndex((n) => u?.email === `${n}@local.autoveri.test`);
  if (
    !u ||
    i < 0 ||
    u.phone !== `LOCAL-LOGIN-${i}` ||
    u.role !== roles[i] ||
    u.suspendedAt ||
    u.isSample ||
    !u.emailVerifiedAt ||
    !u.phoneVerifiedAt ||
    !u.isIdentityVerified
  )
    throw Error('FORBIDDEN');
  return u;
}
async function membership(db: Tx, id: string, auctionId: string) {
  await localProxyAccount(db, id);
  const m = await db.localProxyMember.findUnique({
    where: { auctionId_userId: { auctionId, userId: id } },
  });
  if (!m) throw Error('FORBIDDEN');
  return m;
}
export async function readProxyWorkspace(db: PrismaClient, id: string, raw: unknown) {
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  const q = z
    .union([
      z.object({ view: z.literal('ledger') }).strict(),
      z.object({ auctionId: z.uuid().optional() }).strict(),
    ])
    .parse(raw);
  if ('view' in q)
    return readLocalLedger(db, async (tx) => {
      if ((await localProxyAccount(tx, id)).role !== 'ADMIN') throw Error('FORBIDDEN');
    });
  return db.$transaction(
    async (tx) => {
      const u = await localProxyAccount(tx, id);
      if (!q.auctionId) {
        const rooms = await tx.localProxyRoom.findMany({
          where: { members: { some: { userId: id } } },
          orderBy: [{ createdAt: 'desc' }, { auctionId: 'asc' }],
          take: 50,
          select: { auctionId: true, createdAt: true },
        });
        return { canCreate: u.role === 'ADMIN', rooms };
      }
      const m = await membership(tx, id, q.auctionId),
        a = await tx.localProxyAuction.findUniqueOrThrow({ where: { id: q.auctionId } });
      const seller = m.actorId === a.sellerId;
      const own = seller
        ? null
        : await tx.localProxyLimit.findUnique({
            where: { auctionId_ownerId: { auctionId: a.id, ownerId: m.actorId } },
            include: { hold: true },
          });
      const leader = a.leaderId
        ? await tx.localProxyLimit.findUnique({
            where: { auctionId_ownerId: { auctionId: a.id, ownerId: a.leaderId } },
            include: { hold: true },
          })
        : null;
      const [{ millis }] = await tx.$queryRaw<
        { millis: bigint }[]
      >`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS millis`;
      const now = Number(millis),
        closed = a.status !== 'OPEN' || now >= +a.endsAt,
        blocked =
          !!a.leaderId &&
          (!leader || leader.hold.status !== 'AUTHORIZED' || +leader.hold.expiresAt <= now);
      return {
        auctionId: a.id,
        refundCase:
          seller || m.actorId === a.winnerId
            ? await tx.localProxyRefundCase.findUnique({
                where: { auctionId: a.id },
                select: {
                  reason: true,
                  status: true,
                  requestedAt: true,
                  decisionNote: true,
                  reviewedAt: true,
                  refund: { select: { amountCents: true, currency: true, refundedAt: true } },
                },
              })
            : null,
        capture: await tx.localProxyCapture.findUnique({
          where: { auctionId: a.id },
          select: { amountCents: true, currency: true, capturedAt: true },
        }),
        status: a.status,
        winner: !a.winnerId ? 'NONE' : a.winnerId === m.actorId ? 'YOU' : 'OTHER',
        closedAt: a.closedAt?.toISOString() ?? null,
        cancelledAt: a.cancelledAt?.toISOString() ?? null,
        priceCents: a.priceCents?.toString() ?? null,
        startCents: a.startCents.toString(),
        incrementCents: a.incrementCents.toString(),
        version: a.version,
        endsAt: a.endsAt.toISOString(),
        serverNow: new Date(now).toISOString(),
        closed,
        blocked,
        canBid: !seller && !closed && !blocked && now >= +a.startsAt,
        role: seller ? 'SELLER' : 'BUYER',
        leader: !a.leaderId ? 'NONE' : a.leaderId === m.actorId ? 'YOU' : 'OTHER',
        own: own
          ? {
              maximumCents: own.maximumCents.toString(),
              hold: {
                amountCents: own.hold.amountCents,
                currency: own.hold.currency,
                status:
                  own.hold.status === 'AUTHORIZED' && +own.hold.expiresAt <= now
                    ? 'EXPIRED'
                    : own.hold.status,
                expiresAt: own.hold.expiresAt.toISOString(),
              },
            }
          : null,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
export async function changeProxyWorkspace(
  db: PrismaClient,
  id: string,
  raw: unknown,
  databaseUrl: string,
) {
  assertLocalProxyEnvironment(databaseUrl);
  const c = proxyWorkspaceCommand.parse(raw);
  const u = await localProxyAccount(db, id);
  if (c.action === 'requestRefund' || c.action === 'approveRefund' || c.action === 'rejectRefund') {
    return refundLocalProxy(db, c, async (tx) => {
      const current = await localProxyAccount(tx, id);
      const m = await membership(tx, id, c.auctionId);
      return { actorId: m.actorId, isAdmin: current.role === 'ADMIN' };
    });
  }
  if (c.action === 'renew' || c.action === 'confirm') {
    return settleLocalProxy(db, c.auctionId, c.action, c.requestId, async (tx) => {
      const current = await localProxyAccount(tx, id);
      const m = await membership(tx, id, c.auctionId);
      if (c.action === 'confirm' && current.role !== 'ADMIN') throw Error('FORBIDDEN');
      return m.actorId;
    });
  }
  if (c.action === 'close' || c.action === 'cancel') {
    if (u.role !== 'ADMIN') throw Error('FORBIDDEN');
    return finishLocalProxy(db, c.auctionId, c.action, async (tx) => {
      const current = await localProxyAccount(tx, id);
      const m = await membership(tx, id, c.auctionId);
      const a = await tx.localProxyAuction.findUniqueOrThrow({ where: { id: c.auctionId } });
      if (current.role !== 'ADMIN' || m.actorId !== a.sellerId) throw Error('FORBIDDEN');
    });
  }
  if (c.action === 'create') {
    if (u.role !== 'ADMIN') throw Error('FORBIDDEN');
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('local-proxy-rooms'))`;
      const actor = await localProxyAccount(tx, id);
      if (actor.role !== 'ADMIN') throw Error('FORBIDDEN');
      const existing = await tx.localProxyRoom.findUnique({
        where: { creatorUserId_requestId: { creatorUserId: id, requestId: c.requestId } },
      });
      if (existing) return { auctionId: existing.auctionId };
      if ((await tx.localProxyRoom.count()) >= 50) throw Error('LOCAL_PROXY_QUOTA');
      const users = await Promise.all(
        names.map((n) =>
          tx.user.findUnique({
            where: { email: `${n}@local.autoveri.test` },
            select: { id: true },
          }),
        ),
      );
      if (users.some((v) => !v)) throw Error('FIXTURE_ACCOUNTS_REQUIRED');
      for (const user of users) await localProxyAccount(tx, user!.id);
      const [{ millis }] = await tx.$queryRaw<
        { millis: bigint }[]
      >`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS millis`;
      const now = new Date(Number(millis)),
        sellerId = randomUUID(),
        buyerIds = [randomUUID(), randomUUID()];
      const a = await tx.localProxyAuction.create({
        data: {
          sellerId,
          buyerIds,
          startCents: 100000n,
          incrementCents: 10000n,
          startsAt: now,
          endsAt: new Date(+now + 1800000),
        },
      });
      await tx.localProxyRoom.create({
        data: {
          auctionId: a.id,
          creatorUserId: id,
          requestId: c.requestId,
          members: {
            create: users.map((user, i) => ({
              userId: user!.id,
              actorId: i === 2 ? sellerId : buyerIds[i],
            })),
          },
        },
      });
      return { auctionId: a.id };
    });
  }
  const m = await membership(db, id, c.auctionId),
    engine = createLocalProxyEngine(databaseUrl);
  try {
    await engine.submit(
      m.actorId,
      { auctionId: c.auctionId, requestId: c.requestId, maximum: c.maximum },
      async (tx) => {
        const current = await membership(tx, id, c.auctionId);
        if (current.actorId !== m.actorId) throw Error('FORBIDDEN');
      },
    );
    // Do not expose internal actor identifiers or stale receipt snapshots to HTTP clients.
    return { ok: true, auctionId: c.auctionId };
  } finally {
    await engine.disconnect();
  }
}
