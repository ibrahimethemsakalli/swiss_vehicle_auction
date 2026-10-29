import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { assertLocalProxyEnvironment, validLocalProxyHold } from './local-proxy-engine';

// Shares the bidding row lock. No provider call, production settlement or payment table.
export async function finishLocalProxy(
  db: PrismaClient,
  auctionId: string,
  action: 'close' | 'cancel' | 'sweep',
  authorize?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  z.uuid().parse(auctionId);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "LocalProxyAuction" WHERE id=${auctionId} FOR UPDATE`;
      const a = await tx.localProxyAuction.findUniqueOrThrow({ where: { id: auctionId } });
      await authorize?.(tx);
      if (action === 'cancel' && a.status === 'COMPLETED') throw Error('SALE_COMPLETED');
      const [{ millis }] = await tx.$queryRaw<{ millis: bigint }[]>`
      SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS millis`;
      const now = new Date(Number(millis));
      if (action === 'close' && a.status === 'OPEN' && a.endsAt > now)
        throw Error('AUCTION_NOT_DUE');
      let status = a.status,
        winnerId = a.winnerId,
        closedAt = a.closedAt,
        cancelledAt = a.cancelledAt;
      if (action === 'cancel' && status !== 'CANCELLED') {
        status = 'CANCELLED';
        winnerId = null;
        cancelledAt = now;
        closedAt ??= now;
      } else if (status === 'OPEN' && a.endsAt <= now) {
        const leader = a.leaderId
          ? await tx.localProxyLimit.findUnique({
              where: { auctionId_ownerId: { auctionId, ownerId: a.leaderId } },
              include: { hold: true },
            })
          : null;
        const valid =
          !!leader &&
          a.priceCents !== null &&
          a.buyerIds.includes(leader.ownerId) &&
          leader.maximumCents >= a.priceCents &&
          validLocalProxyHold(leader.hold, leader.ownerId, auctionId, now);
        status = !a.leaderId ? 'NO_BIDS' : valid ? 'WON' : 'REVIEW';
        winnerId = valid ? a.leaderId : null;
        closedAt = now;
      }
      // Retain only the valid winner's hold; expired holds are released even after closing.
      const terminal = status !== 'OPEN';
      const released = await tx.localProxyHold.updateMany({
        where: {
          auctionId,
          status: 'AUTHORIZED',
          ...(terminal && status !== 'WON'
            ? {}
            : {
                OR: [
                  { expiresAt: { lte: now } },
                  ...(terminal && winnerId ? [{ ownerId: { not: winnerId } }] : []),
                ],
              }),
        },
        data: { status: 'RELEASED', releasedAt: now },
      });
      if (status === a.status && !released.count) return { ok: true, auctionId };
      const updated = await tx.localProxyAuction.update({
        where: { id: auctionId },
        data: {
          status,
          winnerId,
          closedAt,
          cancelledAt,
          version: { increment: 1 },
        },
      });
      await tx.localProxyEvent.create({
        data: {
          auctionId,
          version: updated.version,
          payload: {
            auctionId,
            status,
            priceCents: a.priceCents?.toString() ?? null,
            endsAt: a.endsAt.toISOString(),
            version: updated.version,
          },
        },
      });
      return { ok: true, auctionId };
    },
    { timeout: 10000 },
  );
}

export async function sweepLocalProxy(db: PrismaClient) {
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  // DB time selects work; each transaction checks the deadline again after acquiring its lock.
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "LocalProxyAuction" a
    WHERE (a.status='OPEN' AND a."endsAt" <= (clock_timestamp() AT TIME ZONE 'UTC'))
       OR EXISTS (SELECT 1 FROM "LocalProxyHold" h WHERE h."auctionId"=a.id
         AND h.status='AUTHORIZED' AND h."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC'))
    ORDER BY a."endsAt", a.id LIMIT 100`;
  for (const row of rows) await finishLocalProxy(db, row.id, 'sweep');
  return { processed: rows.length };
}
