import { z } from 'zod';
import { db } from './db';
import { notify } from './notifications';
export const openDisputeInput = z
  .object({
    settlementId: z.uuid(),
    category: z.enum(['NO_HANDOVER', 'VEHICLE_ISSUE', 'PAYMENT_ISSUE', 'OTHER']),
    message: z.string().trim().min(20).max(2000),
  })
  .strict();
export const reviewDisputeInput = z
  .object({
    id: z.uuid(),
    resolution: z.enum(['NO_ACTION', 'MANUAL_RESOLUTION', 'REFUND_REQUIRED']),
    note: z.string().trim().min(20).max(2000),
  })
  .strict();
export const blockingDisputes = ['OPEN', 'ACTION_REQUIRED'];
export async function openDispute(userId: string, raw: unknown) {
  const input = openDisputeInput.parse(raw);
  const initial = await db.settlement.findUniqueOrThrow({ where: { id: input.settlementId } });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${initial.vehicleId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const s = await tx.settlement.findUniqueOrThrow({
      where: { id: initial.id },
      include: { vehicle: true, bid: true },
    });
    if (user.suspendedAt || ![s.vehicle.userId, s.bid.userId].includes(userId))
      throw new Error('FORBIDDEN');
    if (
      (await tx.dispute.count({ where: { settlementId: s.id, reporterId: userId } })) >= 3 ||
      (await tx.dispute.findFirst({
        where: { settlementId: s.id, reporterId: userId, status: { in: blockingDisputes } },
      }))
    )
      throw new Error('CONFLICT');
    const dispute = await tx.dispute.create({ data: { ...input, reporterId: userId } });
    await tx.outboxEvent.create({
      data: {
        kind: 'dispute.opened',
        deliveredAt: new Date(),
        payload: { disputeId: dispute.id, userId, settlementId: s.id },
      },
    });
    return { id: dispute.id };
  });
}
export async function reviewDispute(adminId: string, raw: unknown) {
  const input = reviewDisputeInput.parse(raw);
  const initial = await db.dispute.findUniqueOrThrow({
    where: { id: input.id },
    include: { settlement: true },
  });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${initial.settlement.vehicleId} FOR UPDATE`;
    const admin = await tx.user.findUniqueOrThrow({ where: { id: adminId } });
    const dispute = await tx.dispute.findUniqueOrThrow({
      where: { id: input.id },
      include: { settlement: { include: { vehicle: true, bid: true } } },
    });
    if (
      admin.role !== 'ADMIN' ||
      admin.suspendedAt ||
      [dispute.settlement.vehicle.userId, dispute.settlement.bid.userId].includes(adminId)
    )
      throw new Error('FORBIDDEN');
    if (!blockingDisputes.includes(dispute.status)) throw new Error('CONFLICT');
    await tx.dispute.update({
      where: { id: input.id },
      data: {
        resolution: input.resolution,
        resolutionNote: input.note,
        reviewedBy: adminId,
        status: input.resolution === 'REFUND_REQUIRED' ? 'ACTION_REQUIRED' : 'RESOLVED',
      },
    });
    await tx.outboxEvent.create({
      data: {
        kind: 'dispute.reviewed',
        deliveredAt: new Date(),
        payload: { disputeId: input.id, adminId, resolution: input.resolution, note: input.note },
      },
    });
    await notify(tx, {
      type: 'dispute',
      disputeId: dispute.id,
      resolution: input.resolution,
      buyerId: dispute.settlement.bid.userId,
      vehicle: dispute.settlement.vehicle,
    });
  });
}
