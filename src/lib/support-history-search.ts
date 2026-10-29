import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
export const historyFilters = z
  .object({
    message: z.string().trim().max(160).default(''),
    from: day.optional(),
    to: day.optional(),
    context: z.uuid().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to);
export type HistoryFilters = z.input<typeof historyFilters>;
export async function readFilteredHistory(
  db: PrismaClient,
  ticketId: string,
  page: number,
  raw: HistoryFilters,
) {
  const q = historyFilters.parse(raw);
  let resolvedPage = page;
  const where: Prisma.SupportEntryWhereInput = { ticketId };
  if (q.context) {
    const anchor = await db.supportEntry.findFirst({
      where: { id: q.context, ticketId },
      select: { id: true, createdAt: true },
    });
    if (!anchor) throw Error('NOT_FOUND');
    const before = await db.supportEntry.count({
      where: {
        ticketId,
        OR: [
          { createdAt: { lt: anchor.createdAt } },
          { createdAt: anchor.createdAt, id: { lt: anchor.id } },
        ],
      },
    });
    resolvedPage = Math.floor(before / 30) + 1;
  } else {
    if (q.message)
      where.body = { contains: q.message.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' };
    if (q.from || q.to)
      where.createdAt = {
        ...(q.from ? { gte: new Date(q.from + 'T00:00:00Z') } : {}),
        ...(q.to ? { lt: new Date(new Date(q.to + 'T00:00:00Z').getTime() + 86400000) } : {}),
      };
  }
  const entries = await db.supportEntry.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    skip: (resolvedPage - 1) * 30,
    take: 31,
    select: { id: true, body: true, staff: true, createdAt: true },
  });
  return { entries: entries.slice(0, 30), more: entries.length > 30, resolvedPage };
}
