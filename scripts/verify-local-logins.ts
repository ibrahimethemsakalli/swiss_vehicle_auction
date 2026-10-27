import 'dotenv/config';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(process.env.NODE_ENV !== 'production', 'Development only');
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/autoveri',
    'Local autoveri database only',
  );
  await db.$transaction(async (tx) => {
    for (const [index, role] of (['PRIVATE_USER', 'DEALER', 'ADMIN'] as const).entries()) {
      const email = `${role.toLowerCase()}@local.autoveri.test`;
      const account = await tx.user.findUniqueOrThrow({ where: { email } });
      assert.equal(account.role, role);
      assert.equal(account.phone, `LOCAL-LOGIN-${index}`);
      assert.equal(account.isSample, false);
      assert.equal(account.suspendedAt, null);
      await tx.user.update({
        where: { id: account.id },
        data: {
          isIdentityVerified: true,
          emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
          phoneVerifiedAt: account.phoneVerifiedAt ?? new Date(),
          ...(role === 'DEALER'
            ? {
                handelsregisterNr:
                  account.handelsregisterNr ?? 'LOCAL-TEST-DEALER-NOT-A-REAL-REGISTRY',
              }
            : {}),
        },
      });
    }
  });
  const accounts = await db.user.findMany({
    where: {
      email: {
        in: ['private_user', 'dealer', 'admin'].map((name) => `${name}@local.autoveri.test`),
      },
    },
    select: { role: true, isIdentityVerified: true, phoneVerifiedAt: true },
  });
  assert.equal(accounts.length, 3);
  assert.ok(accounts.every((a) => a.isIdentityVerified && a.phoneVerifiedAt));
  console.log(
    'PASS: all three local test accounts verified; passwords and roles unchanged. These are local fixtures, not real identity/SMS checks.',
  );
}
main().finally(() => db.$disconnect());
