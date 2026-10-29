import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().min(1).max(160);
const instant = z.iso.datetime({ precision: 3 });
const integer = z
  .string()
  .regex(/^-?(0|[1-9][0-9]{0,29})$/)
  .refine((v) => v !== '-0');
const scope = z
  .object({
    provider: id,
    merchant: id,
    account: id,
    environment: z.enum(['test', 'live']),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export const manifestSchema = z
  .object({
    version: z.literal(1),
    provenance: z.literal('synthetic'),
    batchId: id,
    scope,
    source: z.enum(['provider', 'bank']),
    from: instant,
    to: instant,
    watermark: instant,
    expectedPages: z.number().int().min(1).max(100),
    expectedEvents: z.number().int().min(0).max(10000),
    openingBalanceMinor: integer.nullable(),
    closingBalanceMinor: integer.nullable(),
  })
  .strict()
  .refine((x) => x.from < x.to, { message: 'INVALID_WINDOW' });
const eventSchema = z
  .object({
    eventId: id,
    economicId: id,
    kind: z.enum([
      'CAPTURE',
      'REFUND',
      'DISPUTE_DEBIT',
      'DISPUTE_CREDIT',
      'FEE',
      'PAYOUT',
      'BANK_CREDIT',
      'BANK_DEBIT',
      'ADJUSTMENT',
    ]),
    occurredAt: instant,
    amountMinor: integer,
    direction: z.enum(['credit', 'debit']),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict()
  .refine((x) => /^[1-9][0-9]{0,29}$/.test(x.amountMinor), { message: 'POSITIVE_AMOUNT_REQUIRED' });
export const pageSchema = z
  .object({
    batchId: id,
    scope,
    number: z.number().int().min(1).max(100),
    cursor: id.nullable(),
    nextCursor: id.nullable(),
    events: z.array(eventSchema).max(1000),
  })
  .strict();
export type EvidenceManifest = z.infer<typeof manifestSchema>;
export type ExternalEvidenceEvent = z.infer<typeof eventSchema>;
type Page = z.infer<typeof pageSchema>;
export const externalEvidenceCodes = [
  'INVALID_MANIFEST',
  'SYNTHETIC_TEST_ONLY',
  'INVALID_PAGE',
  'SCOPE_MISMATCH',
  'PAGE_CONFLICT',
  'PAGE_COUNT',
  'CURSOR_CHAIN',
  'EVENT_CONFLICT',
  'ECONOMIC_DUPLICATE',
  'EVENT_COUNT',
  'WINDOW',
  'WATERMARK',
  'CURRENCY',
  'DIRECTION',
  'SOURCE_KIND',
  'BALANCE_MISSING',
  'BALANCE_MISMATCH',
] as const;
export type EvidenceCode = (typeof externalEvidenceCodes)[number];
export type EvidencePreview = {
  status: 'REJECTED' | 'INCOMPLETE' | 'COMPLETE_SYNTHETIC';
  findings: EvidenceCode[];
  batchId?: string;
  uniquePages: number;
  uniqueEvents: number;
  totals: {
    currency: string;
    creditsMinor: string;
    debitsMinor: string;
    netMinor: string;
    calculatedClosingMinor: string | null;
  } | null;
  /** Internal staging output only; never applied to payment state or treated as authentic bank evidence. */
  stagedEvents: ExternalEvidenceEvent[];
  contentHash: string | null;
  totalsScope: 'COMPLETE_WINDOW' | 'PARTIAL_WINDOW' | null;
  authentic: false;
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
/** Bounded, pure staging contract. No network, DB writes, provider credentials or automatic corrections. */
export function previewSyntheticEvidence(
  rawManifest: unknown,
  rawPages: readonly unknown[],
): EvidencePreview {
  const base: EvidencePreview = {
    status: 'REJECTED',
    findings: [],
    uniquePages: 0,
    uniqueEvents: 0,
    totals: null,
    stagedEvents: [],
    contentHash: null,
    totalsScope: null,
    authentic: false,
  };
  const parsed = manifestSchema.safeParse(rawManifest);
  if (!parsed.success) return { ...base, findings: ['INVALID_MANIFEST'] };
  const manifest = parsed.data;
  if (manifest.scope.environment !== 'test') return { ...base, findings: ['SYNTHETIC_TEST_ONLY'] };
  if (rawPages.length > 200) return { ...base, findings: ['INVALID_PAGE'] };
  const findings = new Set<EvidenceCode>(),
    pages = new Map<number, Page>(),
    events = new Map<string, ExternalEvidenceEvent>(),
    economic = new Map<string, string>();
  for (const raw of rawPages) {
    const p = pageSchema.safeParse(raw);
    if (!p.success) {
      findings.add('INVALID_PAGE');
      continue;
    }
    const page = p.data;
    if (page.batchId !== manifest.batchId || canonical(page.scope) !== canonical(manifest.scope)) {
      findings.add('SCOPE_MISMATCH');
      continue;
    }
    const old = pages.get(page.number);
    if (old) {
      if (canonical(old) !== canonical(page)) findings.add('PAGE_CONFLICT');
      continue;
    }
    pages.set(page.number, page);
  }
  if (
    pages.size !== manifest.expectedPages ||
    [...pages.keys()].some((n) => n > manifest.expectedPages)
  )
    findings.add('PAGE_COUNT');
  const sorted = [...pages.values()].sort((a, b) => a.number - b.number),
    cursors = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const page = sorted[i],
      previous = sorted[i - 1];
    if (
      page.number !== i + 1 ||
      (i === 0 ? page.cursor !== null : page.cursor !== previous.nextCursor || page.cursor === null)
    )
      findings.add('CURSOR_CHAIN');
    if (page.nextCursor !== null) {
      if (cursors.has(page.nextCursor)) findings.add('CURSOR_CHAIN');
      cursors.add(page.nextCursor);
    }
    if (
      page.number === manifest.expectedPages ? page.nextCursor !== null : page.nextCursor === null
    )
      findings.add('CURSOR_CHAIN');
    for (const event of page.events) {
      if (event.occurredAt < manifest.from || event.occurredAt >= manifest.to)
        findings.add('WINDOW');
      if (event.currency !== manifest.scope.currency) findings.add('CURRENCY');
      const bank = event.kind === 'BANK_CREDIT' || event.kind === 'BANK_DEBIT';
      if (manifest.source === 'bank' ? !bank && event.kind !== 'ADJUSTMENT' : bank)
        findings.add('SOURCE_KIND');
      const expected = ['CAPTURE', 'DISPUTE_CREDIT', 'BANK_CREDIT'].includes(event.kind)
        ? 'credit'
        : event.kind === 'ADJUSTMENT'
          ? event.direction
          : 'debit';
      if (event.direction !== expected) findings.add('DIRECTION');
      const old = events.get(event.eventId);
      if (old) {
        if (canonical(old) !== canonical(event)) findings.add('EVENT_CONFLICT');
        continue;
      }
      if (economic.has(event.economicId) && economic.get(event.economicId) !== event.eventId)
        findings.add('ECONOMIC_DUPLICATE');
      economic.set(event.economicId, event.eventId);
      events.set(event.eventId, event);
    }
  }
  if (events.size !== manifest.expectedEvents) findings.add('EVENT_COUNT');
  if (manifest.watermark < manifest.to) findings.add('WATERMARK');
  if (manifest.openingBalanceMinor === null || manifest.closingBalanceMinor === null)
    findings.add('BALANCE_MISSING');
  const malformed = [...findings].some((x) =>
    [
      'INVALID_PAGE',
      'SCOPE_MISMATCH',
      'PAGE_CONFLICT',
      'EVENT_CONFLICT',
      'ECONOMIC_DUPLICATE',
      'WINDOW',
      'CURRENCY',
      'DIRECTION',
      'SOURCE_KIND',
    ].includes(x),
  );
  const coverageComplete = !['PAGE_COUNT', 'CURSOR_CHAIN', 'EVENT_COUNT', 'WATERMARK'].some(
    (code) => findings.has(code as EvidenceCode),
  );
  let totals: EvidencePreview['totals'] = null;
  if (!malformed) {
    let credits = 0n,
      debits = 0n;
    for (const e of events.values()) {
      if (e.direction === 'credit') credits += BigInt(e.amountMinor);
      else debits += BigInt(e.amountMinor);
    }
    const net = credits - debits,
      closing =
        manifest.openingBalanceMinor === null ? null : BigInt(manifest.openingBalanceMinor) + net;
    totals = {
      currency: manifest.scope.currency,
      creditsMinor: String(credits),
      debitsMinor: String(debits),
      netMinor: String(net),
      calculatedClosingMinor: closing === null ? null : String(closing),
    };
    if (
      coverageComplete &&
      closing !== null &&
      manifest.closingBalanceMinor !== null &&
      closing !== BigInt(manifest.closingBalanceMinor)
    )
      findings.add('BALANCE_MISMATCH');
  }
  const complete = findings.size === 0;
  const normalized = [...events.values()].sort((a, b) =>
    a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0,
  );
  return {
    ...base,
    batchId: manifest.batchId,
    status: malformed ? 'REJECTED' : complete ? 'COMPLETE_SYNTHETIC' : 'INCOMPLETE',
    findings: [...findings],
    uniquePages: pages.size,
    uniqueEvents: events.size,
    totals,
    totalsScope: totals ? (coverageComplete ? 'COMPLETE_WINDOW' : 'PARTIAL_WINDOW') : null,
    stagedEvents: complete ? normalized : [],
    contentHash: complete
      ? createHash('sha256')
          .update(canonical({ manifest, events: normalized }))
          .digest('hex')
      : null,
  };
}
