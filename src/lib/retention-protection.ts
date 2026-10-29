import { z } from 'zod';
import type { PrismaClient, Prisma } from '../generated/prisma/client';
import { assertLocalProxyEnvironment } from './local-proxy-engine';
import { assertSameOrigin } from './mutation';
import {
  runRetentionReview,
  retentionAdmin,
  lockRetentionSources,
  retentionSnapshot,
} from './retention-review';

const note = z.string().trim().min(10).max(1000);
export const protectionCommand = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('create'), conversationId: z.string().uuid(), reason: note })
    .strict(),
  z.object({ action: z.literal('review'), id: z.string().uuid(), note }).strict(),
]);
const query = z
  .object({
    state: z.enum(['pending', 'reviewed', 'active', 'released']).default('active'),
    after: z.string().min(1).max(100).optional(),
    detail: z.string().uuid().optional(),
    history: z.string().uuid().optional(),
    request: z.string().uuid().optional(),
  })
  .strict();
async function admin(tx: Prisma.TransactionClient, id: string) {
  const u = await tx.user.findUnique({
    where: { id },
    select: { role: true, suspendedAt: true, isSample: true },
  });
  if (!u || u.role !== 'ADMIN' || u.suspendedAt || u.isSample) throw Error('FORBIDDEN');
}
export async function protectionQueue(db: PrismaClient, userId: string, input: unknown) {
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  const q = query.parse(input);
  return db.$transaction(async (tx) => {
    await admin(tx, userId);
    if (q.request) {
      const request = await tx.retentionReviewRequest.findUnique({
        where: { id: q.request },
        include: {
          protection: { include: { conversation: { select: { buyerId: true, sellerId: true } } } },
        },
      });
      if (!request) throw Error('NOT_FOUND');
      if (
        [
          request.protection.conversation.buyerId,
          request.protection.conversation.sellerId,
        ].includes(userId)
      )
        throw Error('FORBIDDEN');
      const { protection, ...review } = request;
      const { conversation, ...row } = protection;
      return { rows: [{ ...row, requests: [review] }], viewerId: userId, next: null };
    }
    if (q.history) {
      const cursor = q.after
        ? await tx.retentionReviewEvent.findUnique({ where: { id: q.after } })
        : null;
      if (q.after && (!cursor || cursor.protectionId !== q.history)) throw Error('INVALID_BODY');
      const events = await tx.retentionReviewEvent.findMany({
        where: {
          protectionId: q.history,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 51,
      });
      return { events: events.slice(0, 50), next: events.length > 50 ? events[49].id : null };
    }
    if (q.detail) {
      const p = await tx.retentionProtection.findUnique({ where: { id: q.detail } });
      if (!p) throw Error('NOT_FOUND');
      const snap = await retentionSnapshot(tx, p.conversationId);
      return {
        blocker: snap.blocker,
        canAct: ![snap.c.buyerId, snap.c.sellerId].includes(userId),
        evidence: [
          ...snap.messages
            .filter((m) => !m.hiddenAt)
            .map((m) => ({ type: 'MESSAGE', id: m.id, text: m.body, date: m.createdAt })),
          ...snap.appointments.map((a) => ({
            type: 'APPOINTMENT',
            id: a.id,
            text: a.status + ' · ' + a.location,
            date: a.updatedAt,
          })),
        ],
      };
    }
    const rows = await tx.retentionProtection.findMany({
      where: {
        status: q.state === 'released' ? 'RELEASED' : 'ACTIVE',
        ...(q.state === 'pending'
          ? { reviewedAt: null }
          : q.state === 'reviewed'
            ? { reviewedAt: { not: null } }
            : {}),
        ...(q.after ? { id: { gt: q.after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 51,
      include: { requests: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    });
    return {
      rows: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49].id : null,
      viewerId: userId,
    };
  });
}
export async function protectConversation(db: PrismaClient, userId: string, input: unknown) {
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  if (
    typeof input === 'object' &&
    input !== null &&
    'action' in input &&
    !['create', 'review'].includes(String(input.action))
  )
    return runRetentionReview(db, userId, input);
  const cmd = protectionCommand.parse(input);
  if (cmd.action === 'review') throw Error('LEGACY_REVIEW_DISABLED');
  return db.$transaction(
    async (tx) => {
      await lockRetentionSources(tx);
      await admin(tx, userId);
      if (cmd.action === 'create') {
        if (
          !(await tx.conversation.findUnique({
            where: { id: cmd.conversationId },
            select: { id: true },
          }))
        )
          throw Error('NOT_FOUND');
        const conversation = await tx.conversation.findUniqueOrThrow({
          where: { id: cmd.conversationId },
        });
        await retentionAdmin(tx, userId, conversation);
        const protection = await tx.retentionProtection.create({
          data: { conversationId: cmd.conversationId, reason: cmd.reason, createdById: userId },
        });
        await tx.retentionReviewEvent.create({
          data: {
            protectionId: protection.id,
            actorId: userId,
            kind: 'CREATE',
            payload: { note: cmd.reason },
            commandId: protection.id,
            commandHash: 'create',
          },
        });
        return protection;
      }
    },
    { timeout: 15000, maxWait: 2000 },
  );
}
export function protectionHandlers(db: PrismaClient, authenticate: () => Promise<string>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  async function handle(work: () => Promise<unknown>) {
    try {
      return Response.json(await work(), { headers });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      const duplicate = typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002';
      const status = duplicate
        ? 409
        : ((
            {
              UNAUTHORIZED: 401,
              FORBIDDEN: 403,
              LOCAL_PROXY_DISABLED: 404,
              NOT_FOUND: 404,
              CONFLICT: 409,
              INVALID_BODY: 400,
              INVALID_EVIDENCE: 400,
              SECOND_ADMIN_REQUIRED: 403,
              PARTICIPANT: 403,
              STALE_REVIEW: 409,
              AUTOMATIC_PROTECTION: 409,
              UNCERTAIN: 409,
              INCOMPLETE: 409,
              LEGACY_REVIEW_DISABLED: 409,
            } as Record<string, number>
          )[code] ?? (e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503));
      return Response.json(
        {
          error:
            status === 503
              ? 'PROTECTION_UNAVAILABLE'
              : duplicate
                ? 'CONFLICT'
                : status === 400 && code !== 'INVALID_EVIDENCE'
                  ? 'INVALID_BODY'
                  : code,
        },
        { status, headers },
      );
    }
  }
  return {
    GET: (req: Request) =>
      handle(async () =>
        protectionQueue(
          db,
          await authenticate(),
          Object.fromEntries(new URL(req.url).searchParams),
        ),
      ),
    POST: (req: Request) =>
      handle(async () => {
        assertSameOrigin(req);
        const id = await authenticate();
        const reader = req.body?.getReader();
        if (!reader) throw Error('INVALID_BODY');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const r = await reader.read();
            if (r.done) break;
            size += r.value.length;
            if (size > 8192) {
              await reader.cancel();
              throw Error('INVALID_BODY');
            }
            chunks.push(r.value);
          }
        } finally {
          reader.releaseLock();
        }
        return protectConversation(db, id, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      }),
  };
}
