import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import {
  handoverCommand,
  handoverPayload,
  handoverQuery,
  readyForAcknowledgement,
} from './handover-rules';
const saleInclude = {
  vehicle: {
    select: {
      id: true,
      userId: true,
      make: true,
      model: true,
      vinChassis: true,
      stammnummer: true,
      isSample: true,
    },
  },
  bid: {
    select: {
      userId: true,
      amount: true,
      hold: { select: { amount: true, currency: true, status: true, gateway: true } },
    },
  },
} as const;
async function context(db: Prisma.TransactionClient, id: string, settlementId: string) {
  const actor = await db.user.findUnique({
    where: { id },
    select: {
      role: true,
      isSample: true,
      suspendedAt: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
    },
  });
  if (!actor || actor.suspendedAt || actor.isSample) throw Error('FORBIDDEN');
  const sale = await db.settlement.findUnique({
    where: { id: settlementId },
    include: saleInclude,
  });
  if (!sale || sale.vehicle.isSample) throw Error('FORBIDDEN');
  const party = sale.vehicle.userId === id ? 'SELLER' : sale.bid.userId === id ? 'BUYER' : null;
  if (!party && actor.role !== 'ADMIN') throw Error('FORBIDDEN');
  return { sale, actor, party };
}
const publicRevision = {
  id: true,
  version: true,
  payload: true,
  snapshot: true,
  contentHash: true,
  createdByRole: true,
  createdAt: true,
  buyerAcknowledgedAt: true,
  sellerAcknowledgedAt: true,
} as const;
export async function readHandover(db: PrismaClient, id: string, raw: unknown) {
  const q = handoverQuery.parse(raw);
  return db.$transaction(
    async (tx) => {
      const { sale, actor, party } = await context(tx, id, q.settlementId);
      const blocked = await tx.dispute.count({
        where: { settlementId: sale.id, status: { in: ['OPEN', 'ACTION_REQUIRED'] } },
      });
      const current = await tx.handoverRevision.findFirst({
        where: { settlementId: sale.id },
        orderBy: { version: 'desc' },
        select: publicRevision,
      });
      const total = await tx.handoverRevision.count({ where: { settlementId: sale.id } });
      const history = await tx.handoverRevision.findMany({
        where: { settlementId: sale.id },
        orderBy: { version: 'desc' },
        skip: (q.page - 1) * 10,
        take: 10,
        select: publicRevision,
      });
      const writable =
        !!party &&
        sale.vehicle.userId !== sale.bid.userId &&
        !!actor.emailVerifiedAt &&
        !!actor.phoneVerifiedAt &&
        sale.status === 'AWAITING_CONFIRMATION' &&
        !blocked;
      const payload = current ? handoverPayload.parse(current.payload) : null;
      return {
        settlementId: sale.id,
        vehicle: `${sale.vehicle.make} ${sale.vehicle.model}`,
        saleStatus: sale.status,
        price: Number(sale.bid.amount),
        party,
        fee: {
          amount: Number(sale.bid.hold.amount),
          currency: sale.bid.hold.currency,
          status: sale.bid.hold.status,
          simulated: sale.bid.hold.gateway === 'LOCAL_TEST',
        },
        blocked: !!blocked,
        canSave: writable && total < 100,
        canAcknowledge:
          writable &&
          !!payload &&
          readyForAcknowledgement(payload, sale.createdAt, new Date()) &&
          !(party === 'BUYER' ? current?.buyerAcknowledgedAt : current?.sellerAcknowledgedAt),
        current,
        history,
        total,
        page: q.page,
        asOf: new Date().toISOString(),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
export async function mutateHandover(db: PrismaClient, id: string, raw: unknown) {
  const c = handoverCommand.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR NO KEY UPDATE`;
    const initial = await context(tx, id, c.settlementId);
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${initial.sale.vehicleId} FOR UPDATE`;
    const { sale, actor, party } = await context(tx, id, c.settlementId);
    if (!party || sale.vehicle.userId === sale.bid.userId) throw Error('FORBIDDEN');
    if (!actor.emailVerifiedAt || !actor.phoneVerifiedAt) throw Error('VERIFICATION_REQUIRED');
    if (sale.status !== 'AWAITING_CONFIRMATION') throw Error('HANDOVER_LOCKED');
    if (
      await tx.dispute.count({
        where: { settlementId: sale.id, status: { in: ['OPEN', 'ACTION_REQUIRED'] } },
      })
    )
      throw Error('DISPUTE_OPEN');
    const current = await tx.handoverRevision.findFirst({
      where: { settlementId: sale.id },
      orderBy: { version: 'desc' },
    });
    if ((current?.version ?? 0) !== c.version) throw Error('CONFLICT');
    if (c.action === 'save') {
      if (c.version >= 100) throw Error('HANDOVER_LIMIT');
      const now = new Date();
      if (
        (await tx.handoverRevision.count({
          where: { settlementId: sale.id, createdAt: { gte: new Date(now.getTime() - 3600000) } },
        })) >= 20
      )
        throw Error('RATE_LIMITED');
      const snapshot = {
        vehicleId: sale.vehicle.id,
        make: sale.vehicle.make,
        model: sale.vehicle.model,
        stammnummer: sale.vehicle.stammnummer,
        maskedVin: '•••••••••••••' + sale.vehicle.vinChassis.slice(-4),
        price: sale.bid.amount.toString(),
        currency: 'CHF',
      };
      const version = c.version + 1;
      const contentHash = createHash('sha256')
        .update(JSON.stringify({ settlementId: sale.id, version, payload: c.payload, snapshot }))
        .digest('hex');
      await tx.handoverRevision.create({
        data: {
          settlementId: sale.id,
          version,
          payload: c.payload,
          snapshot,
          contentHash,
          createdById: id,
          createdByRole: party,
        },
      });
      await tx.outboxEvent.create({
        data: {
          kind: 'handover.saved',
          deliveredAt: now,
          payload: { actorId: id, settlementId: sale.id, version, contentHash },
        },
      });
      return { ok: true, version };
    }
    if (
      !current ||
      !readyForAcknowledgement(handoverPayload.parse(current.payload), sale.createdAt, new Date())
    )
      throw Error('HANDOVER_INCOMPLETE');
    if (party === 'BUYER' ? current.buyerAcknowledgedAt : current.sellerAcknowledgedAt)
      return { ok: true, version: current.version };
    const now = new Date();
    await tx.handoverRevision.update({
      where: { id: current.id },
      data: party === 'BUYER' ? { buyerAcknowledgedAt: now } : { sellerAcknowledgedAt: now },
    });
    await tx.outboxEvent.create({
      data: {
        kind: 'handover.acknowledged',
        deliveredAt: now,
        payload: {
          actorId: id,
          settlementId: sale.id,
          version: current.version,
          party,
          contentHash: current.contentHash,
        },
      },
    });
    return { ok: true, version: current.version };
  });
}
