import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';

// Production collection intentionally remains off until the retention/privacy policy is agreed.
export const viewCollectionEnabled = () =>
  process.env.NODE_ENV !== 'production' &&
  process.env.LOCAL_TEST_PAYMENTS === 'true' &&
  !!process.env.NEXTAUTH_SECRET;
export const statisticsDay = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
export const statisticsSince = (now = new Date()) =>
  new Date(statisticsDay(now).getTime() - 29 * 86400000);
export const likelyBot = (ua: string) =>
  !ua || /bot|crawler|spider|headless|preview|slurp|curl|wget/i.test(ua);
export function dailyViewerToken(id: string, day: Date, secret: string) {
  return createHmac('sha256', secret)
    .update(`listing-view-v1:${day.toISOString()}:${id}`)
    .digest('hex');
}
export const viewInput = z.object({ vehicleId: z.uuid() }).strict();
export async function recordListingView(
  db: PrismaClient,
  userId: string,
  raw: unknown,
  ua: string,
  now = new Date(),
) {
  const { vehicleId } = viewInput.parse(raw);
  if (!viewCollectionEnabled() || likelyBot(ua)) return;
  const day = statisticsDay(now),
    token = dailyViewerToken(userId, day, process.env.NEXTAUTH_SECRET!);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${token}, 0))::text`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { suspendedAt: true, isSample: true, role: true, emailVerifiedAt: true },
    });
    if (
      !user ||
      user.suspendedAt ||
      user.isSample ||
      user.role === 'ADMIN' ||
      !user.emailVerifiedAt
    )
      return;
    const vehicle = await tx.vehicle.findFirst({
      where: {
        id: vehicleId,
        status: 'ACTIVE',
        isSample: false,
        userId: { not: userId },
        user: { isSample: false, suspendedAt: null },
        OR: [{ listingType: 'FIXED_PRICE_OFFERS' }, { auctionEndsAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (!vehicle) return;
    if ((await tx.listingViewDay.count({ where: { day, viewerToken: token } })) >= 100) return;
    await tx.listingViewDay.createMany({
      data: [{ vehicleId, day, viewerToken: token }],
      skipDuplicates: true,
    });
  });
}
export async function cleanupListingViews(db: PrismaClient, now = new Date()) {
  const old = await db.listingViewDay.findMany({
    where: { day: { lt: statisticsSince(now) } },
    select: { id: true },
    take: 10000,
  });
  return db.listingViewDay.deleteMany({ where: { id: { in: old.map((v) => v.id) } } });
}
export async function readListingStatistics(
  db: PrismaClient,
  userId: string,
  raw: unknown,
  now = new Date(),
) {
  const { page } = z
    .object({ page: z.coerce.number().int().min(1).max(100000).default(1) })
    .strict()
    .parse(raw);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { suspendedAt: true, isSample: true },
  });
  if (!user || user.suspendedAt || user.isSample) throw Error('FORBIDDEN');
  const since = statisticsSince(now);
  return db.$transaction(
    async (tx) => {
      const where = { userId, isSample: false };
      const total = await tx.vehicle.count({ where });
      const vehicles = await tx.vehicle.findMany({
        where,
        select: { id: true, make: true, model: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * 20,
        take: 20,
      });
      const ids = vehicles.map((v) => v.id);
      const [views, favorites, contacts] = await Promise.all([
        tx.listingViewDay.groupBy({
          by: ['vehicleId'],
          where: { vehicleId: { in: ids }, day: { gte: since, lte: statisticsDay(now) } },
          _count: true,
        }),
        tx.favorite.groupBy({
          by: ['vehicleId'],
          where: {
            vehicleId: { in: ids },
            userId: { not: userId },
            user: { isSample: false, suspendedAt: null },
          },
          _count: true,
        }),
        tx.conversation.groupBy({
          by: ['vehicleId'],
          where: {
            vehicleId: { in: ids },
            sellerId: userId,
            buyerId: { not: userId },
            createdAt: { gte: since, lte: now },
            buyer: { isSample: false, suspendedAt: null },
            messages: { some: { senderId: { not: userId }, hiddenAt: null } },
          },
          _count: true,
        }),
      ]);
      const counts = (rows: { vehicleId: string; _count: number }[]) =>
        new Map(rows.map((r) => [r.vehicleId, r._count]));
      const v = counts(views),
        f = counts(favorites),
        c = counts(contacts);
      return {
        page,
        total,
        since: since.toISOString(),
        until: now.toISOString(),
        collectionEnabled: viewCollectionEnabled(),
        rows: vehicles.map((row) => ({
          ...row,
          views: viewCollectionEnabled() ? (v.get(row.id) ?? 0) : null,
          favorites: f.get(row.id) ?? 0,
          contacts: c.get(row.id) ?? 0,
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
