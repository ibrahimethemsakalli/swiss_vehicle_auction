import { z } from 'zod';
import { hash } from 'bcryptjs';
import { db } from './db';
import { rateLimit } from './rate-limit';
export const registrationInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z
      .string()
      .min(12)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
    phone: z.string().regex(/^\+41[1-9]\d{8}$/),
    role: z.enum(['PRIVATE_USER', 'DEALER']),
    language: z.enum(['de', 'fr', 'it', 'en']),
    companyName: z.string().trim().max(160).optional(),
    handelsregisterNr: z.string().trim().max(80).optional(),
  })
  .strict()
  .refine((v) => v.role !== 'DEALER' || (!!v.companyName && !!v.handelsregisterNr));
export async function register(raw: unknown) {
  const input = registrationInput.parse(raw);
  await rateLimit('registration:global', 30, 3600);
  const { password, ...data } = input;
  const user = await db.user.create({
    data: { ...data, passwordHash: await hash(password, 12) },
    select: { id: true },
  });
  return user;
}
