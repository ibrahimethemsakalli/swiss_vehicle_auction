import { Prisma, type LegalAcceptance } from '../generated/prisma/client';
import { db } from './db';
import {
  acceptanceInput,
  assertPublicationReady,
  draftContent,
  legalHash,
  legalLocales,
  LegalError,
  localLegalDraftAllowed,
  type LegalContent,
  type LegalLocale,
  type LegalKind,
  type LegalProfile,
} from './legal-policy';

type Tx = Prisma.TransactionClient;
// Shared readers do not serialize unrelated bids. Publication takes an exclusive
// lock, so neither an acceptance nor a new action can race a version switch.
export async function lockLegal(tx: Tx, exclusive = false) {
  if (exclusive) await tx.$queryRaw`SELECT pg_advisory_xact_lock(832426003)::text`;
  else await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(832426003)::text`;
}
export async function activeLegal(tx: Tx = db) {
  const pointer = await tx.legalCurrent.findUnique({
    where: { id: 'current' },
    include: { release: { include: { documents: true } } },
  });
  return pointer?.release ?? null;
}
function checkedContent(document: { content: Prisma.JsonValue; contentHash: string }) {
  const content = document.content as unknown as LegalContent;
  if (legalHash(content) !== document.contentHash)
    throw new LegalError('LEGAL_INTEGRITY_ERROR', 503);
  return content;
}
export async function publicLegal(kind: LegalKind, locale: LegalLocale, version?: string) {
  const release = process.env.DATABASE_URL
    ? version
      ? await db.legalRelease.findUnique({ where: { version }, include: { documents: true } })
      : await activeLegal()
    : null;
  if (version && !release) throw new LegalError('LEGAL_NOT_FOUND', 404);
  const document = release?.documents.find((d) => d.kind === kind && d.locale === locale);
  if (release && !document) throw new LegalError('LEGAL_INTEGRITY_ERROR', 503);
  return {
    id: document?.id ?? null,
    releaseId: release?.id ?? null,
    version: release?.version ?? '2026-10-27-draft.1',
    publishedAt: release?.publishedAt.toISOString() ?? null,
    locale,
    kind,
    draft: !release,
    content: document ? checkedContent(document) : draftContent(kind, locale),
    contentHash: document?.contentHash ?? null,
  };
}
export async function legalSummary(locale: LegalLocale = 'de') {
  const current = process.env.DATABASE_URL ? await activeLegal() : null;
  const terms = current?.documents.find((d) => d.kind === 'TERMS' && d.locale === locale);
  if (current && !terms) throw new LegalError('LEGAL_INTEGRITY_ERROR', 503);
  return {
    releaseId: current?.id ?? null,
    version: current?.version ?? null,
    draft: !current,
    localDraft: !current && localLegalDraftAllowed(),
    locale,
    acknowledgements: terms ? checkedContent(terms).acknowledgements : null,
  };
}
export async function recordAcceptance(
  tx: Tx,
  userId: string,
  raw: unknown,
  source: 'REGISTRATION' | 'ACCOUNT',
) {
  const input = acceptanceInput.parse(raw);
  await lockLegal(tx);
  const current = await activeLegal(tx);
  if (!current) throw new LegalError('LEGAL_UNAVAILABLE', 503);
  if (current.id !== input.releaseId) throw new LegalError('LEGAL_VERSION_CHANGED', 409);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { suspendedAt: true, isSample: true },
  });
  if (!user || user.suspendedAt || user.isSample) throw new LegalError('FORBIDDEN', 403);
  const terms = current.documents.find((d) => d.kind === 'TERMS' && d.locale === input.locale);
  const privacy = current.documents.find((d) => d.kind === 'PRIVACY' && d.locale === input.locale);
  if (!terms || !privacy) throw new LegalError('LEGAL_INTEGRITY_ERROR', 503);
  checkedContent(terms);
  checkedContent(privacy);
  await tx.legalAcceptance.createMany({
    skipDuplicates: true,
    data: {
      userId,
      releaseId: current.id,
      termsDocumentId: terms.id,
      privacyDocumentId: privacy.id,
      locale: input.locale,
      source,
      termsAccepted: true,
      privacyAcknowledged: true,
      eligibilityDeclared: true,
    },
  });
  return tx.legalAcceptance.findUniqueOrThrow({
    where: { userId_releaseId: { userId, releaseId: current.id } },
  });
}
export function acceptCurrentLegal(userId: string, raw: unknown) {
  return db.$transaction((tx) => recordAcceptance(tx, userId, raw, 'ACCOUNT'));
}
export async function requireCurrentLegal(
  userId: string,
  tx?: Tx,
): Promise<LegalAcceptance | null> {
  if (!tx) return db.$transaction((inner) => requireCurrentLegal(userId, inner));
  await lockLegal(tx);
  const release = await activeLegal(tx);
  if (!release) {
    if (localLegalDraftAllowed()) return null; // Explicit local testing; no fabricated receipt.
    throw new LegalError('LEGAL_UNAVAILABLE', 503);
  }
  const receipt = await tx.legalAcceptance.findUnique({
    where: { userId_releaseId: { userId, releaseId: release.id } },
  });
  if (!receipt) throw new LegalError('LEGAL_ACCEPTANCE_REQUIRED', 428);
  return receipt;
}
export async function publishLegal(version: string, operator: LegalProfile) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version) || /draft/i.test(version))
    throw new LegalError('LEGAL_INVALID_VERSION', 400);
  assertPublicationReady(operator);
  const snapshots = legalLocales.flatMap((locale) =>
    (['TERMS', 'PRIVACY'] as const).map((kind) => {
      const content = draftContent(kind, locale, operator);
      return {
        kind,
        locale,
        title: content.title,
        content: content as unknown as Prisma.InputJsonValue,
        contentHash: legalHash(content),
      };
    }),
  );
  return db.$transaction(async (tx) => {
    await lockLegal(tx, true);
    let release = await tx.legalRelease.findUnique({
      where: { version },
      include: { documents: true },
    });
    if (release) {
      if (
        release.documents.length !== 8 ||
        snapshots.some(
          (s) =>
            release!.documents.find((d) => d.kind === s.kind && d.locale === s.locale)
              ?.contentHash !== s.contentHash,
        )
      )
        throw new LegalError('LEGAL_VERSION_IMMUTABLE', 409);
    } else
      release = await tx.legalRelease.create({
        data: { version, documents: { create: snapshots } },
        include: { documents: true },
      });
    await tx.legalCurrent.upsert({
      where: { id: 'current' },
      create: { id: 'current', releaseId: release.id },
      update: { releaseId: release.id },
    });
    return { id: release.id, version: release.version };
  });
}
