import type { PrismaClient } from '../generated/prisma/client';
import { assertLocalProxyEnvironment } from './local-proxy-engine';
import { classifyMessageConversation, type MessageActivity } from './retention-message-preview';

// No retention duration is inferred for an entire table from its name.
const protectedTables = new Set([
  'RetentionProtection',
  'RetentionReviewRequest',
  'RetentionReviewEvent',
  'Bid',
  'Settlement',
  'Dispute',
  'PaymentHold',
  'Transaction',
  'WebhookEvent',
  'AuctionLog',
  'OutboxEvent',
  'LegalRelease',
  'LegalCurrent',
  'LegalDocument',
  'LegalAcceptance',
  'HandoverRevision',
  'MessageReport',
  'ListingReport',
  'SaleReview',
  'ReviewAppeal',
]);
export function inventoryRow(
  table: string,
  count: bigint,
  protectedMessages = 0n,
  candidateMessages = 0n,
) {
  if (
    count < 0n ||
    protectedMessages < 0n ||
    candidateMessages < 0n ||
    protectedMessages + candidateMessages > count ||
    (table !== 'ChatMessage' && candidateMessages !== 0n)
  )
    throw Error('INVALID_COUNT');
  const protectedCount = protectedTables.has(table)
    ? count
    : table === 'ChatMessage'
      ? protectedMessages
      : 0n;
  return {
    table,
    count: count.toString(),
    candidate: candidateMessages.toString(),
    protected: protectedCount.toString(),
    unknown: (count - protectedCount - candidateMessages).toString(),
    reason: protectedTables.has(table)
      ? 'evidence'
      : table === 'ChatMessage'
        ? 'messages'
        : 'undefined',
  };
}
export function inventorySummary(rows: ReturnType<typeof inventoryRow>[]) {
  const sum = (key: 'count' | 'candidate' | 'protected' | 'unknown') =>
    rows.reduce((n, r) => n + BigInt(r[key]), 0n).toString();
  return {
    count: sum('count'),
    candidate: sum('candidate'),
    protected: sum('protected'),
    unknown: sum('unknown'),
  };
}

export async function readRetentionInventory(db: PrismaClient, userId: string) {
  // Reuse the existing explicit local-only, provider-free gate; never scans a remote DB.
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '2000ms'");
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, suspendedAt: true, isSample: true },
      });
      if (!user || user.role !== 'ADMIN' || user.suspendedAt || user.isSample)
        throw Error('FORBIDDEN');
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
      const observedAt = clock.now;
      const tables = await tx.$queryRaw<
        { name: string }[]
      >`SELECT tablename AS name FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
      if (tables.length > 100) throw Error('INVENTORY_TOO_LARGE');
      const rows = [];
      const messageAssessment = { elapsed: 0n, evidence: 0n, notDue: 0n, unknown: 0n };
      for (const { name } of tables) {
        // Identifier comes from catalog, never request input, and is quoted even so.
        const identifier = '"public"."' + name.replaceAll('"', '""') + '"';
        const [r] = await tx.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT COUNT(*) AS count FROM ${identifier}`,
        );
        let protectedMessages = 0n;
        let candidateMessages = 0n;
        if (name === 'ChatMessage') {
          const conversations = await tx.$queryRaw<(MessageActivity & { count: bigint })[]>`
            SELECT c."createdAt", m.count, m."lastMessageAt", a."lastAppointmentAt",
              (EXISTS (SELECT 1 FROM "RetentionProtection" p WHERE p."conversationId"=c.id AND p.status='ACTIVE')
               OR EXISTS (SELECT 1 FROM "ChatMessage" peer JOIN "MessageReport" r ON r."messageId"=peer.id WHERE peer."conversationId"=c.id)
               OR EXISTS (SELECT 1 FROM "Bid" b WHERE b."vehicleId"=c."vehicleId")
               OR EXISTS (SELECT 1 FROM "PaymentHold" h WHERE h."vehicleId"=c."vehicleId")
               OR EXISTS (SELECT 1 FROM "Settlement" s WHERE s."vehicleId"=c."vehicleId")
               OR EXISTS (SELECT 1 FROM "ListingReport" r WHERE r."vehicleId"=c."vehicleId")) AS evidence,
              COALESCE(a.active, false) AS "activeAppointment",
              COALESCE(a.unknown, false) AS "unknownAppointment"
            FROM "Conversation" c
            JOIN LATERAL (SELECT COUNT(*) AS count, MAX("createdAt") AS "lastMessageAt"
              FROM "ChatMessage" WHERE "conversationId"=c.id) m ON m.count>0
            LEFT JOIN LATERAL (SELECT MAX(GREATEST("createdAt","updatedAt")) AS "lastAppointmentAt",
              BOOL_OR(status IN ('PENDING','ACCEPTED')) AS active,
              BOOL_OR(status NOT IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED')) AS unknown
              FROM "Appointment" WHERE "conversationId"=c.id) a ON true
            ORDER BY c.id LIMIT 10001`;
          if (conversations.length > 10000) throw Error('INVENTORY_TOO_LARGE');
          let classifiedCount = 0n;
          for (const conversation of conversations) {
            const result = classifyMessageConversation(conversation, observedAt);
            messageAssessment[result.reason] += conversation.count;
            classifiedCount += conversation.count;
            if (result.state === 'protected') protectedMessages += conversation.count;
            if (result.state === 'candidate') candidateMessages += conversation.count;
          }
          if (classifiedCount !== r.count) throw Error('INVENTORY_INCOMPLETE');
        }
        rows.push(inventoryRow(name, r.count, protectedMessages, candidateMessages));
      }
      return {
        policy: 'PM-26G',
        observedAt: observedAt.toISOString(),
        rows,
        totals: inventorySummary(rows),
        // Files/mailboxes/backups are deliberately not scanned or reported as empty.
        unscanned: ['support', 'logs', 'backups'],
        candidateAssessment: 'message_preview_only',
        messageAssessment: Object.fromEntries(
          Object.entries(messageAssessment).map(([key, value]) => [key, value.toString()]),
        ),
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 15000, maxWait: 2000 },
  );
}

export function retentionGet(db: PrismaClient, requireUser: () => Promise<string>) {
  return async () => {
    const headers = { 'Cache-Control': 'private, no-store' };
    try {
      const id = await requireUser();
      return Response.json(await readRetentionInventory(db, id), { headers });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const status =
        code === 'UNAUTHORIZED'
          ? 401
          : code === 'FORBIDDEN'
            ? 403
            : code === 'LOCAL_PROXY_DISABLED'
              ? 404
              : 503;
      return Response.json(
        { error: status === 503 ? 'INVENTORY_UNAVAILABLE' : code },
        { status, headers },
      );
    }
  };
}
