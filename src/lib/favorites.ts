import { z } from 'zod';
import type { PrismaClient, Prisma } from '../generated/prisma/client';
import { favoriteCommand, favoriteLimit, favoritePublicStates } from './favorite-rules';
type Db = Prisma.TransactionClient;
async function actor(db: Db, id: string) {
  const u = await db.user.findUnique({
    where: { id },
    select: { suspendedAt: true, isSample: true },
  });
  if (!u || u.suspendedAt || u.isSample) throw Error('FORBIDDEN');
}
async function snapshot(db: Db, userId: string) {
  const rows = await db.favorite.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { vehicleId: 'asc' }],
    select: { vehicleId: true, vehicle: { select: { status: true } } },
  });
  return {
    ids: rows.map((r) => r.vehicleId),
    unavailable: rows
      .filter((r) => !(favoritePublicStates as readonly string[]).includes(r.vehicle.status))
      .map((r) => r.vehicleId),
  };
}
export async function readFavorites(db: PrismaClient, userId: string) {
  await actor(db, userId);
  return snapshot(db, userId);
}
export async function changeFavorites(db: PrismaClient, userId: string, raw: unknown) {
  const input = favoriteCommand.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    await actor(tx, userId);
    if (input.action === 'set' && !input.saved) {
      await tx.favorite.deleteMany({ where: { userId, vehicleId: input.vehicleId } });
      return { ...(await snapshot(tx, userId)), skipped: 0 };
    }
    const requested = input.action === 'merge' ? [...new Set(input.ids)] : [input.vehicleId];
    const ids = requested.filter((id) => z.uuid().safeParse(id).success);
    const eligible = await tx.vehicle.findMany({
      where: { id: { in: ids }, status: { in: [...favoritePublicStates] } },
      select: { id: true },
    });
    if (input.action === 'set' && !eligible.length) throw Error('FAVORITE_UNAVAILABLE');
    const current = await tx.favorite.findMany({ where: { userId }, select: { vehicleId: true } });
    const present = new Set(current.map((r) => r.vehicleId));
    const additions = eligible.filter((v) => !present.has(v.id));
    if (current.length + additions.length > favoriteLimit) throw Error('FAVORITE_LIMIT');
    await tx.favorite.createMany({
      data: additions.map((v) => ({ userId, vehicleId: v.id })),
      skipDuplicates: true,
    });
    return { ...(await snapshot(tx, userId)), skipped: requested.length - eligible.length };
  });
}
