import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { assertLocalProxyEnvironment, validLocalProxyHold } from './local-proxy-engine';
import { z } from 'zod';

export async function settleLocalProxy(
  db: PrismaClient,
  auctionId: string,
  action: 'renew' | 'confirm',
  requestId: string,
  authorize: (tx: Prisma.TransactionClient) => Promise<string>,
) {
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  z.uuid().parse(auctionId);
  z.uuid().parse(requestId);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "LocalProxyAuction" WHERE id=${auctionId} FOR UPDATE`;
      const a = await tx.localProxyAuction.findUniqueOrThrow({ where: { id: auctionId } });
      const actorId = await authorize(tx);
      if (action === 'confirm' ? actorId !== a.sellerId : actorId !== a.winnerId)
        throw Error('FORBIDDEN');
      const key = { auctionId, ownerId: actorId, requestId },
        fingerprint = `sale:${action}`;
      const prior = await tx.localProxyCommand.findUnique({
        where: { auctionId_ownerId_requestId: key },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw Error('REQUEST_CONFLICT');
        return { ok: true, auctionId };
      }
      if (action === 'confirm' && a.status === 'COMPLETED') return { ok: true, auctionId };
      if (a.status !== 'WON' || !a.winnerId) throw Error('SALE_NOT_READY');
      if ((await tx.localProxyCommand.count({ where: { auctionId } })) >= 1100)
        throw Error('LOCAL_PROXY_QUOTA');
      const limit = await tx.localProxyLimit.findUniqueOrThrow({
        where: { auctionId_ownerId: { auctionId, ownerId: a.winnerId } },
        include: { hold: true },
      });
      const [{ millis }] = await tx.$queryRaw<
        { millis: bigint }[]
      >`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS millis`;
      const now = new Date(Number(millis));
      const valid = validLocalProxyHold(limit.hold, a.winnerId, auctionId, now);
      let changed = false;
      if (action === 'renew') {
        // A retry or an already valid hold never extends the authorization window.
        if (!valid) {
          const old = limit.hold;
          if (
            old.ownerId !== a.winnerId ||
            old.auctionId !== auctionId ||
            old.gateway !== 'local-proxy' ||
            old.currency !== 'CHF' ||
            old.amountCents !== 3000 ||
            old.status === 'CAPTURED'
          )
            throw Error('LEADER_HOLD_EXPIRED');
          await tx.localProxyHold.updateMany({
            where: { id: old.id, status: 'AUTHORIZED' },
            data: { status: 'RELEASED', releasedAt: now },
          });
          const hold = await tx.localProxyHold.create({
            data: { auctionId, ownerId: a.winnerId, expiresAt: new Date(+now + 3600000) },
          });
          await tx.localProxyLimit.update({
            where: { auctionId_ownerId: { auctionId, ownerId: a.winnerId } },
            data: { holdId: hold.id },
          });
          changed = true;
        }
      } else {
        if (!valid) throw Error('LEADER_HOLD_EXPIRED');
        await tx.localProxyCapture.create({
          data: { auctionId, holdId: limit.holdId, capturedAt: now },
        });
        await tx.localProxyHold.update({
          where: { id: limit.holdId },
          data: { status: 'CAPTURED' },
        });
        await tx.localProxyAuction.update({
          where: { id: auctionId },
          data: { status: 'COMPLETED' },
        });
        changed = true;
      }
      if (changed) {
        const updated = await tx.localProxyAuction.update({
          where: { id: auctionId },
          data: { version: { increment: 1 } },
        });
        await tx.localProxyEvent.create({
          data: {
            auctionId,
            version: updated.version,
            payload: {
              auctionId,
              status: updated.status,
              version: updated.version,
              priceCents: updated.priceCents?.toString() ?? null,
              endsAt: updated.endsAt.toISOString(),
            },
          },
        });
      }
      const result = { ok: true, auctionId };
      await tx.localProxyCommand.create({ data: { ...key, fingerprint, result } });
      return result;
    },
    { timeout: 10000 },
  );
}
