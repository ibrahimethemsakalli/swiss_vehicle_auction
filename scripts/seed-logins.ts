import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { hash } from 'bcryptjs';
import { db } from '../src/lib/db';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/autoveri'
  )
    throw new Error('Only the local autoveri development database is supported');
  const credentials = [];
  for (const [index, role] of (['PRIVATE_USER', 'DEALER', 'ADMIN'] as const).entries()) {
    const email = `${role.toLowerCase()}@local.autoveri.test`;
    if (await db.user.findUnique({ where: { email } }))
      throw new Error(`Account already exists: ${email}; passwords are never reset by this script`);
    const password = randomBytes(18).toString('base64url');
    await db.user.create({
      data: {
        email,
        phone: `LOCAL-LOGIN-${index}`,
        role,
        passwordHash: await hash(password, 12),
        companyName: role === 'DEALER' ? 'Local test dealer' : null,
      },
    });
    credentials.push({ role, email, password });
  }
  await mkdir('.local', { recursive: true });
  await writeFile('.local/test-logins.json', JSON.stringify(credentials, null, 2));
  console.log(
    'Created 3 local accounts. Credentials: .local/test-logins.json. Phone and identity remain unverified.',
  );
}
main().finally(() => db.$disconnect());
