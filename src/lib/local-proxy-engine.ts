import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { createDatabaseClient } from './database-client';
import { cents, simulateBid } from './proxy-simulation';
import type { LocalProxyAuction, LocalProxyHold, Prisma } from '../generated/prisma/client';

export function assertLocalProxyEnvironment(
  url: string,
  env: Record<string, string | undefined> = process.env,
) {
  let local = false;
  try {
    const parsed = new URL(url);
    local =
      ['postgres:', 'postgresql:'].includes(parsed.protocol) &&
      [...parsed.searchParams].every(([key, value]) => key === 'schema' && value === 'public') &&
      parsed.searchParams.getAll('schema').length <= 1 &&
      !parsed.hash &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) &&
      (parsed.pathname === '/autoveri' || /^\/autoveri_[a-z0-9_]+_test$/.test(parsed.pathname));
  } catch {}
  if (
    !local ||
    env.LOCAL_PROXY_ENGINE !== 'true' ||
    !['development', 'test'].includes(env.NODE_ENV ?? '') ||
    Object.entries(env).some(
      ([key, value]) =>
        /^(STRIPE_|TWILIO_|DATATRANS_)/.test(key) &&
        !!value &&
        !['STRIPE_ALLOW_LIVE'].includes(key),
    )
  )
    throw Error('LOCAL_PROXY_DISABLED');
  if (env.STRIPE_ALLOW_LIVE === 'true') throw Error('LOCAL_PROXY_DISABLED');
}
const input = z
  .object({
    auctionId: z.uuid(),
    requestId: z.uuid(),
    maximum: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
  })
  .strict();
const fixtureInput = z
  .object({
    start: z.string(),
    increment: z.string(),
    durationSeconds: z.number().int().min(1).max(86400),
  })
  .strict();
function snapshot(a: LocalProxyAuction) {
  return {
    auctionId: a.id,
    priceCents: a.priceCents?.toString() ?? null,
    leaderId: a.leaderId,
    endsAt: a.endsAt.toISOString(),
    version: a.version,
  };
}
export function validLocalProxyHold(h: LocalProxyHold, ownerId: string, auctionId: string, now: Date) {
  return (
    h.ownerId === ownerId &&
    h.auctionId === auctionId &&
    h.gateway === 'local-proxy' &&
    h.currency === 'CHF' &&
    h.amountCents === 3000 &&
    h.status === 'AUTHORIZED' &&
    h.expiresAt > now
  );
}
// Internal trusted-caller API only. Actor IDs are synthetic fixture identities,
// not an authentication mechanism. HTTP callers must use the authenticated local workspace mapping.
export function createLocalProxyEngine(databaseUrl: string) {
  assertLocalProxyEnvironment(databaseUrl);
  const db = createDatabaseClient(databaseUrl);
  const guard = () => assertLocalProxyEnvironment(databaseUrl);
  async function member(auctionId: string, actorId: string) {
    guard();
    z.uuid().parse(auctionId);
    z.uuid().parse(actorId);
    const a = await db.localProxyAuction.findUnique({ where: { id: auctionId } });
    if (!a || (a.sellerId !== actorId && !a.buyerIds.includes(actorId))) throw Error('FORBIDDEN');
    return a;
  }
  return {
    disconnect: () => db.$disconnect(),
    async createFixture(raw: unknown) {
      guard();
      const f = fixtureInput.parse(raw),
        start = cents(f.start),
        increment = cents(f.increment);
      const [{ millis }] = await db.$queryRaw<
        { millis: bigint }[]
      >`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS millis`;
      const now = new Date(Number(millis));
      const a = await db.localProxyAuction.create({
        data: {
          sellerId: randomUUID(),
          buyerIds: [randomUUID(), randomUUID(), randomUUID()],
          startCents: BigInt(start),
          incrementCents: BigInt(increment),
          startsAt: now,
          endsAt: new Date(+now + f.durationSeconds * 1000),
        },
      });
      return { auctionId: a.id, sellerId: a.sellerId, buyerIds: a.buyerIds };
    },
    async view(auctionId: string, actorId: string) {
      return snapshot(await member(auctionId, actorId));
    },
    async ownLimit(auctionId: string, actorId: string) {
      const a = await member(auctionId, actorId);
      if (!a.buyerIds.includes(actorId)) throw Error('FORBIDDEN');
      const row = await db.localProxyLimit.findUnique({
        where: { auctionId_ownerId: { auctionId, ownerId: actorId } },
        include: { hold: true },
      });
      return row
        ? {
            maximumCents: row.maximumCents.toString(),
            hold: {
              id: row.hold.id,
              status: row.hold.status,
              amountCents: row.hold.amountCents,
              currency: row.hold.currency,
              expiresAt: row.hold.expiresAt.toISOString(),
            },
          }
        : null;
    },
    async events(auctionId: string, actorId: string) {
      await member(auctionId, actorId);
      return (
        await db.localProxyEvent.findMany({
          where: { auctionId },
          orderBy: { version: 'asc' },
          take: 1000,
          select: { payload: true },
        })
      ).map((e) => e.payload);
    },
    async submit(
      actorId: string,
      raw: unknown,
      authorize?: (tx: Prisma.TransactionClient) => Promise<void>,
    ) {
      guard();
      z.uuid().parse(actorId);
      const c = input.parse(raw),
        maximum = cents(c.maximum);
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ auctionId: c.auctionId, maximum }))
        .digest('hex');
      return db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "LocalProxyAuction" WHERE id=${c.auctionId} FOR UPDATE`;
          const a = await tx.localProxyAuction.findUnique({ where: { id: c.auctionId } });
          if (!a) throw Error('FORBIDDEN');
          if (a.sellerId === actorId) throw Error('SELF_BID');
          if (!a.buyerIds.includes(actorId)) throw Error('FORBIDDEN');
          await authorize?.(tx);
          const key = { auctionId: a.id, ownerId: actorId, requestId: c.requestId };
          const prior = await tx.localProxyCommand.findUnique({
            where: { auctionId_ownerId_requestId: key },
          });
          if (prior) {
            if (prior.fingerprint !== fingerprint) throw Error('REQUEST_CONFLICT');
            return prior.result;
          }
          if ((await tx.localProxyCommand.count({ where: { auctionId: a.id } })) >= 1000)
            throw Error('LOCAL_PROXY_QUOTA');
          const [{ millis }] = await tx.$queryRaw<
            { millis: bigint }[]
          >`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS millis`;
          const now = new Date(Number(millis));
          if (now < a.startsAt) throw Error('AUCTION_NOT_STARTED');
          if (a.status !== 'OPEN' || now >= a.endsAt) throw Error('AUCTION_ENDED');
          const leader = a.leaderId
            ? await tx.localProxyLimit.findUnique({
                where: { auctionId_ownerId: { auctionId: a.id, ownerId: a.leaderId } },
                include: { hold: true },
              })
            : null;
          if (a.leaderId && (!leader || !validLocalProxyHold(leader.hold, a.leaderId, a.id, now)))
            throw Error('LEADER_HOLD_EXPIRED');
          const ownLeader = a.leaderId === actorId;
          const expiresAt = ownLeader ? leader!.hold.expiresAt : new Date(+now + 3600000);
          const calculated = simulateBid(
            {
              start: Number(a.startCents),
              increment: Number(a.incrementCents),
              price: a.priceCents === null ? null : Number(a.priceCents),
              endsAt: +a.endsAt,
              lastAt: +a.startsAt,
              leader: leader
                ? {
                    bidder: 'A',
                    maximum: Number(leader.maximumCents),
                    holdExpiresAt: +leader.hold.expiresAt,
                  }
                : null,
              history: [],
            },
            {
              bidder: !leader || ownLeader ? 'A' : 'B',
              maximum,
              now: +now,
              holdExpiresAt: +expiresAt,
              requestId: c.requestId,
            },
          );
          const event = calculated.history[0];
          const winner =
            !leader || ownLeader || calculated.leader!.bidder === 'B' ? actorId : a.leaderId!;
          // The local gateway is the ledger itself: no network calls and no injected provider.
          const hold = ownLeader
            ? leader!.hold
            : await tx.localProxyHold.create({
                data: { auctionId: a.id, ownerId: actorId, expiresAt },
              });
          await tx.localProxyLimit.upsert({
            where: { auctionId_ownerId: { auctionId: a.id, ownerId: actorId } },
            create: {
              auctionId: a.id,
              ownerId: actorId,
              maximumCents: BigInt(maximum),
              holdId: hold.id,
            },
            update: { maximumCents: BigInt(maximum), holdId: hold.id },
          });
          if (!ownLeader && leader) {
            const released = winner === actorId ? leader.hold.id : hold.id;
            await tx.localProxyHold.update({
              where: { id: released },
              data: { status: 'RELEASED', releasedAt: now },
            });
          }
          const updated = await tx.localProxyAuction.update({
            where: { id: a.id },
            data: {
              priceCents: BigInt(calculated.price!),
              leaderId: winner,
              endsAt: new Date(calculated.endsAt),
              version: { increment: 1 },
            },
          });
          const result = { ...snapshot(updated), outcome: event.outcome, extended: event.extended };
          // Explicit public projection: never serialize limits, commands or holds into events.
          if (event.outcome !== 'RAISE_LIMIT')
            await tx.localProxyEvent.create({
              data: { auctionId: a.id, version: updated.version, payload: snapshot(updated) },
            });
          await tx.localProxyCommand.create({ data: { ...key, fingerprint, result } });
          return result;
        },
        { timeout: 10000 },
      );
    },
  };
}
