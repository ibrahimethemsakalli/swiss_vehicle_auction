import type { Prisma } from '../generated/prisma/client';
import type { VehicleView } from './market-types';
export const publicVehicleInclude = {
  user: {
    select: {
      role: true,
      isIdentityVerified: true,
      dealerProfile: { select: { userId: true, published: true } },
    },
  },
  _count: { select: { bids: true } },
} satisfies Prisma.VehicleInclude;
type Record = Prisma.VehicleGetPayload<{ include: typeof publicVehicleInclude }>;
export function publicVehicle(v: Record): VehicleView {
  return {
    dealerProfileId:
      v.user.role === 'DEALER' && v.user.dealerProfile?.published
        ? v.user.dealerProfile.userId
        : null,
    dataDeclaredAt: v.dataDeclaredAt?.toISOString() ?? null,
    dataCorrectedAt: v.dataCorrectedAt?.toISOString() ?? null,
    dataCorrectedFields: v.dataCorrectedFields,
    city: v.city,
    postalCode: v.postalCode,
    fuelType: v.fuelType as VehicleView['fuelType'],
    transmission: v.transmission as VehicleView['transmission'],
    bodyType: v.bodyType as VehicleView['bodyType'],
    drivetrain: v.drivetrain as VehicleView['drivetrain'],
    condition: v.condition as VehicleView['condition'],
    exteriorColor: v.exteriorColor as VehicleView['exteriorColor'],
    accidentHistory: v.accidentHistory as VehicleView['accidentHistory'],
    warranty: v.warranty as VehicleView['warranty'],
    fuelConsumption: v.fuelConsumption,
    electricConsumption: v.electricConsumption,
    co2Emissions: v.co2Emissions,
    rangeKm: v.rangeKm,
    batteryCapacity: v.batteryCapacity,
    seats: v.seats,
    doors: v.doors,
    interiorColor: v.interiorColor as VehicleView['interiorColor'],
    energyClass: v.energyClass as VehicleView['energyClass'],
    euroNorm: v.euroNorm as VehicleView['euroNorm'],
    equipment: v.equipment,
    isSample: v.isSample,
    id: v.id,
    make: v.make,
    model: v.model,
    firstRegistration: v.firstRegistration?.toISOString() ?? null,
    modelYear: v.modelYear,
    mileage: v.mileage,
    canton: v.canton,
    mfkDate: v.mfkDate?.toISOString() ?? null,
    mfkStatus: v.mfkStatus as VehicleView['mfkStatus'],
    damageDescription: v.damageDescription,
    batteryHealth: v.batteryHealth,
    images: v.images,
    description: v.description,
    price: Number(
      v.listingType === 'FIXED_PRICE_OFFERS'
        ? (v.buyNowPrice ?? v.startPrice)
        : (v.currentPrice ?? v.startPrice),
    ),
    hasBids: v.currentPrice !== null,
    increment: Number(v.minimumIncrement),
    end: v.auctionEndsAt?.toISOString() ?? null,
    version: v.version,
    bidCount: v.listingType === 'FIXED_PRICE_OFFERS' ? 0 : v._count.bids,
    sellerType: v.user.role === 'DEALER' ? 'DEALER' : 'PRIVATE_USER',
    verified: v.isVerifiedPrivate && v.user.isIdentityVerified,
    stammnummer: v.stammnummer,
    maskedVin: `•••••••••••••${v.vinChassis.slice(-4)}`,
    powerKw: v.powerKw,
    cubicCapacity: v.cubicCapacity,
    serviceHistory: v.serviceHistory,
    tireCondition: v.tireCondition,
    listingType: v.listingType,
    status: v.status,
  };
}
