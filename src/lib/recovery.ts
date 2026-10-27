import { randomBytes, createHash } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import { db } from './db';
import { rateLimit } from './rate-limit';
import { passwordInput as password, emailInput } from './validation-inputs';
const digest = (value: string) => createHash('sha256').update(value.trim()).digest('hex');
export async function generateRecoveryCodes(userId: string, currentPassword: string) {
  if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword) > 72)
    throw new Error('INVALID_CREDENTIALS');
  await rateLimit(`recovery:generate:${userId}`, 5, 3600);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.suspendedAt || user.isSample || !(await compare(currentPassword, user.passwordHash)))
    throw new Error('INVALID_CREDENTIALS');
  const codes = Array.from({ length: 5 }, () => randomBytes(24).toString('base64url'));
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (current.authVersion !== user.authVersion || current.suspendedAt)
      throw new Error('INVALID_CREDENTIALS');
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({ userId, tokenHash: digest(code) })),
    });
  });
  return codes;
}
export async function resetPassword(raw: unknown) {
  const input = z
    .object({
      email: emailInput,
      code: z.string().trim().min(20).max(128),
      password,
    })
    .strict()
    .parse(raw);
  await rateLimit(`recovery:reset:${input.email}`, 5, 900);
  await rateLimit('recovery:global', 100, 3600);
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user || user.suspendedAt || user.isSample) throw new Error('INVALID_CREDENTIALS');
  const passwordHash = await hash(input.password, 12);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    const code = await tx.recoveryCode.findUnique({ where: { tokenHash: digest(input.code) } });
    if (!code || code.userId !== user.id || current.suspendedAt)
      throw new Error('INVALID_CREDENTIALS');
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.$executeRaw`DELETE FROM "AccountChallenge" WHERE "userId"=${user.id}`;
  });
}
export async function changePassword(userId: string, raw: unknown) {
  const input = z
    .object({ currentPassword: z.string().max(72), password })
    .strict()
    .parse(raw);
  await rateLimit(`password:change:${userId}`, 5, 900);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (
    user.suspendedAt ||
    user.isSample ||
    !(await compare(input.currentPassword, user.passwordHash))
  )
    throw new Error('INVALID_CREDENTIALS');
  const passwordHash = await hash(input.password, 12);
  await db.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id: userId, authVersion: user.authVersion, suspendedAt: null },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    if (!changed.count) throw new Error('INVALID_CREDENTIALS');
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.$executeRaw`DELETE FROM "AccountChallenge" WHERE "userId"=${userId}`;
  });
}
