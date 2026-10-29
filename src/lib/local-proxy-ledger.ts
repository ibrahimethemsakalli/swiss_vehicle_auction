import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { assertLocalProxyEnvironment } from './local-proxy-engine';

type Auction = { id: string; status: string; winnerId: string | null };
type Hold = {
  id: string;
  auctionId: string;
  ownerId: string;
  status: string;
  amountCents: number;
  currency: string;
  gateway: string;
};
type Capture = {
  auctionId: string;
  holdId: string;
  amountCents: number;
  currency: string;
  capturedAt: Date;
};
type Refund = { auctionId: string; amountCents: number; currency: string; refundedAt: Date };
export type LedgerInput = {
  auctions: Auction[];
  holds: Hold[];
  captures: Capture[];
  cases: { auctionId: string; status: string }[];
  refunds: Refund[];
};

// Pure audit: no repair, writes, provider calls, private limits or reasons in the output.
export function auditLocalLedger(input: LedgerInput) {
  const { auctions, holds, captures, cases, refunds } = input;
  const ids = new Set([
    ...auctions.map((a) => a.id),
    ...holds.map((h) => h.auctionId),
    ...captures.map((c) => c.auctionId),
    ...cases.map((c) => c.auctionId),
    ...refunds.map((r) => r.auctionId),
  ]);
  const rows = [...ids].sort().map((auctionId) => {
    const a = auctions.find((a) => a.id === auctionId),
      cs = captures.filter((c) => c.auctionId === auctionId),
      rs = refunds.filter((r) => r.auctionId === auctionId),
      hs = holds.filter((h) => h.auctionId === auctionId),
      rc = cases.find((c) => c.auctionId === auctionId),
      issues = new Set<string>();
    if (!a) issues.add('ORPHAN_RECORD');
    if (a?.status === 'COMPLETED' && !cs.length) issues.add('MISSING_CAPTURE');
    if (cs.length && a?.status !== 'COMPLETED') issues.add('UNEXPECTED_CAPTURE');
    if (cs.length > 1 || cs.some((c) => captures.filter((x) => x.holdId === c.holdId).length > 1))
      issues.add('DUPLICATE_CAPTURE');
    if (hs.filter((h) => h.status === 'CAPTURED').length > 1) issues.add('MULTIPLE_CAPTURED_HOLDS');
    for (const c of cs) {
      if (c.amountCents !== 3000 || c.currency !== 'CHF') issues.add('INVALID_CAPTURE');
      const h = holds.find((h) => h.id === c.holdId);
      if (
        !h ||
        h.auctionId !== auctionId ||
        h.ownerId !== a?.winnerId ||
        h.status !== 'CAPTURED' ||
        h.gateway !== 'local-proxy' ||
        h.amountCents !== c.amountCents ||
        h.currency !== c.currency
      )
        issues.add('CAPTURE_HOLD_MISMATCH');
    }
    if (hs.some((h) => h.status === 'CAPTURED' && !cs.some((c) => c.holdId === h.id)))
      issues.add('UNLINKED_CAPTURED_HOLD');
    if (rc?.status === 'APPROVED' && !rs.length) issues.add('MISSING_REFUND');
    if (rs.length && (rc?.status !== 'APPROVED' || cs.length !== 1))
      issues.add('UNEXPECTED_REFUND');
    if (rs.length > 1) issues.add('DUPLICATE_REFUND');
    if (
      rs.some(
        (r) =>
          r.amountCents !== 3000 ||
          r.currency !== 'CHF' ||
          !cs.some((c) => c.amountCents === r.amountCents && c.currency === r.currency),
      )
    )
      issues.add('INVALID_REFUND');
    return { auctionId, issues: [...issues].sort() };
  });
  const sum = (items: { amountCents: number; currency: string }[]) =>
    items.filter((x) => x.currency === 'CHF').reduce((v, x) => v + BigInt(x.amountCents), 0n);
  const captureTotal = sum(captures),
    refundTotal = sum(refunds);
  const entries = [
    ...captures.map((c) => ({
      auctionId: c.auctionId,
      kind: 'CAPTURE' as const,
      amountCents: c.amountCents,
      currency: c.currency,
      at: c.capturedAt.toISOString(),
    })),
    ...refunds.map((r) => ({
      auctionId: r.auctionId,
      kind: 'REFUND' as const,
      amountCents: r.amountCents,
      currency: r.currency,
      at: r.refundedAt.toISOString(),
    })),
  ].sort(
    (a, b) =>
      b.at.localeCompare(a.at) ||
      a.auctionId.localeCompare(b.auctionId) ||
      a.kind.localeCompare(b.kind),
  );
  return {
    auctionCount: auctions.length,
    captureCount: captures.length,
    refundCount: refunds.length,
    captureCents: captureTotal.toString(),
    refundCents: refundTotal.toString(),
    netCents: (captureTotal - refundTotal).toString(),
    excludedCurrencyCount: [...captures, ...refunds].filter((x) => x.currency !== 'CHF').length,
    issues: rows.filter((r) => r.issues.length),
    entries,
  };
}

export async function readLocalLedger(
  db: PrismaClient,
  authorize: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  return db.$transaction(
    async (tx) => {
      await authorize(tx);
      // Refuse oversized data instead of displaying misleading partial totals.
      const counts = await Promise.all([
        tx.localProxyAuction.count(),
        tx.localProxyHold.count(),
        tx.localProxyCapture.count(),
        tx.localProxyRefundCase.count(),
        tx.localProxyRefund.count(),
      ]);
      if (counts.some((c) => c > 10000)) throw Error('LEDGER_TOO_LARGE');
      const auctions = await tx.localProxyAuction.findMany({
        select: { id: true, status: true, winnerId: true },
      });
      const holds = await tx.localProxyHold.findMany({
        select: {
          id: true,
          auctionId: true,
          ownerId: true,
          status: true,
          amountCents: true,
          currency: true,
          gateway: true,
        },
      });
      const captures = await tx.localProxyCapture.findMany();
      const cases = await tx.localProxyRefundCase.findMany({
        select: { auctionId: true, status: true },
      });
      const refunds = await tx.localProxyRefund.findMany();
      return {
        ...auditLocalLedger({ auctions, holds, captures, cases, refunds }),
        checkedAt: new Date().toISOString(),
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 15000 },
  );
}
