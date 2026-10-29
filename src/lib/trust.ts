import type { PrismaClient, Prisma } from '../generated/prisma/client';
import { trustCommand, trustQuery } from './trust-rules';
type Tx = Prisma.TransactionClient;
async function actor(tx: Tx, id: string, verified = false) {
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
  if (!u || u.suspendedAt || u.isSample) throw Error('FORBIDDEN');
  if (verified && (!u.emailVerifiedAt || !u.phoneVerifiedAt)) throw Error('VERIFICATION_REQUIRED');
  return u;
}
const vehicleSelect = { id: true, make: true, model: true } as const;
const reviewSelect = {
  id: true,
  rating: true,
  note: true,
  response: true,
  status: true,
  createdAt: true,
  authorId: true,
  recipientId: true,
  settlement: { select: { vehicle: { select: vehicleSelect } } },
  appeal: { select: { id: true, status: true, note: true, decision: true, decisionNote: true } },
} as const;
async function inbox(
  tx: Tx,
  userId: string,
  key: string,
  vehicle: { id: string; make: string; model: string },
) {
  await tx.notification.createMany({
    data: [
      {
        userId,
        eventKey: key,
        kind: 'TRUST_UPDATE',
        vehicleId: vehicle.id,
        vehicleName: `${vehicle.make} ${vehicle.model}`.slice(0, 181),
      },
    ],
    skipDuplicates: true,
  });
}
export async function readTrust(db: PrismaClient, userId: string, raw: unknown) {
  const q = trustQuery.parse(raw),
    u = await actor(db, userId);
  const paging = {
    skip: (q.page - 1) * 20,
    take: 20,
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  };
  if (q.view.startsWith('admin') && u.role !== 'ADMIN') throw Error('FORBIDDEN');
  if (q.view === 'deals') {
    const where: Prisma.SettlementWhereInput = {
      status: 'COMPLETED',
      vehicle: { isSample: false },
      OR: [{ vehicle: { userId } }, { bid: { userId } }],
      reviews: { none: { authorId: userId } },
    };
    const [items, total] = await db.$transaction([
      db.settlement.findMany({
        where,
        ...paging,
        select: { id: true, vehicle: { select: vehicleSelect } },
      }),
      db.settlement.count({ where }),
    ]);
    return { items, total };
  }
  if (q.view === 'reviews') {
    const where = { OR: [{ authorId: userId }, { recipientId: userId }] };
    const [rows, total] = await db.$transaction([
      db.saleReview.findMany({ where, ...paging, select: reviewSelect }),
      db.saleReview.count({ where }),
    ]);
    return {
      items: rows.map(({ authorId, recipientId, ...r }) => ({
        ...r,
        canReply: recipientId === userId && !r.response && r.status === 'PUBLISHED',
        canAppeal: !r.appeal,
        authored: authorId === userId,
      })),
      total,
    };
  }
  if (q.view === 'warnings') {
    const where = {
      vehicle: { userId },
      status: 'CLOSED',
      decision: { in: ['WARNING', 'ESCALATED'] },
    };
    const [items, total] = await db.$transaction([
      db.listingReport.findMany({
        where,
        ...paging,
        select: {
          id: true,
          status: true,
          decision: true,
          decisionNote: true,
          reviewedAt: true,
          vehicle: { select: vehicleSelect },
        },
      }),
      db.listingReport.count({ where }),
    ]);
    return { items, total };
  }
  if (q.view === 'reports' || q.view === 'adminReports') {
    const where = q.view === 'reports' ? { reporterId: userId } : { status: q.status };
    const [items, total] = await db.$transaction([
      db.listingReport.findMany({
        where,
        ...paging,
        select: {
          id: true,
          category: true,
          note: true,
          status: true,
          decision: true,
          decisionNote: true,
          reviewedAt: true,
          createdAt: true,
          vehicle: { select: vehicleSelect },
        },
      }),
      db.listingReport.count({ where }),
    ]);
    return { items, total };
  }
  const where = { status: q.status };
  const [items, total] = await db.$transaction([
    db.reviewAppeal.findMany({
      where,
      ...paging,
      select: {
        id: true,
        note: true,
        status: true,
        decision: true,
        decisionNote: true,
        reviewedAt: true,
        createdAt: true,
        review: { select: reviewSelect },
      },
    }),
    db.reviewAppeal.count({ where }),
  ]);
  return { items, total };
}
export async function mutateTrust(db: PrismaClient, userId: string, raw: unknown) {
  const input = trustCommand.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR NO KEY UPDATE`;
    const u = await actor(tx, userId, true);
    if (input.action.startsWith('decide') && u.role !== 'ADMIN') throw Error('FORBIDDEN');
    if (input.action === 'report') {
      const v = await tx.vehicle.findFirst({
        where: {
          id: input.vehicleId,
          isSample: false,
          status: { in: ['ACTIVE', 'SOLD', 'EXPIRED'] },
        },
        select: { ...vehicleSelect, userId: true },
      });
      if (!v || v.userId === userId) throw Error('TRUST_INELIGIBLE');
      if (
        await tx.listingReport.findUnique({
          where: { vehicleId_reporterId: { vehicleId: v.id, reporterId: userId } },
        })
      )
        throw Error('TRUST_DUPLICATE');
      if (
        (await tx.listingReport.count({
          where: { reporterId: userId, createdAt: { gte: new Date(Date.now() - 86400000) } },
        })) >= 10
      )
        throw Error('RATE_LIMITED');
      return tx.listingReport.create({
        data: { vehicleId: v.id, reporterId: userId, category: input.category, note: input.note },
        select: { id: true },
      });
    }
    if (input.action === 'rate') {
      const s = await tx.settlement.findUnique({
        where: { id: input.settlementId },
        include: { vehicle: true, bid: true },
      });
      if (
        !s ||
        s.status !== 'COMPLETED' ||
        s.vehicle.isSample ||
        ![s.vehicle.userId, s.bid.userId].includes(userId) ||
        s.vehicle.userId === s.bid.userId
      )
        throw Error('TRUST_INELIGIBLE');
      // Serialize with sale changes and recheck eligibility after acquiring its lock.
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${s.vehicleId} FOR UPDATE`;
      if ((await tx.settlement.findUnique({ where: { id: s.id } }))?.status !== 'COMPLETED')
        throw Error('TRUST_INELIGIBLE');
      if (
        await tx.saleReview.findUnique({
          where: { settlementId_authorId: { settlementId: s.id, authorId: userId } },
        })
      )
        throw Error('TRUST_DUPLICATE');
      const recipientId = userId === s.vehicle.userId ? s.bid.userId : s.vehicle.userId;
      const review = await tx.saleReview.create({
        data: {
          settlementId: s.id,
          authorId: userId,
          recipientId,
          rating: input.rating,
          note: input.note,
        },
      });
      await inbox(tx, recipientId, `review:${review.id}`, s.vehicle);
      return { id: review.id };
    }
    if (input.action === 'reply' || input.action === 'appeal') {
      await tx.$queryRaw`SELECT id FROM "SaleReview" WHERE id=${input.reviewId} FOR UPDATE`;
      const r = await tx.saleReview.findUnique({
        where: { id: input.reviewId },
        include: { appeal: true, settlement: { include: { vehicle: true } } },
      });
      if (
        !r ||
        ![r.authorId, r.recipientId].includes(userId) ||
        (input.action === 'reply' && r.recipientId !== userId)
      )
        throw Error('FORBIDDEN');
      if (input.action === 'reply') {
        if (r.response || r.status !== 'PUBLISHED') throw Error('TRUST_CONFLICT');
        await tx.saleReview.update({
          where: { id: r.id },
          data: { response: input.note, responseAt: new Date() },
        });
        await inbox(tx, r.authorId, `reply:${r.id}`, r.settlement.vehicle);
      } else {
        if (r.appeal) throw Error('TRUST_DUPLICATE');
        await tx.reviewAppeal.create({
          data: { reviewId: r.id, reporterId: userId, note: input.note },
        });
      }
      return { ok: true };
    }
    if (input.action === 'decideReport') {
      await tx.$queryRaw`SELECT id FROM "ListingReport" WHERE id=${input.id} FOR UPDATE`;
      const r = await tx.listingReport.findUnique({
        where: { id: input.id },
        include: { vehicle: true },
      });
      if (!r) throw Error('FORBIDDEN');
      if ([r.reporterId, r.vehicle.userId].includes(userId)) throw Error('TRUST_SELF_REVIEW');
      if (r.status !== 'OPEN') throw Error('TRUST_CONFLICT');
      await tx.listingReport.update({
        where: { id: r.id },
        data: {
          status: 'CLOSED',
          decision: input.decision,
          decisionNote: input.note,
          reviewedBy: userId,
          reviewedAt: new Date(),
        },
      });
      await inbox(tx, r.reporterId, `report-decision:${r.id}`, r.vehicle);
      if (input.decision !== 'DISMISSED')
        await inbox(tx, r.vehicle.userId, `report-warning:${r.id}`, r.vehicle);
      // Decisions are recorded; financial/auction sanctions require their existing workflows.
      return { ok: true };
    }
    await tx.$queryRaw`SELECT id FROM "ReviewAppeal" WHERE id=${input.id} FOR UPDATE`;
    const a = await tx.reviewAppeal.findUnique({
      where: { id: input.id },
      include: { review: { include: { settlement: { include: { vehicle: true } } } } },
    });
    if (!a) throw Error('FORBIDDEN');
    if ([a.review.authorId, a.review.recipientId].includes(userId))
      throw Error('TRUST_SELF_REVIEW');
    if (a.status !== 'OPEN') throw Error('TRUST_CONFLICT');
    await tx.saleReview.update({
      where: { id: a.reviewId },
      data: { status: input.decision === 'HIDE' ? 'HIDDEN' : 'PUBLISHED' },
    });
    await tx.reviewAppeal.update({
      where: { id: a.id },
      data: {
        status: 'CLOSED',
        decision: input.decision,
        decisionNote: input.note,
        reviewedBy: userId,
        reviewedAt: new Date(),
      },
    });
    await inbox(tx, a.review.authorId, `appeal-author:${a.id}`, a.review.settlement.vehicle);
    await inbox(tx, a.review.recipientId, `appeal-recipient:${a.id}`, a.review.settlement.vehicle);
    return { ok: true };
  });
}
export async function publicReputation(db: PrismaClient, vehicleId: string, page: number) {
  const vehicle = await db.vehicle.findFirst({
    where: { id: vehicleId, status: { in: ['ACTIVE', 'SOLD', 'EXPIRED'] }, isSample: false },
    select: { userId: true },
  });
  if (!vehicle) return { items: [], total: 0, average: null };
  const where: Prisma.SaleReviewWhereInput = {
    recipientId: vehicle.userId,
    status: 'PUBLISHED',
    settlement: { status: 'COMPLETED', vehicle: { isSample: false, userId: vehicle.userId } },
  };
  const [items, stats] = await db.$transaction([
    db.saleReview.findMany({
      where,
      skip: (page - 1) * 20,
      take: 20,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { rating: true, note: true, response: true, createdAt: true },
    }),
    db.saleReview.aggregate({ where, _count: true, _avg: { rating: true } }),
  ]);
  return { items, total: stats._count, average: stats._avg.rating };
}
