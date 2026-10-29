import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '../generated/prisma/client';
import { cantons } from './market-types';
import { parseDealerCsv } from './dealer-csv';
type Tx = Prisma.TransactionClient;
export const dealerCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('profile'),
      version: z.number().int().min(0),
      name: z.string().trim().min(2).max(120),
      canton: z.string().refine((v) => cantons.includes(v)),
      city: z.string().trim().min(1).max(80),
      postalCode: z.string().regex(/^\d{4}$/),
      description: z.string().trim().max(1500),
      published: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('preview'), csv: z.string().max(256000) }).strict(),
  z
    .object({
      action: z.literal('import'),
      csv: z.string().max(256000),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      requestId: z.uuid(),
    })
    .strict(),
]);
async function dealer(tx: Tx, id: string) {
  const u = await tx.user.findUnique({
    where: { id },
    select: {
      role: true,
      isSample: true,
      suspendedAt: true,
      isIdentityVerified: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      companyName: true,
      handelsregisterNr: true,
    },
  });
  if (!u || u.role !== 'DEALER' || u.isSample || u.suspendedAt) throw Error('FORBIDDEN');
  if (!u.isIdentityVerified || !u.emailVerifiedAt || !u.phoneVerifiedAt || !u.handelsregisterNr)
    throw Error('VERIFICATION_REQUIRED');
  return u;
}
export async function readDealerWorkspace(db: PrismaClient, id: string) {
  const user = await dealer(db, id);
  const profile = await db.dealerProfile.findUnique({ where: { userId: id } });
  const drafts = await db.listingDraft.count({ where: { ownerId: id, status: 'DRAFT' } });
  return { profile, companyName: user.companyName ?? '', remaining: Math.max(0, 20 - drafts) };
}
async function preview(tx: Tx, id: string, csv: string) {
  const rows = parseDealerCsv(csv);
  const vins = rows.map((r) => r.payload.draft.vinChassis).filter((v): v is string => !!v);
  const existing = await tx.vehicle.findMany({
    where: { vinChassis: { in: vins } },
    select: { vinChassis: true },
  });
  const drafts = await tx.listingDraft.findMany({
    where: { ownerId: id, status: 'DRAFT' },
    select: { payload: true },
  });
  const used = new Set(existing.map((v) => v.vinChassis));
  for (const d of drafts) {
    const v = (d.payload as { draft?: { vinChassis?: string } }).draft?.vinChassis;
    if (v) used.add(v);
  }
  for (const row of rows)
    if (used.has(row.payload.draft.vinChassis ?? ''))
      row.issues.push({ row: row.row, field: 'vinChassis', code: 'duplicate' });
  return {
    hash: createHash('sha256').update(csv).digest('hex'),
    remaining: Math.max(0, 20 - drafts.length),
    rows,
  };
}
export async function changeDealer(db: PrismaClient, id: string, raw: unknown) {
  const input = dealerCommand.parse(raw);
  if (input.action === 'preview') {
    await dealer(db, id);
    return preview(db, id, input.csv);
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`;
    await dealer(tx, id);
    if (input.action === 'profile') {
      const old = await tx.dealerProfile.findUnique({ where: { userId: id } });
      if ((old?.version ?? 0) !== input.version) throw Error('CONFLICT');
      const { action, version, ...data } = input;
      return old
        ? tx.dealerProfile.update({
            where: { userId: id },
            data: { ...data, version: { increment: 1 } },
          })
        : tx.dealerProfile.create({ data: { userId: id, ...data } });
    }
    const hash = createHash('sha256').update(input.csv).digest('hex');
    if (hash !== input.hash) throw Error('PREVIEW_CHANGED');
    const previous = await tx.dealerImport.findUnique({
      where: { userId_requestId: { userId: id, requestId: input.requestId } },
    });
    if (previous) {
      if (previous.contentHash !== hash) throw Error('CONFLICT');
      return { draftIds: previous.draftIds };
    }
    const checked = await preview(tx, id, input.csv);
    if (checked.rows.some((r) => r.issues.length)) throw Error('CSV_ERRORS');
    if (checked.rows.length > checked.remaining) throw Error('DRAFT_QUOTA');
    const draftIds: string[] = [];
    for (const row of checked.rows) {
      const draftId = randomUUID();
      await tx.listingDraft.create({
        data: { id: draftId, ownerId: id, payload: row.payload, step: 1 },
      });
      draftIds.push(draftId);
    }
    await tx.dealerImport.create({
      data: { userId: id, requestId: input.requestId, contentHash: hash, draftIds },
    });
    return { draftIds };
  });
}
export async function publicDealer(db: PrismaClient, id: string, page: number) {
  z.uuid().parse(id);
  z.number().int().min(1).max(100000).parse(page);
  const profile = await db.dealerProfile.findFirst({
    where: {
      userId: id,
      published: true,
      user: {
        role: 'DEALER',
        isSample: false,
        suspendedAt: null,
        isIdentityVerified: true,
        emailVerifiedAt: { not: null },
        phoneVerifiedAt: { not: null },
        handelsregisterNr: { not: null },
      },
    },
    select: { name: true, canton: true, city: true, postalCode: true, description: true },
  });
  if (!profile) throw Error('NOT_FOUND');
  const where: Prisma.VehicleWhereInput = {
    userId: id,
    status: 'ACTIVE',
    isSample: false,
    NOT: { settlement: { status: 'CANCELLED' } },
    OR: [
      { listingType: 'FIXED_PRICE_OFFERS' },
      { listingType: 'AUCTION_7_DAYS', auctionEndsAt: { gt: new Date() } },
    ],
  };
  const [total, vehicles] = await db.$transaction([
    db.vehicle.count({ where }),
    db.vehicle.findMany({
      where,
      select: { id: true, make: true, model: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 12,
      skip: (page - 1) * 12,
    }),
  ]);
  return { profile, total, page, vehicles };
}
