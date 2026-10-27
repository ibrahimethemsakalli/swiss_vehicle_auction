import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { hash, compare } from 'bcryptjs';
import { spawnSync } from 'node:child_process';
import type { ChallengePurpose } from '../src/lib/account-challenges';

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  if (url.pathname === '/autoveri') url.pathname = '/autoveri_test';
  assert.ok(url.pathname.endsWith('_test'));
  process.env.DATABASE_URL = url.toString();
  Object.assign(process.env, { NODE_ENV: 'development' });
  process.env.NEXTAUTH_URL = 'http://127.0.0.1:3110';
  process.env.HOST = '127.0.0.1';
  process.env.LOCAL_TEST_MESSAGES = 'true';
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, stdio: 'pipe' },
  );
  assert.equal(migration.status, 0, 'Test database migration');
  const { db } = await import('../src/lib/db');
  const service = await import('../src/lib/account-challenges');
  const { registrationInput } = await import('../src/lib/registration');
  const { authOptions } = await import('../src/lib/auth');
  const users: string[] = [],
    files: string[] = [];
  let groups = 0;
  const pass = (s: string) => {
    console.log(`PASS: ${s}`);
    groups++;
  };
  const password = 'Isolated-test-password-123!';
  async function account(role: 'ADMIN' | 'PRIVATE_USER') {
    const suffix = randomUUID();
    const user = await db.user.create({
      data: {
        email: `${suffix}@account.test`,
        phone: suffix,
        passwordHash: await hash(password, 4),
        role,
      },
    });
    users.push(user.id);
    return user;
  }
  async function issue(id: string, purpose: ChallengePurpose, recipient: string) {
    const key = await service.issueChallenge(id, purpose, recipient);
    const file = `.local/messages/${key}.json`;
    files.push(file);
    return JSON.parse(await readFile(file, 'utf8')).token as string;
  }
  try {
    const user = await account('PRIVATE_USER'),
      other = await account('PRIVATE_USER'),
      admin = await account('ADMIN');
    for (const phone of ['+41791234567', '+4236612345'])
      assert.ok(
        registrationInput.safeParse({
          email: 'user@example.test',
          password,
          phone,
          role: 'PRIVATE_USER',
          language: 'en',
        }).success,
      );
    for (const phone of ['+423123', '+4230612345', '+49791234567', '+41012345678'])
      assert.equal(service.phonePattern.test(phone), false);
    pass('CH / LI registration numbers and invalid formats');
    assert.ok(service.localMessagesEnabled());
    for (const [key, value] of [
      ['NODE_ENV', 'production'],
      ['HOST', '0.0.0.0'],
      ['NEXTAUTH_URL', 'https://example.com'],
      ['LOCAL_TEST_MESSAGES', 'false'],
    ] as const) {
      const old = process.env[key];
      Object.assign(process.env, { [key]: value });
      assert.equal(service.localMessagesEnabled(), false);
      Object.assign(process.env, { [key]: old });
    }
    pass('Local delivery denied in production, remote origin and public binding');
    const emailToken = await issue(user.id, 'EMAIL', user.email);
    await assert.rejects(service.verifyEmail(other.id, emailToken));
    await assert.rejects(service.consumeChallenge(user.id, 'RESET', emailToken));
    await service.verifyEmail(user.id, emailToken);
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt);
    await assert.rejects(service.verifyEmail(user.id, emailToken));
    pass('Email verification: account/purpose binding and single use');
    const expired = await issue(other.id, 'EMAIL', other.email);
    await db.$executeRaw`UPDATE "AccountChallenge" SET "expiresAt"=NOW()-INTERVAL '1 second' WHERE "userId"=${other.id}`;
    await assert.rejects(service.verifyEmail(other.id, expired));
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: other.id } })).emailVerifiedAt,
      null,
    );
    pass('Expired token cannot verify');
    const reset = await issue(user.id, 'RESET', user.email);
    await assert.rejects(service.resetByEmail(user.email, reset, 'short'));
    const replacement = password + '-new';
    await service.resetByEmail(user.email, reset, replacement);
    const changed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(changed.authVersion, 1);
    assert.ok(await compare(replacement, changed.passwordHash));
    await assert.rejects(service.resetByEmail(user.email, reset, password));
    pass('Email password reset: password policy, session revocation and replay rejection');
    const provider = authOptions.providers[0] as unknown as {
      options: { authorize: (c: Record<string, string>) => Promise<unknown> };
    };
    const authorize = provider.options.authorize;
    assert.equal(await authorize({ email: admin.email, password }), null);
    const code = await issue(admin.id, 'ADMIN', admin.email);
    assert.equal(await authorize({ email: admin.email, password, code: 'wrong' }), null);
    assert.equal(await authorize({ email: admin.email, password: 'incorrect', code }), null);
    assert.ok(await authorize({ email: admin.email, password, code }));
    assert.equal(await authorize({ email: admin.email, password, code }), null);
    const jwt = authOptions.callbacks!.jwt!;
    const rejected = await jwt({ token: { sub: admin.id, authVersion: 0 } } as never);
    assert.equal(rejected.sub, undefined);
    pass('Admin: password plus one-time code mandatory; old sessions rejected');
    const sms = await issue(other.id, 'SMS', other.phone);
    await service.consumeChallenge(other.id, 'SMS', sms);
    await assert.rejects(service.consumeChallenge(other.id, 'SMS', sms));
    pass('Simulated SMS codes are single use');
    const limited = await account('PRIVATE_USER');
    for (let i = 0; i < 5; i++)
      await assert.rejects(service.consumeChallenge(limited.id, 'ADMIN', 'wrong'));
    await assert.rejects(service.consumeChallenge(limited.id, 'ADMIN', 'wrong'), /RATE_LIMITED/);
    pass('Verification brute-force limit');
    const { POST } = await import('../src/app/api/account-verification/route');
    const request = (origin: string, body: object) =>
      new Request('http://127.0.0.1:3110/api/account-verification', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await POST(
          request('https://untrusted.example', { action: 'requestReset', email: user.email }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await POST(
          request('http://127.0.0.1:3110', {
            action: 'requestReset',
            email: 'absent@account.test',
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await POST(
          request('http://127.0.0.1:3110', {
            action: 'requestReset',
            email: user.email,
            tokenHash: 'injected',
          }),
        )
      ).status,
      400,
    );
    pass('API: same-origin enforcement, neutral unknown-account response, strict payload');
    console.log(`${groups} account-security groups passed; no auction/payment workflow executed.`);
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await Promise.all(files.map((file) => unlink(file).catch(() => {})));
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
