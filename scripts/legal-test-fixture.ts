import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { legalProfile, profileFields, type LegalProfile } from '../src/lib/legal-policy';
import { publishLegal, acceptCurrentLegal } from '../src/lib/legal';

export function testLegalProfile(): LegalProfile {
  const profile = { ...legalProfile, readyForPublication: true };
  for (const key of profileFields) profile[key] = 'TEST ONLY — not a real business or policy';
  profile.domain = 'https://legal.example.test';
  profile.supportEmail = 'support@example.test';
  profile.privacyEmail = 'privacy@example.test';
  return profile;
}
export async function legalTestFixture() {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw Error('Legal fixtures require isolated _test database');
  const [{ name }] = await db.$queryRaw<
    { name: string }[]
  >`SELECT current_database()::text AS name`;
  if (!name.endsWith('_test')) throw Error('Connected database is not isolated');
  const previous = await db.legalCurrent.findUnique({ where: { id: 'current' } });
  const release = await publishLegal(`test-${randomUUID()}`, testLegalProfile());
  const input = (locale: 'de' | 'fr' | 'it' | 'en' = 'en') => ({
    releaseId: release.id,
    locale,
    termsAccepted: true as const,
    privacyAcknowledged: true as const,
    eligibilityDeclared: true as const,
  });
  return {
    release,
    input,
    accept: (userId: string) => acceptCurrentLegal(userId, input()),
    async cleanup() {
      await db.legalCurrent.deleteMany({ where: { releaseId: release.id } });
      if (previous)
        await db.legalCurrent.upsert({
          where: { id: 'current' },
          create: previous,
          update: { releaseId: previous.releaseId },
        });
      await db.legalDocument.deleteMany({ where: { releaseId: release.id } });
      await db.legalRelease.delete({ where: { id: release.id } });
    },
  };
}
