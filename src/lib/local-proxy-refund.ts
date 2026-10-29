import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { assertLocalProxyEnvironment } from './local-proxy-engine';

const reason = z.string().trim().min(10).max(400);
export const localRefundCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('requestRefund'),
      auctionId: z.uuid(),
      requestId: z.uuid(),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal('approveRefund'),
      auctionId: z.uuid(),
      requestId: z.uuid(),
      reason,
    })
    .strict(),
  z
    .object({ action: z.literal('rejectRefund'), auctionId: z.uuid(), requestId: z.uuid(), reason })
    .strict(),
]);

export async function refundLocalProxy(
  db: PrismaClient,
  raw: unknown,
  authorize: (tx: Prisma.TransactionClient) => Promise<{ actorId: string; isAdmin: boolean }>,
) {
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  const c = localRefundCommand.parse(raw);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "LocalProxyAuction" WHERE id=${c.auctionId} FOR UPDATE`;
      const a = await tx.localProxyAuction.findUniqueOrThrow({ where: { id: c.auctionId } });
      const actor = await authorize(tx);
      const requesting = c.action === 'requestRefund';
      if (
        requesting ? actor.actorId !== a.winnerId : !actor.isAdmin || actor.actorId !== a.sellerId
      )
        throw Error('FORBIDDEN');
      const key = { auctionId: a.id, ownerId: actor.actorId, requestId: c.requestId };
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ action: c.action, reason: c.reason }))
        .digest('hex');
      const prior = await tx.localProxyCommand.findUnique({
        where: { auctionId_ownerId_requestId: key },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw Error('REQUEST_CONFLICT');
        return { ok: true, auctionId: a.id };
      }
      if (a.status !== 'COMPLETED') throw Error('REFUND_NOT_READY');
      const capture = await tx.localProxyCapture.findUnique({
        where: { auctionId: a.id },
        include: { hold: true },
      });
      if (
        !capture ||
        capture.amountCents !== 3000 ||
        capture.currency !== 'CHF' ||
        capture.hold.status !== 'CAPTURED' ||
        capture.hold.gateway !== 'local-proxy' ||
        capture.hold.ownerId !== a.winnerId ||
        capture.hold.auctionId !== a.id
      )
        throw Error('REFUND_NOT_READY');
      const existing = await tx.localProxyRefundCase.findUnique({ where: { auctionId: a.id } });
      const [{ millis }] = await tx.$queryRaw<
        { millis: bigint }[]
      >`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS millis`;
      const now = new Date(Number(millis));
      if (requesting) {
        if (existing) throw Error('REFUND_EXISTS');
        await tx.localProxyRefundCase.create({
          data: { auctionId: a.id, requestedBy: actor.actorId, reason: c.reason, requestedAt: now },
        });
      } else {
        if (!existing) throw Error('REFUND_NOT_READY');
        const status = c.action === 'approveRefund' ? 'APPROVED' : 'REJECTED';
        if (existing.status !== 'PENDING') {
          if (existing.status === status && existing.decisionNote === c.reason)
            return { ok: true, auctionId: a.id };
          throw Error('REFUND_DECIDED');
        }
        await tx.localProxyRefundCase.update({
          where: { auctionId: a.id },
          data: { status, decisionNote: c.reason, reviewedBy: actor.actorId, reviewedAt: now },
        });
        if (status === 'APPROVED')
          await tx.localProxyRefund.create({
            data: {
              auctionId: a.id,
              amountCents: capture.amountCents,
              currency: capture.currency,
              refundedAt: now,
            },
          });
      }
      const updated = await tx.localProxyAuction.update({
        where: { id: a.id },
        data: { version: { increment: 1 } },
      });
      // Private request/decision text never enters shared events. Capture history is immutable.
      await tx.localProxyEvent.create({
        data: {
          auctionId: a.id,
          version: updated.version,
          payload: { auctionId: a.id, status: a.status, version: updated.version },
        },
      });
      const result = { ok: true, auctionId: a.id };
      await tx.localProxyCommand.create({ data: { ...key, fingerprint, result } });
      return result;
    },
    { timeout: 10000 },
  );
}
