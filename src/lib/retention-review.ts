import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { assertLocalProxyEnvironment } from './local-proxy-engine';
import { classifyMessageConversation } from './retention-message-preview';
import { routeRetentionEvent } from './retention-routing';

const note = z.string().trim().min(10).max(1000);
const evidence = z
  .array(z.object({ type: z.enum(['MESSAGE', 'APPOINTMENT']), id: z.string().uuid() }).strict())
  .min(1)
  .max(5);
const base = { commandId: z.string().uuid() };
export const reviewCommand = z.discriminatedUnion('action', [
  z
    .object({
      ...base,
      action: z.literal('request'),
      id: z.string().uuid(),
      version: z.number().int().positive(),
      reasonCode: z.enum(['NEW_EVIDENCE', 'WRONG_CONVERSATION', 'REASON_CHANGED', 'CASE_CHANGED']),
      note,
      evidence,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('supplement'),
      id: z.string().uuid(),
      version: z.number().int().positive(),
      note,
      evidence,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.enum(['info', 'keep', 'withdraw', 'approve']),
      id: z.string().uuid(),
      version: z.number().int().positive(),
      note,
    })
    .strict(),
]);
export async function retentionAdmin(
  tx: Prisma.TransactionClient,
  id: string,
  conversation?: { buyerId: string; sellerId: string },
) {
  const user = await tx.user.findUnique({
    where: { id },
    select: { role: true, suspendedAt: true, isSample: true },
  });
  if (!user || user.role !== 'ADMIN' || user.suspendedAt || user.isSample) throw Error('FORBIDDEN');
  if (conversation && (conversation.buyerId === id || conversation.sellerId === id))
    throw Error('PARTICIPANT');
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Local-only, bounded critical section: PostgreSQL table locks also cover writers outside this module.
// SHARE conflicts with every INSERT/UPDATE/DELETE on these source tables. No source data is changed here.
export async function lockRetentionSources(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '4000ms'");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(2626007)::text`;
  await tx.$executeRawUnsafe(
    'LOCK TABLE "Appointment", "Bid", "ChatMessage", "Conversation", "Dispute", "ListingReport", "MessageReport", "PaymentHold", "Settlement", "User", "Vehicle" IN SHARE MODE',
  );
}
export async function retentionSnapshot(tx: Prisma.TransactionClient, conversationId: string) {
  const c = await tx.conversation.findUnique({ where: { id: conversationId } });
  if (!c) throw Error('NOT_FOUND');
  const messages = await tx.chatMessage.findMany({
    where: { conversationId },
    orderBy: { id: 'asc' },
    take: 1001,
  });
  const appointments = await tx.appointment.findMany({
    where: { conversationId },
    orderBy: { id: 'asc' },
    take: 1001,
  });
  if (messages.length > 1000 || appointments.length > 1000) throw Error('INCOMPLETE');
  const [bids, holds, sales, reports, messageReports] = await Promise.all([
    tx.bid.count({ where: { vehicleId: c.vehicleId } }),
    tx.paymentHold.count({ where: { vehicleId: c.vehicleId } }),
    tx.settlement.count({ where: { vehicleId: c.vehicleId } }),
    tx.listingReport.count({ where: { vehicleId: c.vehicleId } }),
    tx.messageReport.count({ where: { message: { conversationId } } }),
  ]);
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const latest = (ds: Date[]) =>
    ds.length ? new Date(Math.max(...ds.map((d) => d.getTime()))) : null;
  const classification = classifyMessageConversation(
    {
      createdAt: c.createdAt,
      lastMessageAt: latest(messages.map((m) => m.createdAt)),
      lastAppointmentAt: latest(appointments.flatMap((a) => [a.createdAt, a.updatedAt])),
      evidence: !!(bids || holds || sales || reports || messageReports),
      activeAppointment: appointments.some((a) => ['PENDING', 'ACCEPTED'].includes(a.status)),
      unknownAppointment: appointments.some(
        (a) => !['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'].includes(a.status),
      ),
    },
    clock.now,
  );
  return {
    c,
    messages,
    appointments,
    hash: digest({ c, messages, appointments, bids, holds, sales, reports, messageReports }),
    blocker:
      classification.reason === 'evidence'
        ? 'AUTOMATIC_PROTECTION'
        : classification.state === 'unknown'
          ? 'UNCERTAIN'
          : null,
  };
}
function checkEvidence(
  snapshot: Awaited<ReturnType<typeof retentionSnapshot>>,
  refs: z.infer<typeof evidence>,
) {
  if (new Set(refs.map((r) => r.type + ':' + r.id)).size !== refs.length)
    throw Error('INVALID_EVIDENCE');
  for (const ref of refs) {
    const found =
      ref.type === 'MESSAGE'
        ? snapshot.messages.some((m) => m.id === ref.id && !m.hiddenAt)
        : snapshot.appointments.some((a) => a.id === ref.id);
    if (!found) throw Error('INVALID_EVIDENCE');
  }
}
export async function runRetentionReview(db: PrismaClient, userId: string, input: unknown) {
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  const cmd = reviewCommand.parse(input);
  return db.$transaction(
    async (tx) => {
      await lockRetentionSources(tx);
      await retentionAdmin(tx, userId);
      const hash = digest(cmd);
      const previous = await tx.retentionReviewEvent.findUnique({
        where: { actorId_commandId: { actorId: userId, commandId: cmd.commandId } },
      });
      if (previous) {
        if (previous.commandHash !== hash) throw Error('CONFLICT');
        return { eventId: previous.id, replayed: true };
      }
      let request =
        cmd.action === 'request'
          ? null
          : await tx.retentionReviewRequest.findUnique({ where: { id: cmd.id } });
      if (cmd.action !== 'request' && !request) throw Error('NOT_FOUND');
      const protection = await tx.retentionProtection.findUnique({
        where: { id: request?.protectionId ?? cmd.id },
      });
      if (!protection) throw Error('NOT_FOUND');
      if (protection.status !== 'ACTIVE') throw Error('CONFLICT');
      const c = await tx.conversation.findUniqueOrThrow({
        where: { id: protection.conversationId },
      });
      await retentionAdmin(tx, userId, c);
      let kind: string = cmd.action.toUpperCase();
      let snapshotHash: string | undefined;
      if (cmd.action === 'request') {
        if (cmd.version !== protection.version) throw Error('STALE_REVIEW');
        const snap = await retentionSnapshot(tx, c.id);
        checkEvidence(snap, cmd.evidence);
        snapshotHash = snap.hash;
        request = await tx.retentionReviewRequest.create({
          data: {
            protectionId: protection.id,
            requesterId: userId,
            reasonCode: cmd.reasonCode,
            note: cmd.note,
            evidence: cmd.evidence,
            snapshot: snap.hash,
            protectionVersion: protection.version,
          },
        });
      } else {
        if (
          !request ||
          !['OPEN', 'NEEDS_INFO'].includes(request.status) ||
          request.version !== cmd.version
        )
          throw Error('STALE_REVIEW');
        if (['withdraw', 'supplement'].includes(cmd.action)) {
          if (request.requesterId !== userId) throw Error('FORBIDDEN');
        } else {
          if (request.requesterId === userId) throw Error('SECOND_ADMIN_REQUIRED');
          await retentionAdmin(tx, request.requesterId, c);
        }
        let status = request.status;
        if (cmd.action === 'supplement') {
          const snap = await retentionSnapshot(tx, c.id);
          checkEvidence(snap, cmd.evidence);
          snapshotHash = snap.hash;
          await tx.retentionReviewRequest.update({
            where: { id: request.id },
            data: {
              note: cmd.note,
              evidence: cmd.evidence,
              snapshot: snap.hash,
              protectionVersion: protection.version,
            },
          });
          status = 'OPEN';
        } else if (cmd.action === 'withdraw') status = 'WITHDRAWN';
        else if (cmd.action === 'keep') status = 'KEPT';
        else if (cmd.action === 'info') status = 'NEEDS_INFO';
        else if (cmd.action === 'approve') {
          if (request.status !== 'OPEN') throw Error('STALE_REVIEW');
          const snap = await retentionSnapshot(tx, c.id);
          checkEvidence(snap, evidence.parse(request.evidence));
          if (snap.blocker) throw Error(snap.blocker);
          if (request.protectionVersion !== protection.version || request.snapshot !== snap.hash)
            throw Error('STALE_REVIEW');
          await tx.retentionProtection.update({
            where: { id: protection.id },
            data: { status: 'RELEASED', releasedAt: new Date(), version: { increment: 1 } },
          });
          status = 'RELEASED';
          kind = 'RELEASED';
        }
        await tx.retentionReviewRequest.update({
          where: { id: request.id },
          data: { status, version: { increment: 1 } },
        });
      }
      const event = await tx.retentionReviewEvent.create({
        data: {
          protectionId: protection.id,
          requestId: request!.id,
          actorId: userId,
          kind,
          commandId: cmd.commandId,
          commandHash: hash,
          payload: JSON.parse(
            JSON.stringify({
              command: cmd,
              protectionVersion: protection.version,
              requestVersion: request?.version,
              snapshot: snapshotHash ?? request?.snapshot,
            }),
          ),
        },
      });
      await routeRetentionEvent(tx, event, request!.id);
      return { eventId: event.id, replayed: false };
    },
    { isolationLevel: 'ReadCommitted', timeout: 15000, maxWait: 2000 },
  );
}
