import { z } from 'zod';
import { manualCorrectionStamp } from './vehicle-data-origin';
import type { PrismaClient } from '../generated/prisma/client';
import { inspectionFields, inspectMfk } from './vehicle-disclosures';
import { pastDateInput } from './validation-inputs';
import { sevenDaysFrom } from './auction-rules';
import { notify } from './notifications';
import { assertReviewVersion } from './listing-drafts';
import { correctionKeys, reviewFeedback } from './review-feedback';
import { recordRevision } from './listing-revisions';
export const reviewInput = z
  .object({
    id: z.uuid(),
    version: z.number().int().min(0),
    action: z.enum(['approve', 'reject']),
    note: z.string().trim().min(5).max(2000),
    corrections: z.array(z.enum(correctionKeys)).max(5).default([]),
    make: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(100),
    stammnummer: z.string().regex(/^\d{9}$/),
    vinChassis: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/),
    firstRegistration: pastDateInput,
    ...inspectionFields,
  })
  .strict()
  .superRefine(inspectMfk)
  .superRefine((v, ctx) => {
    const r = reviewFeedback.safeParse(v);
    if (!r.success) for (const i of r.error.issues) ctx.addIssue({ ...i, code: 'custom' });
  });
export async function reviewListing(db: PrismaClient, adminId: string, raw: unknown) {
  const admin = await db.user.findUnique({ where: { id: adminId } });
  if (!admin || admin.role !== 'ADMIN' || admin.suspendedAt) throw Error('FORBIDDEN');
  const input = reviewInput.parse(raw);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${input.id} FOR UPDATE`;
    const old = await tx.vehicle.findUniqueOrThrow({
      where: { id: input.id },
      include: { user: true },
    });
    if (old.status !== 'PENDING_VERIFICATION') throw new Error('CONFLICT');
    assertReviewVersion(old.version, input.version);
    if (
      input.action === 'approve' &&
      (old.user.suspendedAt ||
        !old.user.isIdentityVerified ||
        !old.user.phoneVerifiedAt ||
        (old.user.role === 'DEALER' && !old.user.handelsregisterNr))
    )
      throw new Error('SELLER_NOT_VERIFIED');
    const { id, action, note, version, corrections, ...fields } = input;
    const now = new Date();
    const dataCorrection = manualCorrectionStamp(old, fields, now);
    await recordRevision(
      tx,
      old,
      action === 'approve' ? 'APPROVED' : 'REJECTED',
      note,
      corrections,
    );
    await tx.vehicle.update({
      where: { id },
      data: {
        ...fields,
        ...dataCorrection,
        status: action === 'approve' ? 'ACTIVE' : 'REJECTED',
        isVerifiedPrivate: old.user.role === 'PRIVATE_USER' && old.user.isIdentityVerified,
        ...(action === 'approve' && old.listingType === 'AUCTION_7_DAYS'
          ? { auctionStartAt: now, auctionEndsAt: sevenDaysFrom(now) }
          : {}),
        version: { increment: 1 },
      },
    });
    // Audit records are retained, never broadcast to public socket rooms.
    await notify(tx, {
      type: 'review',
      vehicle: { ...old, ...fields },
      version: old.version + 1,
      approved: action === 'approve',
    });
    await tx.outboxEvent.create({
      data: {
        kind: 'admin.review',
        deliveredAt: now,
        payload: {
          adminId,
          vehicleId: id,
          action,
          note,
          previous: {
            make: old.make,
            model: old.model,
            stammnummer: old.stammnummer,
            vinChassis: old.vinChassis,
            firstRegistration: old.firstRegistration?.toISOString() ?? null,
            mfkDate: old.mfkDate?.toISOString() ?? null,
            mfkStatus: old.mfkStatus,
          },
          updated: {
            ...fields,
            ...dataCorrection,
            firstRegistration: fields.firstRegistration.toISOString(),
            mfkDate: fields.mfkDate?.toISOString() ?? null,
            mfkStatus: fields.mfkStatus,
          },
        },
      },
    });
  });
}
