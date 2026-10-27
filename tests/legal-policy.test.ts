import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptanceInput,
  assertPublicationReady,
  canonicalJson,
  draftContent,
  legalHash,
  legalLocales,
  legalProfile,
  localLegalDraftAllowed,
} from '../src/lib/legal-policy';

test('all four draft legal texts and acknowledgement statements are complete', () => {
  for (const locale of legalLocales)
    for (const kind of ['TERMS', 'PRIVACY'] as const) {
      const content = draftContent(kind, locale);
      assert.ok(content.title.length > 3);
      assert.equal(content.sections.length, 6);
      assert.ok(content.sections.every((s) => s.length === 2 && s.every((t) => t.length > 3)));
      assert.equal(Object.keys(content.acknowledgements).length, 3);
      assert.ok(Object.values(content.acknowledgements).every((t) => t.length > 20));
      assert.equal(content.operator.legalName, null);
    }
  assert.equal(legalProfile.minimumAge, 18);
  assert.deepEqual(legalProfile.eligibleCountries, ['CH', 'LI']);
  assert.equal(legalProfile.buyerFeeChf, 30);
  assert.equal(legalProfile.defaultFeeRecipient, 'PLATFORM_OPERATOR');
});
test('incomplete business and retention/refund policies cannot be published', () => {
  assert.throws(() => assertPublicationReady(legalProfile), /LEGAL_PROFILE_INCOMPLETE/);
  assert.throws(
    () => assertPublicationReady({ ...legalProfile, readyForPublication: true }),
    /LEGAL_PROFILE_INCOMPLETE/,
  );
});
test('a receipt requires explicit separate terms, privacy and eligibility assertions', () => {
  const input = {
    releaseId: '11111111-1111-4111-8111-111111111111',
    locale: 'fr',
    termsAccepted: true,
    privacyAcknowledged: true,
    eligibilityDeclared: true,
  };
  assert.equal(acceptanceInput.safeParse(input).success, true);
  for (const key of ['termsAccepted', 'privacyAcknowledged', 'eligibilityDeclared'])
    assert.equal(acceptanceInput.safeParse({ ...input, [key]: false }).success, false);
  assert.equal(acceptanceInput.safeParse({ ...input, userId: 'forged' }).success, false);
  assert.equal(acceptanceInput.safeParse({ ...input, acceptedAt: '2000-01-01' }).success, false);
});
test('canonical hashes survive JSON property reordering and bind the exact checkbox wording', () => {
  const a = draftContent('TERMS', 'en');
  const b = {
    operator: a.operator,
    acknowledgements: a.acknowledgements,
    sections: a.sections,
    title: a.title,
  };
  assert.equal(legalHash(a), legalHash(b));
  assert.equal(legalHash(a), legalHash(JSON.parse(JSON.stringify(a))));
  assert.notEqual(
    legalHash(a),
    legalHash({
      ...a,
      acknowledgements: { ...a.acknowledgements, termsAccepted: 'Changed statement' },
    }),
  );
  assert.ok(canonicalJson(a).length > 100);
});
test('draft testing is restricted to a non-production local origin and database', () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    HOST: process.env.HOST,
  };
  try {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      NEXTAUTH_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://localhost/autoveri',
      HOST: '127.0.0.1',
    });
    assert.equal(localLegalDraftAllowed(), true);
    for (const [key, value] of Object.entries({
      NODE_ENV: 'production',
      NEXTAUTH_URL: 'https://public.example.test',
      DATABASE_URL: 'postgresql://db.example.test/autoveri',
      HOST: '0.0.0.0',
    })) {
      const saved = process.env[key];
      process.env[key] = value;
      assert.equal(localLegalDraftAllowed(), false, key);
      process.env[key] = saved;
    }
  } finally {
    for (const [key, value] of Object.entries(original))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
