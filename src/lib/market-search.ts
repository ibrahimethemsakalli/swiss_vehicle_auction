import { Prisma } from '../generated/prisma/client';
import { db } from './db';
import { filterInput } from './market-query';
import { publicVehicle, publicVehicleInclude } from './public-vehicle';
import { specNumbers, specOptions } from './vehicle-specs';

const columns = new Set([
  ...Object.keys(specOptions),
  ...Object.keys(specNumbers),
  'powerKw',
  'cubicCapacity',
]);
const integerColumns = new Set([
  'mileage',
  'powerKw',
  'cubicCapacity',
  'co2Emissions',
  'rangeKm',
  'seats',
  'doors',
]);
const column = (name: string) => {
  if (!columns.has(name) && name !== 'mileage') throw new Error('INVALID_SEARCH_COLUMN');
  // Only compile source-controlled column names, never identifiers from a request.
  return Prisma.raw(`v."${name}"`);
};
export const marketPrice = Prisma.sql`CASE WHEN v."listingType" = 'FIXED_PRICE_OFFERS' THEN COALESCE(v."buyNowPrice", v."startPrice") ELSE COALESCE(v."currentPrice", v."startPrice") END`;
export const marketPageSize = 24;
export function marketSearchSql(input: unknown, page: number, now = new Date()) {
  const f = filterInput.parse(input);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error('INVALID_PAGE');
  const conditions = [Prisma.sql`v."status" = 'ACTIVE'`];
  const range = (key: string, min?: number, max?: number) => {
    const c = column(key),
      integer = integerColumns.has(key);
    if (integer && (min ?? 0) > 2147483647) conditions.push(Prisma.sql`FALSE`);
    if (min !== undefined)
      conditions.push(Prisma.sql`${c} >= ${integer ? Math.min(2147483647, Math.ceil(min)) : min}`);
    if (max !== undefined)
      conditions.push(Prisma.sql`${c} <= ${integer ? Math.min(2147483647, Math.floor(max)) : max}`);
  };
  range('mileage', f.minMileage, f.mileage);
  if (f.make) conditions.push(Prisma.sql`v."make" = ${f.make}`);
  if (f.model) conditions.push(Prisma.sql`v."model" = ${f.model}`);
  if (f.canton) conditions.push(Prisma.sql`v."canton" = ${f.canton}`);
  if (f.city) conditions.push(Prisma.sql`v."city" ILIKE ${f.city}`);
  if (f.postalCode) conditions.push(Prisma.sql`v."postalCode" LIKE ${f.postalCode + '%'}`);
  if (f.privateOnly)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "User" u WHERE u.id = v."userId" AND u.role = 'PRIVATE_USER')`,
    );
  if (f.equipment?.length)
    conditions.push(Prisma.sql`v.equipment @> ARRAY[${Prisma.join(f.equipment)}]::text[]`);
  for (const token of f.query.trim().split(/\s+/).filter(Boolean)) {
    conditions.push(
      Prisma.sql`(v.make ILIKE ${'%' + token + '%'} OR v.model ILIKE ${'%' + token + '%'})`,
    );
  }
  if (f.yearFrom) conditions.push(Prisma.sql`v."modelYear" >= ${f.yearFrom}`);
  if (f.yearTo) conditions.push(Prisma.sql`v."modelYear" <= ${f.yearTo}`);
  if (f.mfk) {
    const since = new Date(now);
    since.setUTCFullYear(since.getUTCFullYear() - 1);
    conditions.push(
      Prisma.sql`v."isSample" = FALSE AND v."mfkStatus" = 'DATED' AND v."mfkDate" > ${since} AND v."mfkDate" <= ${now}`,
    );
  }
  for (const [key, value] of Object.entries(f.specs ?? {}))
    if (value) conditions.push(Prisma.sql`${column(key)} = ${value}`);
  for (const [key, value] of Object.entries(f.ranges ?? {})) range(key, value.min, value.max);
  conditions.push(
    Prisma.sql`${marketPrice} >= ${f.minPrice ?? 0} AND ${marketPrice} <= ${f.price}`,
  );
  const where = Prisma.join(conditions, ' AND ');
  const order =
    f.sort === 'priceAsc'
      ? Prisma.sql`${marketPrice} ASC`
      : f.sort === 'priceDesc'
        ? Prisma.sql`${marketPrice} DESC`
        : Prisma.sql`v."auctionEndsAt" ASC NULLS LAST`;
  return {
    ids: Prisma.sql`SELECT v.id FROM "Vehicle" v WHERE ${where} ORDER BY ${order}, v.id ASC LIMIT ${marketPageSize} OFFSET ${(page - 1) * marketPageSize}`,
    count: Prisma.sql`SELECT count(*)::bigint AS total FROM "Vehicle" v WHERE ${where}`,
  };
}

export async function searchMarket(input: unknown, page: number, client = db) {
  const sql = marketSearchSql(input, page);
  // Count, page IDs and hydrated records share one snapshot while auctions change.
  return client.$transaction(
    async (tx) => {
      const ids = await tx.$queryRaw<{ id: string }[]>(sql.ids);
      const [count] = await tx.$queryRaw<{ total: bigint }[]>(sql.count);
      const vehicles = ids.length
        ? await tx.vehicle.findMany({
            where: { id: { in: ids.map((v) => v.id) } },
            include: publicVehicleInclude,
          })
        : [];
      const byId = new Map(vehicles.map((v) => [v.id, v]));
      const catalog = await tx.vehicle.groupBy({
        by: ['make', 'model'],
        where: { status: 'ACTIVE' },
        orderBy: [{ make: 'asc' }, { model: 'asc' }],
      });
      return {
        vehicles: ids.map(({ id }) => publicVehicle(byId.get(id)!)),
        total: Number(count.total),
        page,
        catalog,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
}
