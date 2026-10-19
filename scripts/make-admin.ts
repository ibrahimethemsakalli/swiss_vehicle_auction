import 'dotenv/config';
import { db } from '../src/lib/db';
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || process.argv[3] !== '--confirm')
    throw new Error('Usage: pnpm admin:grant registered-email --confirm');
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { email } });
    if (user.suspendedAt) throw new Error('Suspended account');
    await tx.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    await tx.outboxEvent.create({
      data: {
        kind: 'admin.bootstrap',
        deliveredAt: new Date(),
        payload: { userId: user.id, source: 'local-operator-cli' },
      },
    });
  });
  console.log('Admin role granted. Identity and phone verification were not changed.');
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
