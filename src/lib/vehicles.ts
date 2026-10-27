import { z } from 'zod';
import { specOptions, equipmentOptions } from './vehicle-specs';
import { db } from './db';
import { sevenDaysFrom } from './auction-rules';
import { filenameFromPhotoUrl, PHOTO_LIMITS } from './photo-processing';
import { requireCurrentLegal } from './legal';
import { pastDateInput } from './validation-inputs';
export const vehicleInput = z
  .object({
    fuelType: z.enum(specOptions.fuelType).optional(),
    transmission: z.enum(specOptions.transmission).optional(),
    bodyType: z.enum(specOptions.bodyType).optional(),
    drivetrain: z.enum(specOptions.drivetrain).optional(),
    condition: z.enum(specOptions.condition).optional(),
    exteriorColor: z.enum(specOptions.exteriorColor).optional(),
    accidentHistory: z.enum(specOptions.accidentHistory).optional(),
    warranty: z.enum(specOptions.warranty).optional(),
    fuelConsumption: z.number().min(0).max(100).optional(),
    electricConsumption: z.number().min(0).max(200).optional(),
    co2Emissions: z.number().int().min(0).max(2000).optional(),
    rangeKm: z.number().int().min(0).max(2000).optional(),
    batteryCapacity: z.number().min(0).max(500).optional(),
    seats: z.number().int().min(1).max(30).optional(),
    doors: z.number().int().min(1).max(8).optional(),
    interiorColor: z.enum(specOptions.interiorColor).optional(),
    energyClass: z.enum(specOptions.energyClass).optional(),
    euroNorm: z.enum(specOptions.euroNorm).optional(),
    equipment: z.array(z.enum(equipmentOptions)).max(equipmentOptions.length).default([]),
    stammnummer: z.string().regex(/^\d{9}$/),
    vinChassis: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/),
    firstRegistration: pastDateInput,
    make: z.string().min(1).max(80),
    model: z.string().min(1).max(100),
    cubicCapacity: z.number().int().positive().optional(),
    powerKw: z.number().int().positive().optional(),
    mileage: z.number().int().min(0),
    canton: z.enum([
      'ZH',
      'BE',
      'LU',
      'UR',
      'SZ',
      'OW',
      'NW',
      'GL',
      'ZG',
      'FR',
      'SO',
      'BS',
      'BL',
      'SH',
      'AR',
      'AI',
      'SG',
      'GR',
      'AG',
      'TG',
      'TI',
      'VD',
      'VS',
      'NE',
      'GE',
      'JU',
    ]),
    mfkDate: pastDateInput,
    serviceHistory: z.enum(['FULL', 'PARTIAL', 'NONE']),
    tireCondition: z.string().min(1).max(200),
    description: z.string().max(5000),
    images: z
      .array(
        z.string().refine((s) => {
          try {
            filenameFromPhotoUrl(s);
            return true;
          } catch {
            return false;
          }
        }),
      )
      .min(1)
      .max(12)
      .refine((images) => new Set(images).size === images.length, { error: 'validationUnique' }),
    listingType: z.enum(['AUCTION_7_DAYS', 'FIXED_PRICE_OFFERS']),
    startPrice: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
    reservePrice: z
      .string()
      .regex(/^\d{1,9}(\.\d{1,2})?$/)
      .optional(),
    buyNowPrice: z
      .string()
      .regex(/^\d{1,9}(\.\d{1,2})?$/)
      .optional(),
  })
  .strict();
export async function createVehicle(id: string, raw: unknown) {
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  if (
    user.suspendedAt ||
    !user.isIdentityVerified ||
    !user.phoneVerifiedAt ||
    !user.emailVerifiedAt ||
    (user.role === 'DEALER' && !user.handelsregisterNr)
  )
    throw new Error('VERIFICATION_REQUIRED');
  const input = vehicleInput.parse(raw);
  if (
    Number(input.startPrice) <= 0 ||
    (input.reservePrice && Number(input.reservePrice) < Number(input.startPrice)) ||
    (input.buyNowPrice && Number(input.buyNowPrice) <= 0)
  )
    throw new Error('INVALID_PRICE');
  if (input.listingType === 'FIXED_PRICE_OFFERS' && !input.buyNowPrice)
    throw new Error('PRICE_REQUIRED');
  const now = new Date();
  const vehicle = await db.$transaction(async (tx) => {
    const legal = await requireCurrentLegal(id, tx);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
    const currentUser = await tx.user.findUniqueOrThrow({ where: { id } });
    if (
      currentUser.suspendedAt ||
      currentUser.isSample ||
      !currentUser.isIdentityVerified ||
      !currentUser.phoneVerifiedAt ||
      !currentUser.emailVerifiedAt ||
      (currentUser.role === 'DEALER' && !currentUser.handelsregisterNr)
    )
      throw new Error('VERIFICATION_REQUIRED');
    const filenames = input.images.map(filenameFromPhotoUrl);
    const photos = await tx.mediaAsset.findMany({
      where: {
        filename: { in: filenames },
        ownerId: id,
        status: 'READY',
        vehicleId: null,
        createdAt: { gte: new Date(Date.now() - PHOTO_LIMITS.orphanAgeMs) },
      },
    });
    if (photos.length !== filenames.length) throw new Error('PHOTO_OWNERSHIP_REQUIRED');
    const created = await tx.vehicle.create({
      data: {
        ...input,
        legalAcceptanceId: legal?.id,
        userId: id,
        isVerifiedPrivate: user.role === 'PRIVATE_USER',
        auctionStartAt: input.listingType === 'AUCTION_7_DAYS' ? now : null,
        auctionEndsAt: input.listingType === 'AUCTION_7_DAYS' ? sevenDaysFrom(now) : null,
      },
    });
    await tx.mediaAsset.updateMany({
      where: { id: { in: photos.map((p) => p.id) } },
      data: { vehicleId: created.id },
    });
    return created;
  });
  return { id: vehicle.id, status: vehicle.status };
}
