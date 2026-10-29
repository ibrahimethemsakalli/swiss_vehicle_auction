import { z } from 'zod';
import { declarationStamp } from './vehicle-data-origin';
import { recordRevision } from './listing-revisions';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { vehicleInput } from './vehicles';
import { specNumbers, specOptions, equipmentOptions } from './vehicle-specs';
import { filenameFromPhotoUrl, PHOTO_LIMITS } from './photo-processing';
import { requireCurrentLegal } from './legal';
const fieldNames = [
  'stammnummer',
  'vinChassis',
  'firstRegistration',
  'make',
  'model',
  'cubicCapacity',
  'powerKw',
  'mileage',
  'canton',
  'city',
  'postalCode',
  'mfkDate',
  'mfkStatus',
  'modelYear',
  'damageDescription',
  'serviceHistory',
  'tireCondition',
  'startPrice',
  'reservePrice',
  'buyNowPrice',
  'description',
] as const;
const fields = Object.fromEntries(
  fieldNames.map((k) => [
    k,
    z.string().max(k === 'description' ? 5000 : k === 'damageDescription' ? 2000 : 200),
  ]),
) as Record<(typeof fieldNames)[number], z.ZodString>;
export const draftPayload = z
  .object({
    draft: z.object(fields).partial().strict(),
    specs: z
      .record(z.string(), z.string().max(30))
      .refine(
        (s) =>
          Object.keys(s).length <= 30 &&
          Object.keys(s).every((k) => k in specOptions || k in specNumbers),
      ),
    equipment: z.array(z.enum(equipmentOptions)).max(equipmentOptions.length),
    images: z
      .array(
        z
          .string()
          .max(100)
          .refine((s) => {
            try {
              filenameFromPhotoUrl(s);
              return true;
            } catch {
              return false;
            }
          }),
      )
      .max(12)
      .refine((a) => new Set(a).size === a.length),
    customMake: z.boolean(),
    customModel: z.boolean(),
    registrationYear: z.string().regex(/^(|\d{4})$/),
    listingType: z.enum(['AUCTION_7_DAYS', 'FIXED_PRICE_OFFERS']),
  })
  .strict();
export const draftCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save'),
      id: z.uuid(),
      revision: z.number().int().min(0),
      step: z.number().int().min(0).max(3),
      payload: draftPayload,
    })
    .strict(),
  z
    .object({
      action: z.enum(['edit', 'revise', 'relist']),
      vehicleId: z.uuid(),
      version: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      action: z.literal('submit'),
      id: z.uuid(),
      revision: z.number().int().positive(),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({ action: z.literal('discard'), id: z.uuid(), revision: z.number().int().positive() })
    .strict(),
]);
export function assertReviewVersion(actual: number, expected: number) {
  if (actual !== expected) throw Error('CONFLICT');
}
type Tx = Prisma.TransactionClient;
async function actor(tx: Tx, id: string) {
  const u = await tx.user.findUnique({ where: { id } });
  if (!u || u.suspendedAt || u.isSample) throw Error('FORBIDDEN');
  return u;
}
function complete(p: z.infer<typeof draftPayload>) {
  const raw: Record<string, unknown> = {
    ...p.draft,
    ...p.specs,
    listingType: p.listingType,
    equipment: p.equipment,
    images: p.images,
  };
  for (const k of ['modelYear', 'cubicCapacity', 'powerKw', ...Object.keys(specNumbers)]) {
    if (raw[k] === '' || raw[k] === undefined) delete raw[k];
    else raw[k] = Number(raw[k]);
  }
  if (raw.mileage !== '' && raw.mileage !== undefined) raw.mileage = Number(raw.mileage);
  for (const k of ['reservePrice', 'buyNowPrice', ...Object.keys(specOptions)])
    if (raw[k] === '') delete raw[k];
  const input = vehicleInput.parse(raw);
  if (
    Number(input.startPrice) <= 0 ||
    (input.reservePrice && Number(input.reservePrice) < Number(input.startPrice)) ||
    (input.buyNowPrice && Number(input.buyNowPrice) <= 0) ||
    (input.listingType === 'FIXED_PRICE_OFFERS' && !input.buyNowPrice)
  )
    throw Error('DRAFT_PRICE');
  return input;
}
export async function readDrafts(db: PrismaClient, userId: string, raw: unknown) {
  const q = z.object({ id: z.uuid().optional() }).strict().parse(raw);
  await actor(db, userId);
  if (q.id) {
    const row = await db.listingDraft.findFirst({
      where: { id: q.id, ownerId: userId, status: 'DRAFT' },
    });
    if (!row) throw Error('FORBIDDEN');
    return row;
  }
  const [drafts, pending, recoverable] = await Promise.all([
    db.listingDraft.findMany({
      where: { ownerId: userId, status: 'DRAFT' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    db.vehicle.findMany({
      where: { userId, status: 'PENDING_VERIFICATION', isSample: false },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, make: true, model: true, version: true },
    }),
    db.vehicle.findMany({
      where: {
        userId,
        isSample: false,
        OR: [
          { status: { in: ['REJECTED', 'EXPIRED', 'DRAFT', 'PENDING_VERIFICATION'] } },
          { revisions: { some: {} } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        make: true,
        model: true,
        status: true,
        version: true,
        auctionEndsAt: true,
        _count: { select: { bids: true, holds: true } },
        settlement: { select: { id: true } },
        revisions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { version: true, action: true, note: true, corrections: true, createdAt: true },
        },
      },
    }),
  ]);
  return { drafts, pending, recoverable };
}
async function attachPhotos(
  tx: Tx,
  userId: string,
  id: string,
  images: string[],
  vehicleId: string | null,
) {
  const names = images.map(filenameFromPhotoUrl);
  const photos = await tx.mediaAsset.findMany({
    where: { ownerId: userId, filename: { in: names }, status: 'READY' },
  });
  if (
    photos.length !== names.length ||
    photos.some(
      (p) =>
        (p.draftId && p.draftId !== id) ||
        (p.vehicleId && p.vehicleId !== vehicleId) ||
        (!p.draftId &&
          !p.vehicleId &&
          p.createdAt.getTime() < Date.now() - PHOTO_LIMITS.orphanAgeMs),
    )
  )
    throw Error('PHOTO_OWNERSHIP_REQUIRED');
  await tx.mediaAsset.updateMany({
    where: { draftId: id, filename: { notIn: names } },
    data: { draftId: null },
  });
  await tx.mediaAsset.updateMany({
    where: { id: { in: photos.map((p) => p.id) } },
    data: { draftId: id },
  });
}
export async function mutateDraft(db: PrismaClient, userId: string, raw: unknown) {
  const input = draftCommand.parse(raw);
  return db.$transaction(async (tx) => {
    const legal = input.action === 'submit' ? await requireCurrentLegal(userId, tx) : null;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const u = await actor(tx, userId);
    if ('vehicleId' in input) {
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${input.vehicleId} FOR UPDATE`;
      const v = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
      if (!v || v.userId !== userId || v.isSample) throw Error('FORBIDDEN');
      if (
        v.status !==
          (input.action === 'relist'
            ? 'EXPIRED'
            : input.action === 'revise'
              ? 'REJECTED'
              : 'PENDING_VERIFICATION') ||
        (input.action === 'relist' && (!v.auctionEndsAt || v.auctionEndsAt > new Date())) ||
        v.version !== input.version ||
        (await tx.bid.count({ where: { vehicleId: v.id } })) ||
        (await tx.paymentHold.count({ where: { vehicleId: v.id } })) ||
        (await tx.settlement.count({ where: { vehicleId: v.id } }))
      )
        throw Error('DRAFT_LOCKED');
      if ((await tx.listingDraft.count({ where: { ownerId: userId, status: 'DRAFT' } })) >= 20)
        throw Error('DRAFT_QUOTA');
      await recordRevision(
        tx,
        v,
        input.action === 'relist'
          ? 'RELIST_STARTED'
          : input.action === 'revise'
            ? 'REVISION_STARTED'
            : 'EDIT_STARTED',
      );
      const draft: Record<string, string> = {},
        specs: Record<string, string> = {};
      for (const k of fieldNames) {
        const value = v[k as keyof typeof v];
        draft[k] =
          value == null
            ? ''
            : value instanceof Date
              ? value.toISOString().slice(0, 10)
              : String(value);
      }
      for (const k of [...Object.keys(specOptions), ...Object.keys(specNumbers)]) {
        const value = v[k as keyof typeof v];
        if (value != null) specs[k] = String(value);
      }
      const payload = draftPayload.parse({
        draft,
        specs,
        equipment: v.equipment,
        images: v.images,
        customMake: true,
        customModel: true,
        registrationYear: draft.firstRegistration.slice(0, 4),
        listingType: v.listingType,
      });
      const old = await tx.listingDraft.findUnique({ where: { vehicleId: v.id } });
      if (
        (!old || old.status !== 'DRAFT') &&
        (await tx.listingDraft.count({ where: { ownerId: userId, status: 'DRAFT' } })) >= 20
      )
        throw Error('DRAFT_QUOTA');
      const row = old
        ? await tx.listingDraft.update({
            where: { id: old.id },
            data: { payload, step: 1, status: 'DRAFT', revision: { increment: 1 } },
          })
        : await tx.listingDraft.create({
            data: { id: crypto.randomUUID(), ownerId: userId, vehicleId: v.id, payload, step: 1 },
          });
      await attachPhotos(tx, userId, row.id, payload.images, v.id);
      await tx.vehicle.update({
        where: { id: v.id },
        data: {
          status: 'DRAFT',
          version: { increment: 1 },
          auctionStartAt: null,
          auctionEndsAt: null,
          ...(input.action === 'relist' ? { currentPrice: null, antiSnipingCount: 0 } : {}),
        },
      });
      return row;
    }
    const old = await tx.listingDraft.findUnique({ where: { id: input.id } });
    if (old && old.ownerId !== userId) throw Error('FORBIDDEN');
    if (input.action === 'save') {
      if (
        (old && (old.status !== 'DRAFT' || old.revision !== input.revision)) ||
        (!old && input.revision !== 0)
      )
        throw Error('DRAFT_CONFLICT');
      if (
        !old &&
        (await tx.listingDraft.count({ where: { ownerId: userId, status: 'DRAFT' } })) >= 20
      )
        throw Error('DRAFT_QUOTA');
      const row = old
        ? await tx.listingDraft.update({
            where: { id: input.id },
            data: { payload: input.payload, step: input.step, revision: { increment: 1 } },
          })
        : await tx.listingDraft.create({
            data: { id: input.id, ownerId: userId, payload: input.payload, step: input.step },
          });
      await attachPhotos(tx, userId, row.id, input.payload.images, row.vehicleId);
      return row;
    }
    if (!old || old.revision !== input.revision) throw Error('DRAFT_CONFLICT');
    if (input.action === 'discard') {
      if (old.status !== 'DRAFT' || old.vehicleId) throw Error('DRAFT_LOCKED');
      await tx.mediaAsset.updateMany({ where: { draftId: old.id }, data: { draftId: null } });
      await tx.listingDraft.delete({ where: { id: old.id } });
      return { ok: true };
    }
    if (old.status === 'SUBMITTED' && old.vehicleId) {
      const existing = await tx.vehicle.findUniqueOrThrow({
        where: { id: old.vehicleId },
        select: { id: true, status: true },
      });
      return existing;
    }
    if (old.status !== 'DRAFT') throw Error('DRAFT_LOCKED');
    if (
      !u.isIdentityVerified ||
      !u.phoneVerifiedAt ||
      !u.emailVerifiedAt ||
      (u.role === 'DEALER' && !u.handelsregisterNr)
    )
      throw Error('VERIFICATION_REQUIRED');
    const payload = draftPayload.parse(old.payload),
      completeInput = complete(payload);
    await attachPhotos(tx, userId, old.id, payload.images, old.vehicleId);
    if (old.vehicleId) {
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${old.vehicleId} FOR UPDATE`;
      const v = await tx.vehicle.findUniqueOrThrow({ where: { id: old.vehicleId } });
      if (
        v.userId !== userId ||
        v.status !== 'DRAFT' ||
        (await tx.bid.count({ where: { vehicleId: v.id } })) ||
        (await tx.paymentHold.count({ where: { vehicleId: v.id } })) ||
        (await tx.settlement.count({ where: { vehicleId: v.id } }))
      )
        throw Error('DRAFT_LOCKED');
    }
    const data = {
      ...completeInput,
      ...declarationStamp(),
      userId,
      isVerifiedPrivate: u.role === 'PRIVATE_USER',
      legalAcceptanceId: legal?.id ?? null,
      status: 'PENDING_VERIFICATION' as const,
      auctionStartAt: null,
      auctionEndsAt: null,
    };
    const vehicle = old.vehicleId
      ? await tx.vehicle.update({
          where: { id: old.vehicleId },
          data: {
            ...Object.fromEntries(
              [
                ...Object.keys(specOptions),
                ...Object.keys(specNumbers),
                'modelYear',
                'damageDescription',
                'cubicCapacity',
                'powerKw',
                'reservePrice',
                'buyNowPrice',
              ].map((k) => [k, null]),
            ),
            ...data,
            version: { increment: 1 },
          },
        })
      : await tx.vehicle.create({ data });
    await recordRevision(tx, vehicle, 'SUBMITTED');
    await tx.mediaAsset.updateMany({
      where: { vehicleId: vehicle.id, OR: [{ draftId: null }, { draftId: { not: old.id } }] },
      data: { vehicleId: null },
    });
    await tx.mediaAsset.updateMany({
      where: { draftId: old.id },
      data: { vehicleId: vehicle.id, draftId: null },
    });
    await tx.listingDraft.update({
      where: { id: old.id },
      data: { status: 'SUBMITTED', vehicleId: vehicle.id },
    });
    return { id: vehicle.id, status: vehicle.status };
  });
}
