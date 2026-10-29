import { z } from 'zod';
import { normalizeCity } from './vehicle-location';
import type { Prisma } from '../generated/prisma/client';
import { specOptions, specNumbers, equipmentOptions } from './vehicle-specs';
import { cantons, type Filters } from './market-types';
const bound = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const range = z.object({ min: bound.optional(), max: bound.optional() }).strict();
export const filterInput = z
  .object({
    city: z.string().max(80).transform(normalizeCity).optional(),
    postalCode: z
      .string()
      .regex(/^\d{0,4}$/)
      .optional(),
    query: z.string().max(180).default(''),
    canton: z
      .string()
      .refine((v) => !v || cantons.includes(v))
      .default(''),
    price: bound.default(Number.MAX_SAFE_INTEGER),
    mileage: bound.default(Number.MAX_SAFE_INTEGER),
    privateOnly: z.boolean().default(true),
    mfk: z.boolean().default(false),
    sort: z.enum(['ending', 'priceAsc', 'priceDesc']).default('ending'),
    make: z.string().max(80).optional(),
    model: z.string().max(100).optional(),
    minPrice: bound.optional(),
    minMileage: bound.optional(),
    yearFrom: z.number().int().min(1900).max(2100).optional(),
    yearTo: z.number().int().min(1900).max(2100).optional(),
    specs: z
      .record(z.string(), z.string())
      .refine((value) =>
        Object.entries(value).every(
          ([k, v]) =>
            Object.keys(specOptions).includes(k) &&
            (!v || (specOptions[k as keyof typeof specOptions] as readonly string[]).includes(v)),
        ),
      )
      .optional(),
    ranges: z
      .record(z.string(), range)
      .refine((value) =>
        Object.keys(value).every(
          (k) => Object.keys(specNumbers).includes(k) || ['powerKw', 'cubicCapacity'].includes(k),
        ),
      )
      .optional(),
    equipment: z.array(z.enum(equipmentOptions)).max(equipmentOptions.length).optional(),
  })
  .strict();
export function marketWhere(f: Filters, now = new Date()): Prisma.VehicleWhereInput {
  const intBounds = (min?: number, max?: number) => ({
    gte: min === undefined ? undefined : Math.min(2147483647, Math.ceil(min)),
    lte: max === undefined ? undefined : Math.min(2147483647, Math.floor(max)),
  });
  const and: Prisma.VehicleWhereInput[] = [
    { status: 'ACTIVE' },
    { mileage: intBounds(f.minMileage, f.mileage) },
  ];
  if ((f.minMileage ?? 0) > 2147483647) and.push({ id: { in: [] } });
  if (f.make) and.push({ make: f.make });
  if (f.model) and.push({ model: f.model });
  if (f.canton) and.push({ canton: f.canton });
  if (f.city) and.push({ city: { equals: normalizeCity(f.city), mode: 'insensitive' } });
  if (f.postalCode) and.push({ postalCode: { startsWith: f.postalCode } });
  if (f.privateOnly) and.push({ user: { role: 'PRIVATE_USER' } });
  if (f.equipment?.length) and.push({ equipment: { hasEvery: f.equipment } });
  // Token search supports make and model in the same query.
  for (const token of f.query.trim().split(/\s+/).filter(Boolean))
    and.push({
      OR: [
        { make: { contains: token, mode: 'insensitive' } },
        { model: { contains: token, mode: 'insensitive' } },
      ],
    });
  if (f.yearFrom || f.yearTo) and.push({ modelYear: { gte: f.yearFrom, lte: f.yearTo } });
  if (f.mfk) {
    const since = new Date(now);
    since.setUTCFullYear(since.getUTCFullYear() - 1);
    and.push({ isSample: false, mfkStatus: 'DATED', mfkDate: { gt: since, lte: now } });
  }
  for (const [key, value] of Object.entries(f.specs ?? {})) if (value) and.push({ [key]: value });
  for (const [key, value] of Object.entries(f.ranges ?? {}))
    if (value.min !== undefined || value.max !== undefined) {
      const integer = [
        'powerKw',
        'cubicCapacity',
        'co2Emissions',
        'rangeKm',
        'seats',
        'doors',
      ].includes(key);
      if (integer && (value.min ?? 0) > 2147483647) and.push({ id: { in: [] } });
      and.push({
        [key]: integer ? intBounds(value.min, value.max) : { gte: value.min, lte: value.max },
      });
    }
  const price = { gte: f.minPrice ?? 0, lte: f.price };
  and.push({
    OR: [
      { listingType: 'AUCTION_7_DAYS', currentPrice: { not: null, ...price } },
      { listingType: 'AUCTION_7_DAYS', currentPrice: null, startPrice: price },
      { listingType: 'FIXED_PRICE_OFFERS', buyNowPrice: { not: null, ...price } },
      { listingType: 'FIXED_PRICE_OFFERS', buyNowPrice: null, startPrice: price },
    ],
  });
  return { AND: and };
}
