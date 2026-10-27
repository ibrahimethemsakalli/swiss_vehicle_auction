import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { encode } from 'next-auth/jwt';

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '');
  if (
    !process.env.TEST_DATABASE_URL &&
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.pathname === '/autoveri'
  )
    url.pathname = '/autoveri_test';
  if (!url.pathname.endsWith('_test')) throw Error('Isolated _test database required');
  process.env.DATABASE_URL = url.toString();
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, stdio: 'pipe' },
  );
  if (migration.status !== 0) throw Error('Legal test migrations failed');
  const { db } = await import('../src/lib/db');
  const { publishLegal, publicLegal, acceptCurrentLegal, requireCurrentLegal, legalSummary } =
    await import('../src/lib/legal');
  const { legalProfile } = await import('../src/lib/legal-policy');
  const { testLegalProfile } = await import('./legal-test-fixture');
  const { register } = await import('../src/lib/registration');
  const { createVehicle } = await import('../src/lib/vehicles');
  const { placeBid } = await import('../src/lib/bidding');
  const { makeOffer } = await import('../src/lib/offers');
  const { createHold } = await import('../src/lib/payments');
  const original = await db.legalCurrent.findUnique({ where: { id: 'current' } });
  const originalMode = process.env.NODE_ENV;
  const run = randomUUID();
  const users: string[] = [],
    releases: string[] = [];
  let server: ChildProcess | undefined,
    groups = 0;
  const ack = (releaseId: string, locale: 'de' | 'fr' | 'it' | 'en' = 'en') => ({
    releaseId,
    locale,
    termsAccepted: true as const,
    privacyAcknowledged: true as const,
    eligibilityDeclared: true as const,
  });
  const account = (suffix: string) => ({
    email: `${run}-${suffix}@legal.test`,
    phone: `+417${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    password: 'Local-legal-test-password-123!',
    language: 'en' as const,
    role: 'PRIVATE_USER' as const,
  });
  const pass = (label: string) => {
    groups++;
    console.log('PASS ' + label);
  };
  try {
    await db.legalCurrent.deleteMany({ where: { id: 'current' } });
    const draft = await publicLegal('TERMS', 'en');
    assert.equal(draft.draft, true);
    assert.equal(draft.content.operator.legalName, null);
    await assert.rejects(
      () => publishLegal(`test-${run}`, legalProfile),
      /LEGAL_PROFILE_INCOMPLETE/,
    );
    for (const suffix of ['a', 'b']) {
      const id = randomUUID();
      users.push(id);
      await db.user.create({
        data: {
          id,
          email: `${run}-${suffix}@legal.test`,
          phone: `LEGAL-${id}`,
          passwordHash: 'not-a-login-hash',
          isIdentityVerified: true,
          phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(),
        },
      });
    }
    const [a, b] = users;
    await assert.rejects(() => acceptCurrentLegal(a, ack(randomUUID())), /LEGAL_UNAVAILABLE/);
    assert.equal(await db.legalAcceptance.count({ where: { userId: a } }), 0);
    Object.assign(process.env, { NODE_ENV: 'production' });
    await assert.rejects(() => requireCurrentLegal(a), /LEGAL_UNAVAILABLE/);
    if (originalMode === undefined)
      delete (process.env as Record<string, string | undefined>)['NODE_ENV'];
    else Object.assign(process.env, { NODE_ENV: originalMode });
    pass('draft publication/acceptance blocked; production has no draft bypass');

    const operator = testLegalProfile();
    const first = await publishLegal(`test-a-${run}`, operator);
    releases.push(first.id);
    const docs = await db.legalDocument.findMany({ where: { releaseId: first.id } });
    assert.equal(docs.length, 8);
    const old = await publicLegal('TERMS', 'en', first.version);
    assert.equal(old.draft, false);
    await assert.rejects(
      () => publishLegal(first.version, { ...operator, address: 'TEST ONLY changed' }),
      /LEGAL_VERSION_IMMUTABLE/,
    );
    await assert.rejects(
      () => db.legalDocument.update({ where: { id: docs[0].id }, data: { title: 'rewritten' } }),
      /immutable/i,
    );
    assert.equal((await publicLegal('TERMS', 'en', first.version)).contentHash, old.contentHash);
    pass('eight published snapshots, canonical hashes and immutable document versions');

    const [one, two] = await Promise.all([
      acceptCurrentLegal(a, ack(first.id)),
      acceptCurrentLegal(a, ack(first.id)),
    ]);
    assert.equal(one.id, two.id);
    assert.equal(await db.legalAcceptance.count({ where: { userId: a } }), 1);
    const repeated = await acceptCurrentLegal(a, ack(first.id, 'fr'));
    assert.equal(repeated.locale, 'en');
    assert.equal(repeated.acceptedAt.getTime(), one.acceptedAt.getTime());
    await assert.rejects(
      () => db.legalAcceptance.update({ where: { id: one.id }, data: { locale: 'fr' } }),
      /immutable/i,
    );
    await assert.rejects(
      () =>
        db.legalAcceptance.create({
          data: {
            userId: b,
            releaseId: first.id,
            termsDocumentId: one.termsDocumentId,
            privacyDocumentId: one.privacyDocumentId,
            locale: 'fr',
            source: 'ACCOUNT',
            termsAccepted: true,
            privacyAcknowledged: true,
            eligibilityDeclared: true,
          },
        }),
      /mismatch/i,
    );
    assert.equal((await requireCurrentLegal(a))!.id, one.id);
    pass('concurrent idempotent acceptance, preserved first language/time, receipt integrity');

    const noConsent = account('missing');
    await assert.rejects(() => register(noConsent), /LEGAL_ACCEPTANCE_REQUIRED/);
    assert.equal(await db.user.count({ where: { email: noConsent.email } }), 0);
    const mismatched = account('language');
    await assert.rejects(
      () => register({ ...mismatched, legal: ack(first.id, 'fr') }),
      /LEGAL_LOCALE_MISMATCH/,
    );
    const data = account('registered');
    const registered = await register({ ...data, legal: ack(first.id) });
    users.push(registered.id);
    const registrationReceipt = await db.legalAcceptance.findUniqueOrThrow({
      where: { userId_releaseId: { userId: registered.id, releaseId: first.id } },
    });
    assert.equal(registrationReceipt.source, 'REGISTRATION');
    pass('registration requires separate assertions and atomically saves its receipt');

    const second = await publishLegal(`test-b-${run}`, {
      ...operator,
      address: 'TEST ONLY next version',
    });
    releases.push(second.id);
    await assert.rejects(() => acceptCurrentLegal(a, ack(first.id)), /LEGAL_VERSION_CHANGED/);
    await assert.rejects(() => requireCurrentLegal(a), /LEGAL_ACCEPTANCE_REQUIRED/);
    assert.equal((await publicLegal('TERMS', 'en', first.version)).contentHash, old.contentHash);
    assert.equal((await legalSummary('fr')).locale, 'fr');
    const staleRegistration = account('stale');
    await assert.rejects(
      () => register({ ...staleRegistration, legal: ack(first.id) }),
      /LEGAL_VERSION_CHANGED/,
    );
    assert.equal(await db.user.count({ where: { email: staleRegistration.email } }), 0);
    pass(
      'version changes require new acceptance; archives remain readable; stale registration rolls back',
    );

    let providerCalls = 0;
    const gateway = {
      retrieve: async () => {
        providerCalls++;
        throw Error('Provider must not run');
      },
      create: async () => {
        providerCalls++;
        throw Error('Provider must not run');
      },
    } as unknown as import('../src/lib/payments').PaymentGateway;
    const bid = {
      vehicleId: randomUUID(),
      holdId: randomUUID(),
      requestId: randomUUID(),
      amount: '1000',
    };
    await assert.rejects(() => placeBid(a, bid, gateway), /LEGAL_ACCEPTANCE_REQUIRED/);
    await assert.rejects(() => makeOffer(a, bid, gateway), /LEGAL_ACCEPTANCE_REQUIRED/);
    await assert.rejects(
      () => createHold(a, bid.vehicleId, undefined, gateway),
      /LEGAL_ACCEPTANCE_REQUIRED/,
    );
    await assert.rejects(
      () =>
        createVehicle(a, {
          stammnummer: '123456789',
          vinChassis: 'WBA11111111111111',
          firstRegistration: '2020-01-01',
          make: 'TEST ONLY',
          model: 'Legal guard',
          mileage: 1,
          canton: 'ZH',
          mfkDate: '2025-01-01',
          serviceHistory: 'NONE',
          tireCondition: 'Test',
          description: 'Legal guard only',
          images: [`/api/uploads/${randomUUID()}.jpg`],
          listingType: 'AUCTION_7_DAYS',
          startPrice: '1000',
        }),
      /LEGAL_ACCEPTANCE_REQUIRED/,
    );
    assert.equal(providerCalls, 0);
    assert.equal(await db.bid.count({ where: { userId: a } }), 0);
    assert.equal(await db.vehicle.count({ where: { userId: a } }), 0);
    pass('new-operation consent guards stop before bidding, listing creation or any provider call');

    const origin = 'http://127.0.0.1:3103',
      secret = randomBytes(48).toString('hex');
    server = spawn(process.execPath, ['scripts/legal-test-server.mjs'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXTAUTH_URL: origin,
        NEXTAUTH_SECRET: secret,
        STRIPE_SECRET_KEY: '',
        TWILIO_AUTH_TOKEN: '',
      },
    });
    server.stdout?.resume();
    server.stderr?.resume();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Legal HTTP host timeout')), 60000);
      server!.once('message', () => {
        clearTimeout(timer);
        resolve();
      });
      server!.once('exit', () => {
        clearTimeout(timer);
        reject(Error('Legal HTTP host exited'));
      });
    });
    const cookie = async (userId: string) =>
      `next-auth.session-token=${await encode({ secret, token: { sub: userId, authVersion: 0 }, maxAge: 600 })}`;
    const aCookie = await cookie(a),
      bCookie = await cookie(b);
    const post = (body: unknown, cookie: string, originHeader = true): RequestInit => ({
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        ...(originHeader ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
    assert.equal((await fetch(origin + '/api/legal/acceptances')).status, 401);
    assert.equal(
      (await fetch(origin + '/api/legal/acceptances', post(ack(second.id), aCookie, false))).status,
      403,
    );
    assert.equal(
      (
        await fetch(
          origin + '/api/legal/acceptances',
          post({ ...ack(second.id), userId: b }, aCookie),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(
          origin + '/api/legal/acceptances',
          post({ ...ack(second.id), termsAccepted: false }, aCookie),
        )
      ).status,
      400,
    );
    assert.equal(
      (await fetch(origin + '/api/legal/acceptances', post(ack(first.id), aCookie))).status,
      409,
    );
    assert.equal(
      (await fetch(origin + '/api/legal/acceptances', post(ack(second.id), aCookie))).status,
      200,
    );
    const own = await fetch(origin + '/api/legal/acceptances?lang=fr&userId=' + a, {
      headers: { Cookie: bCookie },
    });
    assert.equal(own.status, 200);
    assert.match(own.headers.get('cache-control')!, /no-store/);
    assert.equal((await own.json()).receipts.length, 0);
    const ownA = await (
      await fetch(origin + '/api/legal/acceptances?lang=en', { headers: { Cookie: aCookie } })
    ).json();
    assert.equal(ownA.receipts.length, 2);
    assert.ok(
      ownA.receipts.every((r: { termsHash: string }) => /^[a-f0-9]{64}$/.test(r.termsHash)),
    );
    const summary = await (await fetch(origin + '/api/legal?lang=fr')).json();
    assert.equal(
      summary.acknowledgements.termsAccepted,
      (await publicLegal('TERMS', 'fr')).content.acknowledgements.termsAccepted,
    );
    assert.equal(
      (await fetch(origin + '/api/legal/documents?kind=TERMS&lang=en&version=does-not-exist'))
        .status,
      404,
    );
    const archived = await (
      await fetch(origin + `/api/legal/documents?kind=TERMS&lang=en&version=${first.version}`)
    ).json();
    assert.equal(archived.contentHash, old.contentHash);
    pass(
      'HTTP own-only history, origin/auth guards, explicit assertions, current-version check and archived hashes',
    );
    console.log(
      `${groups} legal integration groups passed; no auction, sale, payment or gallery workflow replayed.`,
    );
  } finally {
    if (originalMode === undefined)
      delete (process.env as Record<string, string | undefined>)['NODE_ENV'];
    else Object.assign(process.env, { NODE_ENV: originalMode });
    if (server) {
      server.kill();
      await new Promise<void>((resolve) => {
        if (server!.exitCode !== null) resolve();
        else {
          server!.once('exit', () => resolve());
          setTimeout(resolve, 5000).unref();
        }
      });
    }
    await db.legalAcceptance.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.legalCurrent.deleteMany({ where: { releaseId: { in: releases } } });
    if (original)
      await db.legalCurrent.upsert({
        where: { id: 'current' },
        create: original,
        update: { releaseId: original.releaseId },
      });
    await db.legalDocument.deleteMany({ where: { releaseId: { in: releases } } });
    await db.legalRelease.deleteMany({ where: { id: { in: releases } } });
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Legal tests failed');
  process.exitCode = 1;
});
