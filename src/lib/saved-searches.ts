import type { PrismaClient, Prisma } from '../generated/prisma/client';
import { savedSearchCommand } from './search-state';
import { filterInput, marketWhere } from './market-query';

async function actor(db: Prisma.TransactionClient, id: string) {
  const user = await db.user.findUnique({
    where: { id },
    select: { suspendedAt: true, isSample: true },
  });
  if (!user || user.suspendedAt || user.isSample) throw Error('FORBIDDEN');
}
function list(db: Prisma.TransactionClient, userId: string) {
  return db.savedSearch.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: { id: true, name: true, filters: true, alerts: true },
  });
}
export async function readSearches(db: PrismaClient, userId: string) {
  await actor(db, userId);
  return { items: await list(db, userId) };
}
export async function changeSearches(db: PrismaClient, userId: string, raw: unknown) {
  const input = savedSearchCommand.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    await actor(tx, userId);
    if (input.action === 'delete')
      await tx.savedSearch.deleteMany({ where: { id: input.id, userId } });
    else {
      if ((await tx.savedSearch.count({ where: { userId } })) >= 20) throw Error('SEARCH_LIMIT');
      if (await tx.savedSearch.findFirst({ where: { userId, name: input.name } }))
        throw Error('SEARCH_NAME');
      await tx.savedSearch.create({
        data: {
          userId,
          name: input.name,
          filters: input.filters as Prisma.InputJsonValue,
          alerts: input.alerts,
        },
      });
    }
    return { items: await list(tx, userId) };
  });
}

// Bounded, durable sweep; retry-safe per search/vehicle, with no external delivery.
export async function notifySearchMatches(db: PrismaClient) {
  const searches = await db.savedSearch.findMany({
    where: { alerts: true, user: { suspendedAt: null, isSample: false } },
    orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true },
  });
  for (const { id } of searches)
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SavedSearch" WHERE id=${id} FOR UPDATE`;
      const search = await tx.savedSearch.findUnique({ where: { id } });
      if (!search || !search.alerts) return;
      const now = new Date();
      const vehicles = await tx.vehicle.findMany({
        where: {
          AND: [
            marketWhere(filterInput.parse(search.filters), now),
            { isSample: false, userId: { not: search.userId }, updatedAt: { lte: now } },
            {
              OR: [
                { updatedAt: { gt: search.checkedAt } },
                { updatedAt: search.checkedAt, id: { gt: search.checkedId } },
              ],
            },
            { OR: [{ listingType: 'FIXED_PRICE_OFFERS' }, { auctionEndsAt: { gt: now } }] },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
      await tx.notification.createMany({
        data: vehicles.map((v) => ({
          userId: search.userId,
          eventKey: `search:${id}:${v.id}`,
          kind: 'SEARCH_MATCH',
          vehicleId: v.id,
          vehicleName: `${v.make} ${v.model}`.slice(0, 181),
        })),
        skipDuplicates: true,
      });
      const last = vehicles.at(-1);
      await tx.savedSearch.update({
        where: { id },
        data: {
          checkedAt: vehicles.length === 100 && last ? last.updatedAt : now,
          checkedId: vehicles.length === 100 && last ? last.id : '',
        },
      });
    });
}
