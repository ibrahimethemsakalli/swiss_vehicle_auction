import { createHash } from 'node:crypto';
import { z } from 'zod';
import profile from '../data/legal-profile.json';
import copy from '../data/legal-copy.json';
import de from '../messages/de.json';
import fr from '../messages/fr.json';
import it from '../messages/it.json';
import en from '../messages/en.json';

export const legalLocales = ['de', 'fr', 'it', 'en'] as const;
export type LegalLocale = (typeof legalLocales)[number];
export type LegalKind = 'TERMS' | 'PRIVACY';
export const profileFields = [
  'legalName',
  'legalForm',
  'address',
  'country',
  'registryId',
  'domain',
  'supportEmail',
  'privacyEmail',
  'phone',
  'hostingAndCountry',
  'databaseAndCountry',
  'storageAndCountry',
  'paymentProviderAndCountry',
  'smsProviderAndCountry',
  'emailProviderAndCountry',
  'analyticsPolicy',
  'retentionPolicy',
  'supportAndRefundPolicy',
] as const;
export type LegalProfile = Omit<typeof profile, (typeof profileFields)[number]> &
  Record<(typeof profileFields)[number], string | null>;
export type LegalContent = {
  title: string;
  sections: string[][];
  operator: LegalProfile;
  acknowledgements: {
    termsAccepted: string;
    privacyAcknowledged: string;
    eligibilityDeclared: string;
  };
};
export const legalProfile: LegalProfile = profile;
export const acceptanceInput = z
  .object({
    releaseId: z.uuid(),
    locale: z.enum(legalLocales),
    termsAccepted: z.literal(true),
    privacyAcknowledged: z.literal(true),
    eligibilityDeclared: z.literal(true),
  })
  .strict();
export type AcceptanceInput = z.infer<typeof acceptanceInput>;
export class LegalError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export function draftContent(
  kind: LegalKind,
  locale: LegalLocale,
  operator = legalProfile,
): LegalContent {
  const messages = { de, fr, it, en }[locale];
  return {
    ...copy[locale][kind === 'TERMS' ? 'terms' : 'privacy'],
    operator,
    acknowledgements: {
      termsAccepted: messages.legalAcceptTerms,
      privacyAcknowledged: messages.legalAcknowledgePrivacy,
      eligibilityDeclared: messages.legalEligibility,
    },
  };
}
// JSON property order is canonicalized so hashes survive JSONB round trips.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function legalHash(content: LegalContent) {
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}
export function assertPublicationReady(operator: LegalProfile) {
  const missing = profileFields.filter(
    (k) => !['phone', 'registryId'].includes(k) && !operator[k]?.trim(),
  );
  if (
    !operator.readyForPublication ||
    missing.length ||
    operator.minimumAge !== 18 ||
    operator.buyerFeeChf !== 30 ||
    operator.defaultFeeRecipient !== 'PLATFORM_OPERATOR' ||
    operator.eligibleCountries.join(',') !== 'CH,LI'
  )
    throw new LegalError('LEGAL_PROFILE_INCOMPLETE', 409);
  if (
    !z.email().safeParse(operator.supportEmail).success ||
    !z.email().safeParse(operator.privacyEmail).success ||
    !/^https:\/\//.test(operator.domain!)
  )
    throw new LegalError('LEGAL_PROFILE_INCOMPLETE', 409);
}
export function localLegalDraftAllowed() {
  try {
    const origin = new URL(process.env.NEXTAUTH_URL ?? '');
    const database = new URL(process.env.DATABASE_URL ?? '');
    const local = ['localhost', '127.0.0.1', '[::1]'];
    return (
      process.env.NODE_ENV !== 'production' &&
      origin.protocol === 'http:' &&
      local.includes(process.env.HOST ?? '127.0.0.1') &&
      local.includes(origin.hostname) &&
      local.includes(database.hostname) &&
      (database.pathname === '/autoveri' || database.pathname.endsWith('_test'))
    );
  } catch {
    return false;
  }
}
