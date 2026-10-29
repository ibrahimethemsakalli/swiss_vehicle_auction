import type { PrismaClient, Prisma } from '../generated/prisma/client';
import { queueQuery, queueDates, assignmentCommand, queueStatuses } from './admin-queue-rules';
import { publicVehicle, publicVehicleInclude } from './public-vehicle';
import { assertLocalProxyEnvironment } from './local-proxy-engine';
import { lockRetentionSources, retentionAdmin } from './retention-review';
export async function requireQueueAdmin(db: Prisma.TransactionClient, id: string) {
  const u = await db.user.findUnique({
    where: { id },
    select: { role: true, suspendedAt: true, isSample: true },
  });
  if (!u || u.role !== 'ADMIN' || u.suspendedAt || u.isSample) throw Error('FORBIDDEN');
}
export async function readAdminQueue(db: PrismaClient, adminId: string, raw: unknown) {
  await requireQueueAdmin(db, adminId);
  const q = queueQuery.parse(raw),
    createdAt = queueDates(q.from, q.to);
  if (q.kind === 'retention') assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  const paging = {
    skip: (q.page - 1) * 20,
    take: 20,
    orderBy: [
      { createdAt: q.order === 'oldest' ? ('asc' as const) : ('desc' as const) },
      { id: q.order === 'oldest' ? ('asc' as const) : ('desc' as const) },
    ],
  };
  const text = { contains: q.q, mode: 'insensitive' as const };
  const vehicleSearch = q.q
    ? { OR: [{ id: text }, { make: text }, { model: text }, { stammnummer: text }] }
    : {};
  const status = q.status ? { status: q.status } : {};
  type Item = {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    reference?: string;
    vehicle?: ReturnType<typeof publicVehicle> & { vinChassis: string };
    settlementId?: string | null;
    amount?: number;
    note?: string;
    actor?: string;
    action?: string;
    requesterId?: string;
    canClaim?: boolean;
    noReviewer?: boolean;
  };
  const result = await db.$transaction(
    async (tx) => {
      await requireQueueAdmin(tx, adminId);
      let items: Item[] = [],
        total = 0;
      if (q.kind === 'retention') {
        const eligible = await tx.user.findMany({
          where: { role: 'ADMIN', suspendedAt: null, isSample: false },
          select: { id: true },
        });
        const where: Prisma.RetentionReviewRequestWhereInput = {
          createdAt,
          ...status,
          protection: { conversation: { buyerId: { not: adminId }, sellerId: { not: adminId } } },
          ...(q.q
            ? {
                OR: [
                  { id: text },
                  { protectionId: text },
                  { protection: { conversationId: text } },
                ],
              }
            : {}),
        };
        total = await tx.retentionReviewRequest.count({ where });
        items = (
          await tx.retentionReviewRequest.findMany({
            where,
            ...paging,
            include: {
              protection: {
                select: {
                  status: true,
                  conversation: { select: { buyerId: true, sellerId: true } },
                },
              },
              requester: { select: { role: true, suspendedAt: true, isSample: true } },
            },
          })
        ).map((r) => ({
          id: r.id,
          title: 'retention',
          status: r.status,
          createdAt: r.createdAt,
          reference: r.protectionId,
          requesterId: r.requesterId,
          noReviewer:
            ['OPEN', 'NEEDS_INFO'].includes(r.status) &&
            !eligible.some(
              (a) =>
                ![
                  r.requesterId,
                  r.protection.conversation.buyerId,
                  r.protection.conversation.sellerId,
                ].includes(a.id),
            ),
          canClaim:
            r.status === 'OPEN' &&
            r.protection.status === 'ACTIVE' &&
            r.requesterId !== adminId &&
            r.requester.role === 'ADMIN' &&
            !r.requester.suspendedAt &&
            !r.requester.isSample,
        }));
      } else if (q.kind === 'queue') {
        const where: Prisma.VehicleWhereInput = {
          createdAt,
          ...vehicleSearch,
          ...(q.status ? { status: q.status as Prisma.VehicleWhereInput['status'] } : {}),
        };
        total = await tx.vehicle.count({ where });
        items = (
          await tx.vehicle.findMany({ where, ...paging, include: publicVehicleInclude })
        ).map((v) => ({
          id: v.id,
          title: `${v.make} ${v.model}`,
          status: v.status,
          createdAt: v.createdAt,
          reference: v.stammnummer,
          vehicle: { ...publicVehicle(v), vinChassis: v.vinChassis },
        }));
      } else if (q.kind === 'payments') {
        const where: Prisma.PaymentHoldWhereInput = {
          createdAt,
          ...(q.status ? { status: q.status as Prisma.PaymentHoldWhereInput['status'] } : {}),
          ...(q.q ? { OR: [{ id: text }, { vehicle: vehicleSearch }] } : {}),
        };
        total = await tx.paymentHold.count({ where });
        items = (
          await tx.paymentHold.findMany({
            where,
            ...paging,
            select: {
              id: true,
              status: true,
              createdAt: true,
              amount: true,
              vehicle: {
                select: { make: true, model: true, settlement: { select: { id: true } } },
              },
            },
          })
        ).map((p) => ({
          id: p.id,
          title: `${p.vehicle.make} ${p.vehicle.model}`,
          status: p.status,
          createdAt: p.createdAt,
          amount: Number(p.amount),
          settlementId: p.vehicle.settlement?.id,
        }));
      } else if (q.kind === 'settlements') {
        const where: Prisma.SettlementWhereInput = {
          createdAt,
          ...status,
          ...(q.q ? { OR: [{ id: text }, { vehicle: vehicleSearch }] } : {}),
        };
        total = await tx.settlement.count({ where });
        items = (
          await tx.settlement.findMany({
            where,
            ...paging,
            select: {
              id: true,
              status: true,
              createdAt: true,
              vehicle: { select: { make: true, model: true } },
            },
          })
        ).map((s) => ({
          id: s.id,
          title: `${s.vehicle.make} ${s.vehicle.model}`,
          status: s.status,
          createdAt: s.createdAt,
        }));
      } else if (q.kind === 'disputes') {
        const where: Prisma.DisputeWhereInput = {
          createdAt,
          ...status,
          ...(q.q ? { OR: [{ id: text }, { settlement: { vehicle: vehicleSearch } }] } : {}),
        };
        total = await tx.dispute.count({ where });
        items = (
          await tx.dispute.findMany({
            where,
            ...paging,
            select: {
              id: true,
              status: true,
              createdAt: true,
              settlement: { select: { vehicle: { select: { make: true, model: true } } } },
            },
          })
        ).map((d) => ({
          id: d.id,
          title: `${d.settlement.vehicle.make} ${d.settlement.vehicle.model}`,
          status: d.status,
          createdAt: d.createdAt,
        }));
      } else if (q.kind === 'identities') {
        const where: Prisma.UserWhereInput = {
          createdAt,
          ...(q.status === 'UNVERIFIED'
            ? { isIdentityVerified: false, suspendedAt: null }
            : q.status === 'VERIFIED'
              ? { isIdentityVerified: true, suspendedAt: null }
              : q.status === 'SUSPENDED'
                ? { suspendedAt: { not: null } }
                : {}),
          ...(q.q ? { OR: [{ id: text }, { email: text }, { companyName: text }] } : {}),
        };
        total = await tx.user.count({ where });
        items = (
          await tx.user.findMany({
            where,
            ...paging,
            select: {
              id: true,
              email: true,
              isIdentityVerified: true,
              suspendedAt: true,
              createdAt: true,
              companyName: true,
            },
          })
        ).map((u) => ({
          id: u.id,
          title: u.email,
          status: u.suspendedAt ? 'SUSPENDED' : u.isIdentityVerified ? 'VERIFIED' : 'UNVERIFIED',
          createdAt: u.createdAt,
          reference: u.companyName ?? undefined,
        }));
      } else {
        const where: Prisma.OutboxEventWhereInput = {
          createdAt,
          kind: q.status || { in: [...queueStatuses.audit] },
          ...(q.q
            ? {
                OR: [
                  { id: text },
                  ...[
                    'vehicleId',
                    'settlementId',
                    'disputeId',
                    'userId',
                    'recordId',
                    'adminId',
                    'actorId',
                  ].map((path) => ({ payload: { path: [path], equals: q.q } })),
                ],
              }
            : {}),
        };
        total = await tx.outboxEvent.count({ where });
        items = (
          await tx.outboxEvent.findMany({
            where,
            ...paging,
            select: { id: true, kind: true, payload: true, createdAt: true },
          })
        ).map((e) => {
          const p = (e.payload ?? {}) as Record<string, unknown>;
          const value = (...keys: string[]) =>
            keys.map((k) => p[k]).find((v) => typeof v === 'string') as string | undefined;
          return {
            id: e.id,
            title: e.kind,
            status: e.kind,
            createdAt: e.createdAt,
            reference: value('recordId', 'vehicleId', 'settlementId', 'disputeId', 'userId'),
            actor: value('adminId', 'actorId'),
            action: value('action', 'resolution'),
            note: value('note', 'evidenceReference'),
          };
        });
      }
      const assignments =
        q.kind === 'audit'
          ? []
          : await tx.adminWorkItem.findMany({
              where: { kind: q.kind, recordId: { in: items.map((i) => i.id) } },
              select: {
                recordId: true,
                ownerId: true,
                version: true,
                updatedAt: true,
                owner: { select: { email: true, suspendedAt: true, role: true } },
              },
            });
      return {
        items: items.map((i) => ({
          ...i,
          assignment: assignments.find((a) => a.recordId === i.id) ?? null,
        })),
        total,
        page: q.page,
        pageSize: 20,
        adminId,
        now: new Date().toISOString(),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  return result;
}
export async function assignAdminWork(db: PrismaClient, adminId: string, raw: unknown) {
  const c = assignmentCommand.parse(raw);
  if (c.kind === 'retention') assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  return db.$transaction(async (tx) => {
    if (c.kind === 'retention') await lockRetentionSources(tx);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${adminId} FOR NO KEY UPDATE`;
    await requireQueueAdmin(tx, adminId);
    if (c.kind === 'retention') {
      const r = await tx.retentionReviewRequest.findUnique({
        where: { id: c.id },
        include: { protection: { include: { conversation: true } } },
      });
      if (!r) throw Error('NOT_FOUND');
      await retentionAdmin(tx, adminId, r.protection.conversation);
      if (r.requesterId === adminId) throw Error('FORBIDDEN');
      if (c.action === 'claim') {
        await retentionAdmin(tx, r.requesterId, r.protection.conversation);
        if (r.status !== 'OPEN' || r.protection.status !== 'ACTIVE') throw Error('CONFLICT');
      }
    }
    const exists =
      c.kind === 'retention'
        ? await tx.retentionReviewRequest.findUnique({ where: { id: c.id }, select: { id: true } })
        : c.kind === 'queue'
          ? await tx.vehicle.findUnique({ where: { id: c.id }, select: { id: true } })
          : c.kind === 'payments'
            ? await tx.paymentHold.findUnique({ where: { id: c.id }, select: { id: true } })
            : c.kind === 'settlements'
              ? await tx.settlement.findUnique({ where: { id: c.id }, select: { id: true } })
              : c.kind === 'disputes'
                ? await tx.dispute.findUnique({ where: { id: c.id }, select: { id: true } })
                : await tx.user.findUnique({ where: { id: c.id }, select: { id: true } });
    if (!exists) throw Error('NOT_FOUND');
    // One stable lock per record, including concurrent first claims.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.kind + ':' + c.id},0))::text`;
    const current = await tx.adminWorkItem.findUnique({
      where: { kind_recordId: { kind: c.kind, recordId: c.id } },
    });
    if ((current?.version ?? 0) !== c.version) throw Error('CONFLICT');
    if (c.action === 'release' && current?.ownerId !== adminId) throw Error('CONFLICT');
    if (c.action === 'claim' && current?.ownerId) {
      const owner = await tx.user.findUnique({
        where: { id: current.ownerId },
        select: { role: true, suspendedAt: true },
      });
      if (owner?.role === 'ADMIN' && !owner.suspendedAt) throw Error('CONFLICT');
    }
    await tx.adminWorkItem.upsert({
      where: { kind_recordId: { kind: c.kind, recordId: c.id } },
      create: { kind: c.kind, recordId: c.id, ownerId: adminId, version: 1 },
      update: { ownerId: c.action === 'claim' ? adminId : null, version: { increment: 1 } },
    });
    await tx.outboxEvent.create({
      data: {
        kind: 'admin.assignment',
        deliveredAt: new Date(),
        payload: {
          adminId,
          recordId: c.id,
          kind: c.kind,
          action: c.action,
          note: c.note,
          previousOwner: current?.ownerId ?? null,
          version: c.version + 1,
        },
      },
    });
    return { ok: true };
  });
}
