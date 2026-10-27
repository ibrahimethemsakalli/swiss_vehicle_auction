import { randomBytes, createHash, randomInt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './db';
import type { Prisma } from '../generated/prisma/client';
import { rateLimit } from './rate-limit';
import { newPasswordInput } from './validation-inputs';

export const phonePattern = /^\+(?:41[1-9]\d{8}|423[1-9]\d{6})$/;
export function localMessagesEnabled() {
  try {
    const origin = new URL(process.env.NEXTAUTH_URL ?? '');
    const database = new URL(process.env.DATABASE_URL ?? '');
    const hosts = ['localhost', '127.0.0.1', '[::1]'];
    return (
      process.env.LOCAL_TEST_MESSAGES === 'true' &&
      process.env.NODE_ENV === 'development' &&
      origin.protocol === 'http:' &&
      hosts.includes(origin.hostname) &&
      hosts.includes(database.hostname) &&
      (database.pathname === '/autoveri' || database.pathname.endsWith('_test')) &&
      hosts.includes(process.env.HOST ?? '127.0.0.1')
    );
  } catch {
    return false;
  }
}
export const challengeHash = (value: string) => createHash('sha256').update(value).digest('hex');
export type ChallengePurpose = 'EMAIL' | 'RESET' | 'ADMIN' | 'SMS';
export async function issueChallenge(userId: string, purpose: ChallengePurpose, recipient: string) {
  if (!localMessagesEnabled()) throw new Error('PROVIDER_UNAVAILABLE');
  await rateLimit(`challenge:${purpose}:${userId}`, 3, 900);
  const token =
    purpose === 'ADMIN' || purpose === 'SMS'
      ? String(randomInt(100000, 1000000))
      : randomBytes(32).toString('base64url');
  const id = randomBytes(16).toString('hex');
  const expiresAt = new Date(
    Date.now() + (purpose === 'ADMIN' || purpose === 'SMS' ? 300000 : 1800000),
  );
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    await tx.$executeRaw`DELETE FROM "AccountChallenge" WHERE "userId"=${userId} AND purpose=${purpose}`;
    await tx.$executeRaw`INSERT INTO "AccountChallenge" (id,"userId",purpose,"tokenHash","expiresAt") VALUES (${id},${userId},${purpose},${challengeHash(token)},${expiresAt})`;
  });
  // Private filesystem inbox only: never served from public/ or returned by an API.
  const folder = join(process.cwd(), '.local', 'messages');
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, `${id}.json`),
    JSON.stringify({ simulated: true, recipient, purpose, token, expiresAt }, null, 2),
    { mode: 0o600 },
  );
  return id;
}
export async function consumeChallenge(
  userId: string,
  purpose: ChallengePurpose,
  token: string,
  client: Prisma.TransactionClient = db,
) {
  if (!token || token.length > 128) throw new Error('INVALID_CREDENTIALS');
  await rateLimit(`challenge:check:${purpose}:${userId}`, 5, 900);
  const count =
    await client.$executeRaw`DELETE FROM "AccountChallenge" WHERE "userId"=${userId} AND purpose=${purpose} AND "tokenHash"=${challengeHash(token)} AND "expiresAt">NOW()`;
  if (count !== 1) throw new Error('INVALID_CREDENTIALS');
}
export async function requestAccountMessage(
  email: string,
  purpose: 'EMAIL' | 'RESET' | 'ADMIN',
  password?: string,
) {
  if (!localMessagesEnabled()) throw new Error('PROVIDER_UNAVAILABLE');
  const normalized = email.trim().toLowerCase();
  await rateLimit(`message:request:${normalized}`, 5, 900);
  await rateLimit('message:global', 100, 3600);
  const user = await db.user.findUnique({ where: { email: normalized } });
  if (!user || user.suspendedAt || user.isSample) return;
  if (purpose === 'ADMIN') {
    const { compare } = await import('bcryptjs');
    if (
      user.role !== 'ADMIN' ||
      !password ||
      Buffer.byteLength(password) > 72 ||
      !(await compare(password, user.passwordHash))
    )
      return;
  }
  try {
    await issueChallenge(user.id, purpose, user.email);
  } catch (error) {
    // Account-specific resend limits must not disclose whether an address exists.
    if (!(error instanceof Error) || error.message !== 'RATE_LIMITED') throw error;
  }
}

export async function verifyEmail(userId: string, token: string) {
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.suspendedAt || user.isSample) throw new Error('FORBIDDEN');
    await consumeChallenge(userId, 'EMAIL', token, tx);
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  });
}
export async function resetByEmail(email: string, token: string, password: string) {
  const { hash } = await import('bcryptjs');
  newPasswordInput.parse({ password });
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.suspendedAt || user.isSample) throw new Error('INVALID_CREDENTIALS');
  const passwordHash = await hash(password, 12);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (current.suspendedAt || current.isSample) throw new Error('INVALID_CREDENTIALS');
    await consumeChallenge(user.id, 'RESET', token, tx);
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.$executeRaw`DELETE FROM "AccountChallenge" WHERE "userId"=${user.id}`;
  });
}
